import { hashOf } from './model.mjs';

const API = 'https://activitysmith.com/api';
const LIMITS = { push: { minute: 60, tick: 1 }, live: { minute: 300, tick: 8 }, badge: { minute: 60, tick: 1 } };
const CAPACITY_RETRY_MS = 10 * 60_000;
const PAUSED_RETRY_MS = 60_000;
const ACK_KEPT_MS = 7 * 24 * 3_600_000;
const KIND_ORDER = { 'needs-you': 0, failed: 1, shipped: 2, replied: 3 };

export const emptyPhone = () => ({ streams: {}, rejected: {}, badge: null, acks: {}, budget: { push: [], live: [], badge: [] }, pausedUntil: { push: 0, live: 0, badge: 0 }, capacity: null });

export function createClient({ getKey, fetchImpl = globalThis.fetch, recheckMs = 30_000 }) {
  let key = null;
  let checkedAt = -Infinity;
  const currentKey = () => {
    if (!key && Date.now() - checkedAt >= recheckMs) {
      checkedAt = Date.now();
      key = getKey();
    }
    return key;
  };
  async function call(method, path, body) {
    if (!currentKey()) return { ok: false, kind: 'no-key' };
    const payload = JSON.stringify(body);
    let response;
    try {
      response = await fetchImpl(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: payload, signal: AbortSignal.timeout(15_000) });
    } catch {
      return { ok: false, kind: 'transient' };
    }
    const text = await response.text().catch(() => '');
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {}
    if (response.ok || (method === 'DELETE' && response.status === 404)) return { ok: true, paused: json.operation === 'paused' };
    if (response.status === 401) key = null;
    if (response.status === 429) return 'limit' in json && 'active' in json ? { ok: false, kind: 'capacity' } : { ok: false, kind: 'rate', retryAfter: Number(response.headers.get('retry-after')) || 30 };
    if (response.status >= 500) return { ok: false, kind: 'transient', status: response.status };
    return { ok: false, kind: 'rejected', status: response.status, detail: text.slice(0, 200) };
  }
  return {
    put: (streamKey, body) => call('PUT', `/live-activity/stream/${streamKey}`, { ...body, tags: ['pstack-pulse'] }),
    end: (streamKey, body) => call('DELETE', `/live-activity/stream/${streamKey}`, { content_state: { ...body.content_state, auto_dismiss_minutes: 0 } }),
    badge: (badge) => call('POST', '/badge', { badge }),
    push: (incident, listUrl) => {
      const actions = [incident.page && incident.page !== incident.link && { title: 'Plan page', type: 'open_url', url: incident.page }, listUrl && { title: 'All sessions', type: 'open_url', url: listUrl }].filter(Boolean);
      return call('POST', '/push-notification', {
        title: incident.title.slice(0, 120),
        message: incident.message.slice(0, 250),
        ...(incident.link ? { redirection: incident.link } : {}),
        ...(actions.length ? { actions } : {}),
        tags: ['pstack-pulse'],
      });
    },
  };
}

function spend(phone, feature, at, used) {
  phone.budget[feature] = phone.budget[feature].filter((time) => at - time < 60_000);
  if (at < phone.pausedUntil[feature] || used[feature] >= LIMITS[feature].tick || phone.budget[feature].length >= LIMITS[feature].minute) return false;
  phone.budget[feature].push(at);
  used[feature] += 1;
  return true;
}

export async function deliver(phone, desired, { client, clock = Date.now, save = () => {} }) {
  const problems = [];
  const used = { push: 0, live: 0, badge: 0 };
  const want = new Map(desired.cards);
  const blocked = new Set();
  const refused = (feature, result, what) => {
    if (result.kind === 'rate') phone.pausedUntil[feature] = clock() + result.retryAfter * 1000;
    problems.push(`${what}: ${result.kind}${result.status ? ` ${result.status}` : ''}${result.detail ? ` ${result.detail}` : ''}`);
  };

  for (const [key, stream] of Object.entries(phone.streams)) {
    if (want.get(key)?.type === stream.type) continue;
    if (clock() < (stream.retryAt ?? 0) || !spend(phone, 'live', clock(), used)) {
      blocked.add(key);
      continue;
    }
    const result = await client.end(key, stream.body);
    if (result.ok) {
      delete phone.streams[key];
      save();
    } else {
      stream.retryAt = clock() + 10_000;
      blocked.add(key);
      refused('live', result, `end ${key}`);
    }
  }

  for (const key of Object.keys(phone.rejected)) if (!want.has(key)) delete phone.rejected[key];
  for (const [key, card] of want) {
    const stream = phone.streams[key];
    const hash = hashOf(card.body);
    if (blocked.has(key) || stream?.hash === hash || phone.rejected[key] === hash || clock() < (stream?.retryAt ?? 0)) continue;
    if (!stream && (blocked.size || (phone.capacity && clock() < phone.capacity.until))) continue;
    if (!spend(phone, 'live', clock(), used)) break;
    const result = await client.put(key, card.body);
    if (result.ok) {
      phone.streams[key] = { type: card.type, hash: result.paused ? null : hash, body: card.body, ...(result.paused ? { retryAt: clock() + PAUSED_RETRY_MS } : {}) };
      if (!stream) phone.capacity = null;
      delete phone.rejected[key];
      save();
    } else {
      if (result.kind === 'capacity') phone.capacity = { slots: Object.keys(phone.streams).length, until: clock() + CAPACITY_RETRY_MS };
      if (result.kind === 'rejected') phone.rejected[key] = hash;
      refused('live', result, `card ${key}`);
    }
  }

  if (desired.badge !== phone.badge && spend(phone, 'badge', clock(), used)) {
    const result = await client.badge(desired.badge);
    if (result.ok) {
      phone.badge = desired.badge;
      save();
    } else refused('badge', result, 'badge');
  }

  for (const id of desired.incidents.keys()) phone.acks[id] = { attempts: 0, ...phone.acks[id], liveAt: clock() };
  const due = [...desired.incidents.values()].filter(({ id }) => !phone.acks[id].sentAt && clock() >= (phone.acks[id].retryAt ?? 0)).sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.at.localeCompare(b.at));
  for (const incident of due) {
    if (!spend(phone, 'push', clock(), used)) break;
    const ack = phone.acks[incident.id];
    const result = await client.push(incident, desired.listUrl);
    if (result.ok) {
      ack.sentAt = clock();
      save();
    } else {
      ack.attempts += 1;
      ack.retryAt = clock() + (result.kind === 'rate' ? result.retryAfter * 1000 : Math.min(2000 * 2 ** ack.attempts, 300_000));
      refused('push', result, `push ${incident.kind}`);
    }
  }
  for (const [id, ack] of Object.entries(phone.acks)) if (clock() - ack.liveAt > ACK_KEPT_MS) delete phone.acks[id];
  return problems;
}

export async function teardown(phone, client, save) {
  const problems = [];
  for (const [key, stream] of Object.entries(phone.streams)) {
    const result = await client.end(key, stream.body);
    if (result.ok) {
      delete phone.streams[key];
      save();
    } else problems.push(`end ${key}: ${result.kind}`);
  }
  const result = await client.badge(0);
  if (result.ok) {
    phone.badge = 0;
    save();
  } else problems.push(`badge: ${result.kind}`);
  return problems;
}
