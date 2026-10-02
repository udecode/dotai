// Installed by the sync-pstack skill. A plan's state is the first word of its
// Status line; plan-page and plan-open read it here so they never disagree.

const LANDED = ['done', 'complete', 'completed', 'shipped', 'executed', 'implemented', 'fixed', 'released', 'merged', 'verified', 'landed'];

export const STATES = {
  done: [...LANDED, 'superseded', 'replaced', 'closed', 'cancelled', 'canceled', 'abandoned', 'retired', 'terminated'],
  active: ['building', 'executing', 'in', 'active', 'resumed', 'reopened', 'rework', 'review', 'reviewing', 'awaiting', 'waiting'],
  held: ['blocked', 'paused'],
  planning: ['planning', 'planned', 'draft', 'proposed', 'ready', 'pending', 'scoped', 'partial', 'approved', 'accepted', 'open'],
};

function words(status) {
  return status
    .trim()
    .replace(/^[^a-z]+/i, '')
    .toLowerCase()
    .split(/[^a-z-]+/)
    .map((word) => word.replaceAll('-', ''))
    .filter(Boolean);
}

export function stateOf(status) {
  const [first, second] = words(status);
  if (first === 'in' && ['planning', 'draft'].includes(second)) return 'planning';
  return Object.keys(STATES).find((state) => STATES[state].includes(first)) ?? null;
}

// Superseded and cancelled plans close without their work, so only landed ones face the Done gate.
export const landed = (status) => LANDED.includes(words(status)[0]);
