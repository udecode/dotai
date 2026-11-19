import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Locator, type Page } from 'playwright-core'

const ASSETS = `${import.meta.dir}/../assets`

/** The page size a clip films, in CSS pixels, and how many video pixels each one takes. */
export type View = { width: number; height: number; scale: number }
export type Modifier = 'Alt' | 'Control' | 'Meta' | 'Shift'
// CDP's Input.dispatchMouseEvent modifiers bit field.
const MODIFIER_BITS: Record<Modifier, number> = { Alt: 1, Control: 2, Meta: 4, Shift: 8 }

// The X shape is the owner's go (2026-11-19).
const x: View = { width: 540, height: 675, scale: 2 }
// X's phone feed shows a clip about 312 pt wide (an iPhone's 393 pt less the avatar column and margins, estimated, not measured).
const feedPt = 312
const titleMinPt = 14

export const CLIP = {
  fps: 60,
  wide: { width: 1100, height: 720, scale: 1 } as View,
  x,
  feedPt,
  phoneTextPt: 9,
  // Chat bots read these into their media rules, so a change takes a bot restart.
  maxSeconds: 20,
  maxMB: 8,
  // Four beats took about 14 s in the debut, the pace the owner picked (2026-11-18).
  xSeconds: 16,
  firstBeatS: 0.8,
  beatMinS: 1.2,
  // "Pauses are a bit too long, humans should not lose attention" (the owner, 2026-11-19): a stretch where nothing moves gets cut down to these.
  stillMaxS: 0.7,
  endHoldS: 1,
  stillLeadS: 0.2,
  caretPx: 50,
  stillLevel: 16,
  stillMinS: 0.3,
  resultLevel: 8,
  captionWords: 6,
  titleWords: 6,
  titlePx: { min: Math.floor((titleMinPt * x.width) / feedPt), max: 36 },
  heldGapMs: 25,
  heldLagPx: 0.5,
  pressJumpPx: 2,
  freeFlips: 3,
}

/** Each rule the checks below enforce, as the clips skill lists it. */
export const RULES: { rule: string; check: string }[] = [
  { rule: `Film and render at ${CLIP.fps} fps.`, check: 'reviewFile' },
  { rule: `A clip runs at most ${CLIP.maxSeconds} s and ${CLIP.maxMB} MB. An X clip aims for ${CLIP.xSeconds} s or less.`, check: 'reviewTake, reviewFile' },
  { rule: `The first caption shows within ${CLIP.firstBeatS} s, so the clip opens on the action.`, check: 'reviewTake' },
  { rule: `Each caption stays up at least ${CLIP.beatMinS} s.`, check: 'reviewTake' },
  { rule: `Nothing on screen sits still for more than ${CLIP.stillMaxS} s, or ${CLIP.endHoldS} s at the end. Render cuts the extra still frames on its own, but never takes a caption under ${CLIP.beatMinS} s and never cuts a hold the scene marks with \`read(ms)\`.`, check: 'squeezePlan, renderTake' },
  { rule: 'A caption is white text on a black footer under the clip, so it never reads as page text. Keys show as white keycaps in it.', check: 'captionHtml, renderClip' },
  { rule: `A caption is a short sentence of at most ${CLIP.captionWords} words with no closing period. It starts with a capital, unless it starts with a [Key]. Render fixes the capital and the period on its own.`, check: 'checkCaption, fixCaption' },
  { rule: 'A caption switches on as its action starts and off as the next one starts, with no fade.', check: 'captionOverlay' },
  { rule: `While a button is down, the drawn cursor stays within ${CLIP.heldLagPx} px of the pointer and never turns back on its own.`, check: 'checkTrail' },
  { rule: `The drawn cursor jumps at most ${CLIP.pressJumpPx} px at a press, and turns back at most ${CLIP.freeFlips} times on free moves.`, check: 'checkTrail' },
  { rule: `While a button is down, the pointer moves every frame, at most ${CLIP.heldGapMs} ms apart at the 90th percentile, so a stroke grows smoothly.`, check: 'checkTrail' },
  { rule: `A title bar holds a one-word lowercase tag and a lowercase title of at most ${CLIP.titleWords} words, on one line at ${CLIP.titlePx.max} px, shrunk down to ${CLIP.titlePx.min} px to fit.`, check: 'checkTitle, renderClip' },
  { rule: 'A crop has even sides inside the viewport. Render rounds and clamps it on its own.', check: 'fitCrop' },
  {
    rule: `An X clip opens with \`{ shape: 'x' }\`, which films the page ${CLIP.x.width} px wide and 4:5 tall at ${CLIP.x.scale}× pixels. Its page text shows at ${CLIP.phoneTextPt} pt or more in a phone's feed, which shows a clip about ${CLIP.feedPt} pt wide.`,
    check: 'openClip, reviewTake',
  },
  {
    rule: 'A change to something a reader already saw shows as one clip, the take before the change and then the take after it, each half labeled Before or After in its footer. Both takes film the same shape and crop, and the whole clip keeps the length and size limits.',
    check: 'checkPair, renderCompare',
  },
]

/** One caption, from the second it starts: a short sentence, keys in brackets, or both, such as `Draw a note` or `[N] [Enter]`. */
export type Beat = { t: number; text: string }
export type Crop = { x: number; y: number; w: number; h: number }
/** One recording: the raw video, where the clip starts and ends in it, the page clock its trail starts at, the crop and the captions, the page size it filmed, and the page's usual text size in the crop. */
export type Take = {
  video: string
  startMs: number
  endMs: number
  trailFrom: number
  crop?: Crop
  captions: Beat[]
  holds?: [number, number][]
  view?: View
  textPx?: number
}
/** One page frame: the page clock in ms, 1 while a button is down, the drawn cursor's x and y, then the real pointer's. */
export type TrailRow = [number, number, number, number, number, number]
export type Review = { fails: string[]; fixes: string[]; suggests: string[] }

// Headless recordings draw no pointer, so shapes would appear on their own.
function drawCursor() {
  const draw = () => {
    const c = document.createElement('div')
    c.innerHTML =
      '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 1.5v19l4.6-4.3 3.1 7 3-1.3-3-6.9 6.5-.4z" fill="#0a0a0a" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transformOrigin: '2px 1.5px' })
    document.documentElement.appendChild(c)
    const target = { x: -100, y: -100 }
    const p = { x: -100, y: -100 }
    const v = { x: 0, y: 0 }
    let down = false
    let press = 1
    let last = performance.now()
    const follow = (e: PointerEvent) => {
      target.x = e.clientX
      target.y = e.clientY
    }
    addEventListener('pointermove', follow, true)
    addEventListener('pointerdown', e => ((down = true), follow(e)), true)
    addEventListener('pointerup', e => ((down = false), follow(e)), true)
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      if (down) {
        // A spring chasing a dragged pointer lagged off what it dragged (2026-11-18), so a held button glues the cursor to the pointer.
        p.x = target.x
        p.y = target.y
        v.x = v.y = 0
      } else {
        const k = 800
        const damp = 2 * 0.72 * Math.sqrt(k)
        const substepS = 0.004
        const n = Math.ceil(dt / substepS)
        for (let i = 0; i < n; i++) {
          for (const a of ['x', 'y'] as const) {
            v[a] += (-k * (p[a] - target[a]) - damp * v[a]) * (dt / n)
            p[a] += v[a] * (dt / n)
          }
        }
      }
      press += ((down ? 0.86 : 1) - press) * Math.min(1, dt * 30)
      ;((window as any).__trail ??= []).push([now, down ? 1 : 0, p.x, p.y, target.x, target.y])
      c.style.transform = `translate(${p.x - 2}px,${p.y - 1.5}px) scale(${press})`
      requestAnimationFrame(frame)
    }
    requestAnimationFrame(frame)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', draw)
  else draw()
}

export const minimumJerk = (p: number) => p * p * p * (10 + p * (-15 + 6 * p))
/** A pen stroke starts already moving at half its mean speed, because a minimum-jerk start dwells long enough to pool ink in a blob. */
export const stroke = (p: number) => (0.4 * p + (0.6 * (1 - Math.cos(Math.PI * p))) / Math.PI) / (0.4 + 1.2 / Math.PI)
const fitts = (d: number) => 180 + 110 * Math.log2(d / 30 + 1)

export class Clip {
  pos = { x: 0, y: 0 }
  readonly captions: Beat[] = []
  readonly holds: [number, number][] = []
  private held = false
  private mods = 0
  private out = ''
  private video = ''
  private t0 = 0
  private startMs = 0
  private trailFrom = 0

  constructor(
    readonly browser: Browser,
    readonly ctx: BrowserContext,
    readonly page: Page,
    private readonly cdp: CDPSession,
    readonly view: View = CLIP.wide,
  ) {}

  // Playwright's page.mouse waits until each move is handled, and that wait swings from 17 to 50 ms, so a drawn line grew in uneven jumps.
  private mouse(type: 'mouseMoved' | 'mousePressed' | 'mouseReleased', clickCount = 0) {
    return this.cdp.send('Input.dispatchMouseEvent', {
      type,
      x: this.pos.x,
      y: this.pos.y,
      button: type === 'mouseMoved' && !this.held ? 'none' : 'left',
      buttons: this.held ? 1 : 0,
      clickCount,
      modifiers: this.mods,
    })
  }

  // A CDP mouse event carries no keyboard state, so a Shift held with page.keyboard.down never reached a drag's pointer events.
  /** Holds a modifier key, such as Shift for a circle, so each mouse event carries it until `keyUp`. */
  async keyDown(key: Modifier) {
    await this.page.keyboard.down(key)
    this.mods |= MODIFIER_BITS[key]
  }

  async keyUp(key: Modifier) {
    this.mods &= ~MODIFIER_BITS[key]
    await this.page.keyboard.up(key)
  }

  wait(ms: number) {
    return this.page.waitForTimeout(ms)
  }

  /** Holds still while a viewer reads something that just appeared, such as a toast; render never cuts this hold. */
  async read(ms: number) {
    const from = (Date.now() - this.t0 - this.startMs) / 1000
    await this.wait(ms)
    this.holds.push([from, from + ms / 1000])
  }

  async down(clickCount = 1) {
    this.held = true
    await this.mouse('mousePressed', clickCount)
  }

  async up(clickCount = 1) {
    this.held = false
    await this.mouse('mouseReleased', clickCount)
  }

  /** Moves along `at(p)` as p goes from 0 to 1 over `ms` of wall clock, however long Chrome takes to handle each move. */
  async over(ms: number, at: (p: number) => readonly [number, number]) {
    const began = performance.now()
    const sent: Promise<unknown>[] = []
    for (let k = 1; ; k++) {
      const p = Math.min(1, (performance.now() - began) / ms)
      const [x, y] = at(p)
      this.pos = { x, y }
      sent.push(this.mouse('mouseMoved'))
      if (p >= 1) break
      await Bun.sleep(Math.max(0, began + k * (1000 / CLIP.fps) - performance.now()))
    }
    await Promise.all(sent)
  }

  /** A hand's move to (x, y), in Fitts' law time on a minimum-jerk curve that bows a little. The cursor's spring adds the landing. */
  async glide(x: number, y: number, { ms, bow = true }: { ms?: number; bow?: boolean } = {}) {
    const from = { ...this.pos }
    const d = Math.hypot(x - from.x, y - from.y)
    const arc = bow ? Math.min(24, d * 0.06) : 0
    const [nx, ny] = [-(y - from.y) / (d || 1), (x - from.x) / (d || 1)]
    await this.over(ms ?? fitts(d), p => {
      const t = minimumJerk(p)
      const off = Math.sin(Math.PI * p) * arc
      return [from.x + (x - from.x) * t + nx * off, from.y + (y - from.y) * t + ny * off]
    })
  }

  /** Puts the pointer at (x, y) at once, before filming. */
  async place(x: number, y: number) {
    this.pos = { x, y }
    await this.mouse('mouseMoved')
    await this.wait(300)
  }

  /** A click where the pointer is, after the short rest a hand takes on its target. */
  async press() {
    await this.wait(140)
    await this.down()
    await this.wait(70)
    await this.up()
  }

  async dblclick() {
    await this.down(1)
    await this.up(1)
    await this.wait(60)
    await this.down(2)
    await this.up(2)
  }

  /** Glides to the middle of a control and clicks it. */
  async click(target: Locator) {
    const box = await target.boundingBox()
    if (!box) throw new Error(`${target} is not on the page`)
    await this.glide(box.x + box.width / 2, box.y + box.height / 2)
    await this.press()
  }

  async drag(from: readonly [number, number], to: readonly [number, number], ms = 480) {
    await this.glide(...from)
    await this.wait(140)
    await this.down()
    await this.glide(...to, { ms, bow: false })
    await this.wait(80)
    await this.up()
  }

  /** Types at a hand's pace, 25 to 70 ms a key and a little longer after a space. */
  async write(text: string) {
    for (const ch of text) {
      await this.page.keyboard.type(ch)
      await this.wait(25 + Math.random() * 45 + (ch === ' ' ? 25 : 0))
    }
  }

  /** Starts filming into `out`. Everything before this is setup the clip leaves out. */
  async film(out: string) {
    mkdirSync(out, { recursive: true })
    this.out = out
    this.video = resolve(out, 'clip.webm')
    const { width, height, scale } = this.view
    await this.page.screencast.start({ path: this.video, size: { width: width * scale, height: height * scale }, fps: CLIP.fps })
    this.t0 = Date.now()
    this.trailFrom = await this.page.evaluate(() => performance.now())
    await this.wait(200)
    this.startMs = Date.now() - this.t0
  }

  /** Starts a caption now, as its action starts. */
  beat(text: string) {
    this.captions.push({ t: (Date.now() - this.t0 - this.startMs) / 1000, text })
  }

  still(name: string) {
    return this.page.screenshot({ path: join(this.out, `${name}.png`) })
  }

  /** Stops filming, closes the browser, and writes trail.json and take.json beside the video. */
  async finish(crop?: Crop): Promise<Take> {
    const endMs = Date.now() - this.t0
    const trail = await this.page.evaluate(() => (window as any).__trail ?? [])
    await Bun.write(join(this.out, 'trail.json'), JSON.stringify(trail))
    const fitted = crop && fitCrop(crop, this.view)
    const textPx = await this.page.evaluate(medianTextPx, fitted ?? { x: 0, y: 0, w: this.view.width, h: this.view.height })
    await this.page.screencast.stop()
    await this.browser.close()
    const take: Take = {
      video: this.video,
      startMs: this.startMs,
      endMs,
      trailFrom: this.trailFrom,
      crop: fitted,
      captions: this.captions,
      holds: this.holds,
      view: this.view,
      textPx,
    }
    await Bun.write(join(this.out, 'take.json'), JSON.stringify(take, null, 2))
    return take
  }
}

function medianTextPx(crop: Crop): number {
  const sizes: number[] = []
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const text = n.textContent?.trim() ?? ''
    const el = n.parentElement
    if (!text || !el?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue
    range.selectNodeContents(n)
    const r = range.getBoundingClientRect()
    if (!r.width || r.right < crop.x || r.left > crop.x + crop.w || r.bottom < crop.y || r.top > crop.y + crop.h) continue
    const px = parseFloat(getComputedStyle(el).fontSize)
    for (let i = 0; i < text.length; i++) sizes.push(px)
  }
  sizes.sort((a, b) => a - b)
  return sizes[Math.floor(sizes.length / 2)] ?? 0
}

export async function openClip(
  url: string,
  {
    cursor = true,
    colorScheme = 'light',
    shape = 'wide',
    storageState,
  }: { cursor?: boolean; colorScheme?: 'light' | 'dark'; shape?: 'wide' | 'x'; storageState?: string } = {},
) {
  const view = CLIP[shape]
  // With only the context's deviceScaleFactor, Chrome screencast an X page at 540 px into a 1080 px frame.
  const browser = await chromium.launch({ args: [`--force-device-scale-factor=${view.scale}`] })
  const ctx = await browser.newContext({ colorScheme, viewport: { width: view.width, height: view.height }, deviceScaleFactor: view.scale, storageState })
  if (cursor) await ctx.addInitScript(drawCursor)
  const page = await ctx.newPage()
  await page.goto(url, { waitUntil: 'networkidle' })
  return new Clip(browser, ctx, page, await ctx.newCDPSession(page), view)
}

/** How tall a page's text shows in a phone's X feed, in points, for a clip `width` CSS px wide. */
export const phonePt = (textPx: number, width: number) => tenth((textPx * CLIP.feedPt) / width)

const quantile = (sorted: number[], q: number) => sorted[Math.floor(q * (sorted.length - 1))] ?? 0
export const tenth = (n: number) => Math.round(n * 10) / 10

/** How the drawn cursor tracked the real pointer, and each way it went wrong. Rows before `from` are setup outside the clip. */
export function checkTrail(trail: TrailRow[], from = 0) {
  const rows = trail.filter(r => r[0] >= from)
  /** The drawn cursor reverses on one axis while the pointer keeps its direction there. */
  const turnedBackAlone = (r: TrailRow[], i: number, drawn: 2 | 3, real: 4 | 5) => {
    const a = r[i - 1][drawn] - r[i - 2][drawn]
    const b = r[i][drawn] - r[i - 1][drawn]
    const ta = r[i - 1][real] - r[i - 2][real]
    const tb = r[i][real] - r[i - 1][real]
    return a * b < 0 && Math.abs(a) > 0.5 && Math.abs(b) > 0.5 && ta * tb >= 0 && (ta !== 0 || tb !== 0)
  }
  const side = (down: number) => {
    const r = rows.filter(x => x[1] === down)
    let flips = 0
    const lags: number[] = []
    for (let i = 2; i < r.length; i++) {
      flips += Number(turnedBackAlone(r, i, 2, 4)) + Number(turnedBackAlone(r, i, 3, 5))
      lags.push(Math.hypot(r[i][2] - r[i][4], r[i][3] - r[i][5]))
    }
    lags.sort((x, y) => x - y)
    return { frames: r.length, flips, p95Lag: tenth(quantile(lags, 0.95)), maxLag: tenth(quantile(lags, 1)) }
  }
  const handRestMs = 200
  const pressJumps: number[] = []
  const gaps: number[] = []
  let lastMove = 0
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === 1 && rows[i - 1][1] === 0) pressJumps.push(tenth(Math.hypot(rows[i - 1][2] - rows[i - 1][4], rows[i - 1][3] - rows[i - 1][5])))
    if (rows[i][1] === 1 && (rows[i][4] !== rows[i - 1][4] || rows[i][5] !== rows[i - 1][5])) {
      if (lastMove && rows[i][0] - lastMove < handRestMs) gaps.push(rows[i][0] - lastMove)
      lastMove = rows[i][0]
    }
  }
  gaps.sort((x, y) => x - y)
  const held = side(1)
  const free = side(0)
  const snap = Math.max(0, ...pressJumps)
  const heldGapP90 = Math.round(quantile(gaps, 0.9))
  const problems: string[] = []
  if (held.flips) problems.push(`the cursor turned back on its own ${held.flips} times while a button was down`)
  if (held.maxLag > CLIP.heldLagPx) problems.push(`the cursor left the pointer by ${held.maxLag} px while a button was down, over ${CLIP.heldLagPx} px`)
  if (free.flips > CLIP.freeFlips) problems.push(`the cursor turned back ${free.flips} times on free moves, over ${CLIP.freeFlips}, so its spring may diverge`)
  if (snap > CLIP.pressJumpPx) problems.push(`the cursor jumped ${snap} px at a press, over ${CLIP.pressJumpPx} px, so let it settle before the press`)
  if (heldGapP90 > CLIP.heldGapMs) problems.push(`pointer moves came ${heldGapP90} ms apart while a button was down, over ${CLIP.heldGapMs} ms, so a stroke grows in jumps; move with Clip.over`)
  return { held, free, pressJumps, heldGapP90, problems }
}

export function checkCaption(text: string) {
  const t = text.trim()
  if (!t) throw new Error('a caption needs text or keys')
  if (t.split(/\s+/).length > CLIP.captionWords) throw new Error(`caption "${text}" has more than ${CLIP.captionWords} words; say it shorter`)
  if (/^[a-z]/.test(t)) throw new Error(`caption "${text}" starts a sentence, so it starts with a capital, as in "Draw a note"`)
  if (/\.$/.test(t)) throw new Error(`caption "${text}" ends without a period`)
}

/** Fixes what a caption can lose by accident: a lowercase start and a closing period. */
export const fixCaption = (text: string) => {
  const t = text.trim().replace(/\.$/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function checkTitle(tag: string, title: string) {
  if (!/^[a-z]{2,12}$/.test(tag)) throw new Error(`tag "${tag}" must be one lowercase word, such as board or table`)
  if (title !== title.toLowerCase() || title.split(/\s+/).length > CLIP.titleWords)
    throw new Error(`title "${title}" must be lowercase and at most ${CLIP.titleWords} words`)
}

/** libx264 needs even sides, and a crop past the viewport fails, so a crop is rounded and clamped instead of refused. */
export function fitCrop(c: Crop, view: { width: number; height: number } = CLIP.wide): Crop {
  const even = (n: number) => Math.round(n / 2) * 2
  const floorEven = (n: number) => Math.floor(n / 2) * 2
  const x = Math.max(0, even(c.x))
  const y = Math.max(0, even(c.y))
  return { x, y, w: floorEven(Math.min(c.w, view.width - x)), h: floorEven(Math.min(c.h, view.height - y)) }
}

/** The rules a take can break before it is rendered, with what render fixes on its own and what would make it better. */
/** `cutS` is the still time render cuts, so the length rules judge the clip a viewer gets. */
export function reviewTake(take: Take, trail: TrailRow[], { x = false, cutS = 0 }: { x?: boolean; cutS?: number } = {}): Review {
  const fails = [...checkTrail(trail, take.trailFrom).problems]
  const fixes: string[] = []
  const suggests: string[] = []
  const filmed = (take.endMs - take.startMs) / 1000 + CLIP.stillLeadS
  const seconds = filmed - cutS
  if (seconds > CLIP.maxSeconds) fails.push(`the clip runs ${tenth(seconds)} s, over ${CLIP.maxSeconds} s; cut a beat or tighten the waits`)
  else if (x && seconds > CLIP.xSeconds) suggests.push(`the clip runs ${tenth(seconds)} s; an X clip reads best at ${CLIP.xSeconds} s or less, so tighten the waits between beats`)
  for (const c of take.captions) {
    const fixed = fixCaption(c.text)
    if (fixed !== c.text) fixes.push(`caption "${c.text}" renders as "${fixed}"`)
    try {
      checkCaption(fixed)
    } catch (e) {
      fails.push((e as Error).message)
    }
  }
  if (!take.captions.length) suggests.push('the clip has no captions, and a muted autoplay shows nothing to read; add a beat per action')
  else if (take.captions[0].t + CLIP.stillLeadS > CLIP.firstBeatS)
    suggests.push(`the first caption shows at ${tenth(take.captions[0].t + CLIP.stillLeadS)} s; open on the action, within ${CLIP.firstBeatS} s`)
  take.captions.forEach((c, i) => {
    const s = (i + 1 < take.captions.length ? take.captions[i + 1].t : filmed - CLIP.stillLeadS) - c.t
    if (s < CLIP.beatMinS) fails.push(`"${c.text}" shows for ${tenth(s)} s, under ${CLIP.beatMinS} s; hold that beat longer`)
  })
  const view = take.view ?? CLIP.wide
  const crop = take.crop && fitCrop(take.crop, view)
  if (crop && JSON.stringify(crop) !== JSON.stringify(take.crop)) fixes.push(`the crop ${JSON.stringify(take.crop)} renders as ${JSON.stringify(crop)}`)
  if (x && !take.textPx) suggests.push('the take has no text size, so review cannot judge it on a phone; record it again')
  else if (x && take.textPx) {
    const width = crop?.w ?? view.width
    const pt = phonePt(take.textPx, width)
    const widest = Math.floor((take.textPx * CLIP.feedPt) / CLIP.phoneTextPt)
    if (pt < CLIP.phoneTextPt)
      fails.push(`the page's ${take.textPx} px text shows at ${pt} pt in a phone's X feed, under ${CLIP.phoneTextPt} pt; film with openClip's { shape: 'x' }, or crop it at most ${widest} px wide`)
  }
  return { fails, fixes, suggests }
}

/** The rules a rendered file can break. */
export async function reviewFile(file: string): Promise<string[]> {
  const fails: string[] = []
  const [rate] = (await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=r_frame_rate', '-of', 'default=nw=1:nk=1', file])).trim().split('\n')
  const [num, den] = rate.split('/').map(Number)
  if (Math.round(num / (den || 1)) !== CLIP.fps) fails.push(`${file} plays at ${rate} fps, not ${CLIP.fps}`)
  const mb = statSync(file).size / 2 ** 20
  if (mb > CLIP.maxMB) fails.push(`${file} is ${tenth(mb)} MB, over ${CLIP.maxMB} MB`)
  return fails
}

export const readTake = (dir: string) => ({
  take: JSON.parse(readFileSync(join(dir, 'take.json'), 'utf8')) as Take,
  trail: JSON.parse(readFileSync(join(dir, 'trail.json'), 'utf8')) as TrailRow[],
})

/** Cuts the clip out of a take's video at 60 fps, cropped, and returns its captions on the cut's clock. */
export async function cut(take: Take, raw: string): Promise<Beat[]> {
  const view = take.view ?? CLIP.wide
  const crop = take.crop && fitCrop(take.crop, view)
  const s = view.scale
  const vf = [crop && `crop=${crop.w * s}:${crop.h * s}:${crop.x * s}:${crop.y * s}`, `fps=${CLIP.fps}`].filter(Boolean).join(',')
  const from = (take.startMs / 1000 - CLIP.stillLeadS).toFixed(3)
  await run(['ffmpeg', '-v', 'error', '-y', '-ss', from, '-to', (take.endMs / 1000).toFixed(3), '-i', take.video, '-vf', vf, '-an', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', raw])
  return take.captions.map(c => ({ t: Math.round((c.t + CLIP.stillLeadS) * 1000) / 1000, text: fixCaption(c.text) }))
}

/** The stretches of a video with `scale` pixels per CSS pixel where nothing on screen changes, as [from, to] seconds. */
export async function stillStretches(file: string, scale = 1): Promise<[number, number][]> {
  const [w, h] = (await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file])).trim().split(',').map(Number)
  // Each frame's share of pixels that moved more than a few gray levels from the frame before, which signalstats prints as YAVG out of 255.
  const vf = `format=gray,tblend=all_mode=difference,lut=c0='if(gt(val,${CLIP.stillLevel}),255,0)',signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`
  const out = await run(['ffmpeg', '-v', 'error', '-i', file, '-vf', vf, '-an', '-f', 'null', '-'])
  const changed = [...out.matchAll(/pts_time:([\d.]+)\s+lavfi\.signalstats\.YAVG=([\d.e-]+)/g)].map(
    m => [Number(m[1]), ((Number(m[2]) / 255) * w * h) / scale ** 2] as [number, number],
  )
  return stillRuns(changed, await durationOf(file))
}

/** Runs of at least `stillMinS` where each frame changes at most `caretPx` CSS px² from the one before, from [second, CSS px² changed] per frame. */
export function stillRuns(changed: [number, number][], duration: number): [number, number][] {
  const spans: [number, number][] = []
  let from: number | undefined
  for (const [t, px] of changed) {
    const previousFrame = Math.max(0, t - 1 / CLIP.fps)
    if (px <= CLIP.caretPx) from ??= previousFrame
    else {
      if (from !== undefined && t - from >= CLIP.stillMinS) spans.push([from, t])
      from = undefined
    }
  }
  if (from !== undefined && duration - from >= CLIP.stillMinS) spans.push([from, duration])
  return spans.map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000])
}

/** The still frames to cut: each still stretch, split where a caption starts, keeps at most `stillMaxS`, or `endHoldS` at the end, plus any `read` hold in it, and each caption keeps `beatMinS`. */
export function squeezePlan(stills: [number, number][], starts: number[], duration: number, holds: [number, number][] = []): [number, number][] {
  const cuts: [number, number][] = []
  for (const [from, to] of stills) {
    const edges = [from, ...starts.filter(s => s > from && s < to), to]
    for (let i = 0; i + 1 < edges.length; i++) {
      const [a, b] = [edges[i], edges[i + 1]]
      const read = Math.max(0, ...holds.filter(([h0, h1]) => h0 < b && h1 > a).map(([, h1]) => h1))
      const keepTo = Math.min(b, Math.max(a + (b >= duration - 0.02 ? CLIP.endHoldS : CLIP.stillMaxS), read))
      if (b - keepTo > 0.05) cuts.push([keepTo, b])
    }
  }
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : duration
    const inside = cuts.filter(([a]) => a >= s && a < end)
    let short = CLIP.beatMinS - (end - s - inside.reduce((n, [a, b]) => n + b - a, 0))
    for (const c of inside.reverse()) {
      if (short <= 0) break
      const back = Math.min(short, c[1] - c[0])
      c[0] += back
      short -= back
    }
  })
  return cuts.filter(([a, b]) => b - a > 0.05).map(([a, b]) => [Math.round(a * 1000) / 1000, Math.round(b * 1000) / 1000] as [number, number])
}

/** Moves each caption earlier by the cut time before it. */
export const shiftBeats = (beats: Beat[], cuts: [number, number][]): Beat[] =>
  beats.map(b => ({ ...b, t: Math.round((b.t - cuts.filter(([, to]) => to <= b.t + 1e-6).reduce((n, [a, c]) => n + c - a, 0)) * 1000) / 1000 }))

/** Drops the cut frames. The frames on either side of a still cut are the same picture, so the cut does not show. */
async function squeeze(raw: string, cuts: [number, number][], out: string) {
  const drop = cuts.map(([a, b]) => `gte(t,${a.toFixed(3)})*lt(t,${b.toFixed(3)})`).join('+')
  await run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-vf', `select='not(${drop})',setpts=N/(${CLIP.fps}*TB)`, '-an', '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', String(CLIP.fps), out])
}

const FOOT_PX = 76

export function captionWindows(beats: Beat[], duration: number): { from: number; to: number; text: string }[] {
  return beats.map((s, i) => ({ from: s.t, to: i + 1 < beats.length ? beats[i + 1].t : Math.max(duration, s.t + CLIP.beatMinS), text: s.text }))
}

// A caption cuts on its action the way subtitles cut on speech (the owner's pick, 2026-11-19; "fade the captions" reverses it).
export function captionOverlay(w: { from: number; to: number }, base: string, img: string, out: string, foot = FOOT_PX): string {
  const f = (n: number) => n.toFixed(3)
  return `[${base}][${img}]overlay=x=(W-w)/2:y=H-${foot}+(${foot}-h)/2:enable='gte(t,${f(w.from)})*lt(t,${f(w.to)})'[${out}]`
}

const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

const KEYCAP = 'display:inline-block;min-width:1.4em;text-align:center;padding:3px 9px 2px;background:#fff;color:#0a0a0a;border:1px solid #d4d4d4;border-bottom-width:3px;border-radius:7px'

// A caption in the page's own colors read as page text and got missed, and the owner picked a black footer over a black pill (2026-11-19).
const FOOT_BG = '#0a0a0a'
const CAPTION = 'display:inline-flex;align-items:center;gap:8px;font:700 26px/1 Inter;color:#fff;padding:2px'
const SIDE = 'display:inline-block;font:700 15px/1 Inter;letter-spacing:0.08em;text-transform:uppercase;color:#a3a3a3;padding:2px'
const SIDE_INSET_PX = 20

/** Which half of a before-and-after clip a take is. */
export type Side = 'Before' | 'After'

export const captionHtml = (text: string) =>
  text
    .split(/(\[[^\]]+\])/)
    .filter(part => part.trim())
    .map(part => (part.startsWith('[') ? `<span style="${KEYCAP}">${esc(part.slice(1, -1))}</span>` : `<span>${esc(part.trim())}</span>`))
    .join('')

/** A title bar: a gray one-word area tag, then what you do. It carries no post number, because the owner may delete a post (2026-11-19). */
export type Bar = { tag: string; title: string }

/** Stacks an optional title bar above the clip and a caption bar below it, with the `side` label at the footer's left, and encodes at 60 fps. Bars draw at the clip's `scale`, so they keep their size beside the page. */
export async function renderClip(
  clip: string,
  out: string,
  { bar, captions = [], scale = 1, side }: { bar?: Bar; captions?: Beat[]; scale?: number; side?: Side } = {},
): Promise<void> {
  if (bar) checkTitle(bar.tag, bar.title)
  captions.forEach(c => checkCaption(c.text))
  const [pixels, duration] = (
    await run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width:format=duration', '-of', 'default=nw=1:nk=1', clip])
  )
    .trim()
    .split('\n')
    .map(Number)
  const width = pixels / scale
  const dir = mkdtempSync(join(tmpdir(), 'clip-'))
  const windows = captionWindows(captions, duration)
  const foot = windows.length > 0 || !!side
  try {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ deviceScaleFactor: scale })
      // Cal Sans crowds its words below heading sizes, and X shows the clip at about phone width, so captions use Inter.
      const face = (family: string, weight: number, file: string) =>
        `@font-face{font-family:${family};font-weight:${weight};src:url(data:font/ttf;base64,${readFileSync(file).toString('base64')})}`
      const style = `<style>${face('Cal', 600, `${ASSETS}/CalSans-SemiBold.ttf`)}${face('Inter', 700, `${ASSETS}/Inter-Bold.ttf`)}body{margin:0;background:transparent}</style>`
      if (foot) {
        await page.setContent(`${style}<div id="foot" style="width:${width}px;height:${FOOT_PX}px;background:${FOOT_BG}"></div>`)
        await page.locator('#foot').screenshot({ path: join(dir, 'foot.png') })
        if (side) {
          await page.setContent(`${style}<div id="side" style="${SIDE}">${side}</div>`)
          await page.evaluate(() => document.fonts.ready)
          await page.locator('#side').screenshot({ path: join(dir, 'side.png'), omitBackground: true })
        }
        for (const [i, w] of windows.entries()) {
          await page.setContent(`${style}<div id="keys" style="${CAPTION}">${captionHtml(w.text)}</div>`)
          await page.evaluate(() => document.fonts.ready)
          await page.locator('#keys').screenshot({ path: join(dir, `keys-${i}.png`), omitBackground: true })
        }
      }
      if (bar) {
        await page.setContent(`${style}
<div id="bar" style="width:${width}px;box-sizing:border-box;padding:22px 40px 18px;background:#fafafa;border-bottom:1px solid #e5e5e5;font:600 ${CLIP.titlePx.max}px/1.1 Cal;color:#0a0a0a;white-space:nowrap;overflow:hidden;display:flex;gap:0.3em"><span style="color:#a3a3a3">${esc(bar.tag)} /</span><span>${esc(bar.title)}</span></div>`)
        const px = await page.evaluate(async ({ min, max }) => {
          await document.fonts.ready
          const el = document.getElementById('bar')!
          for (let size = max; size >= min; size--) {
            el.style.fontSize = `${size}px`
            if (el.scrollWidth <= el.clientWidth) return size
          }
          return 0
        }, CLIP.titlePx)
        if (!px) throw new Error(`title "${bar.title}" does not fit one line at ${CLIP.titlePx.min}px on a ${width}px clip; shorten it`)
        await page.locator('#bar').screenshot({ path: join(dir, 'bar.png') })
      }
    } finally {
      await browser.close()
    }
    const layers = [bar && join(dir, 'bar.png'), clip, foot && join(dir, 'foot.png')].filter((f): f is string => !!f)
    const inputs = layers.flatMap(f => (f === clip ? ['-i', f] : ['-loop', '1', '-i', f]))
    let graph = layers.length > 1 ? `${layers.map((_, i) => `[${i}:v]`).join('')}vstack=inputs=${layers.length}:shortest=1[v0]` : '[0:v]null[v0]'
    windows.forEach((w, i) => {
      inputs.push('-loop', '1', '-i', join(dir, `keys-${i}.png`))
      graph += `;${captionOverlay(w, `v${i}`, `${layers.length + i}:v`, `v${i + 1}`, FOOT_PX * scale)}`
    })
    let last = `v${windows.length}`
    if (side) {
      inputs.push('-loop', '1', '-i', join(dir, 'side.png'))
      const f = FOOT_PX * scale
      graph += `;[${last}][${layers.length + windows.length}:v]overlay=x=${SIDE_INSET_PX * scale}:y=H-${f}+(${f}-h)/2[side]`
      last = 'side'
    }
    // An odd height pads one row under the footer, so it takes the footer's color.
    graph += `;[${last}]pad=ceil(iw/2)*2:ceil(ih/2)*2:color=${foot ? FOOT_BG : '#fafafa'},format=yuv420p`
    await run(['ffmpeg', '-v', 'error', '-y', ...inputs, '-filter_complex', graph, '-t', duration.toFixed(3), '-c:v', 'libx264', '-r', String(CLIP.fps), '-movflags', '+faststart', out])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** A still just before each caption gives way to the next, and one on the last frame, so whoever sends the clip can read what it shows. */
export async function stills(file: string, captions: Beat[], dir: string): Promise<string[]> {
  mkdirSync(dir, { recursive: true })
  const duration = await durationOf(file)
  const times = [...captions.slice(1).map(c => c.t - 0.15), duration - 0.1]
  const files: string[] = []
  for (const [i, t] of times.entries()) {
    const png = join(dir, `${i + 1}.png`)
    await run(['ffmpeg', '-v', 'error', '-y', '-ss', Math.max(0, t).toFixed(3), '-i', file, '-frames:v', '1', png])
    files.push(png)
  }
  return files
}

/** What a viewer gets from a rendered clip. */
export type Signals = { seconds: number; firstMotionS: number; movingPct: number; resultPct: number; textPt?: number }

/** The percent of pixels that differ by more than `threshold` between two gray frames of one size. */
export function changedPct(a: Uint8Array, b: Uint8Array, threshold = CLIP.resultLevel) {
  if (a.length !== b.length) throw new Error(`frames of ${a.length} and ${b.length} pixels do not compare`)
  let n = 0
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > threshold) n++
  return Math.round((100 * n) / (a.length || 1))
}

async function grayFrame(file: string, t: number): Promise<Uint8Array> {
  const cmd = ['ffmpeg', '-v', 'error', '-ss', Math.max(0, t).toFixed(3), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [bytes, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited])
  if (code !== 0 || !bytes.byteLength) throw new Error(`ffmpeg read no frame of ${file} at ${t} s`)
  return new Uint8Array(bytes)
}

/** Reads a clip's signals off the clip before its bars: when something first moves, how much of it moves, and how much its last frame differs from its first. */
export async function clipSignals(clip: string, take: Take): Promise<Signals> {
  const duration = await durationOf(clip)
  const view = take.view ?? CLIP.wide
  const still = await stillStretches(clip, view.scale)
  const width = take.crop ? fitCrop(take.crop, view).w : view.width
  return {
    seconds: tenth(duration),
    firstMotionS: still[0] && still[0][0] < 0.05 ? tenth(still[0][1]) : 0,
    movingPct: Math.round(100 * (1 - still.reduce((n, [a, b]) => n + b - a, 0) / duration)),
    resultPct: changedPct(await grayFrame(clip, 0), await grayFrame(clip, duration - 0.1)),
    ...(take.textPx ? { textPt: phonePt(take.textPx, width) } : {}),
  }
}

export const printReview = ({ fails, fixes, suggests, stills = [], signals }: Review & { stills?: string[]; signals?: Signals }) => {
  for (const f of fails) console.log(`FAIL  ${f}`)
  for (const f of fixes) console.log(`FIXED ${f}`)
  for (const s of suggests) console.log(`TRY   ${s}`)
  if (!fails.length && !fixes.length && !suggests.length) console.log('OK    nothing to fix or try')
  for (const s of stills) console.log(`STILL ${s}`)
  if (signals) {
    const text = signals.textPt ? `, page text at ${signals.textPt} pt on a phone` : ''
    console.log(
      `SIGNALS ${signals.seconds} s, first motion at ${signals.firstMotionS} s, moving ${signals.movingPct}% of the time, the result changes ${signals.resultPct}% of the frame${text}`,
    )
  }
}

/** Reviews a take, refuses it on a FAIL, then cuts and renders it, reviews the file, and writes its stills and its signals.json. */
export async function renderTake(dir: string, out: string, opts: { bar?: Bar; x?: boolean; side?: Side } = {}): Promise<Review & { stills: string[]; signals?: Signals }> {
  const { take, trail } = readTake(dir)
  const raw = join(dir, 'cut.mp4')
  let captions = await cut(take, raw)
  const duration = await durationOf(raw)
  const holds = (take.holds ?? []).map(([a, b]) => [a + CLIP.stillLeadS, b + CLIP.stillLeadS] as [number, number])
  const cuts = squeezePlan(await stillStretches(raw, take.view?.scale), captions.map(c => c.t), duration, holds)
  const review = reviewTake(take, trail, { x: opts.x, cutS: cuts.reduce((n, [a, b]) => n + b - a, 0) })
  if (review.fails.length) return { ...review, stills: [] }
  let clip = raw
  if (cuts.length) {
    clip = join(dir, 'squeezed.mp4')
    await squeeze(raw, cuts, clip)
    captions = shiftBeats(captions, cuts)
    review.fixes.push(`cut ${tenth(cuts.reduce((n, [a, b]) => n + b - a, 0))} s where nothing moved: ${cuts.map(([a, b]) => `${tenth(b - a)} s at ${tenth(a)} s`).join(', ')}`)
  }
  await renderClip(clip, out, { bar: opts.bar, captions, scale: take.view?.scale, side: opts.side })
  review.fails.push(...(await reviewFile(out)))
  const signals = await clipSignals(clip, take)
  await Bun.write(join(dir, 'signals.json'), JSON.stringify(signals, null, 2))
  return { ...review, stills: await stills(out, captions, join(dir, 'stills')), signals }
}

/** What stops two takes from playing as one before-and-after clip: a different page shape or crop would change the frame between the halves. */
export function checkPair(before: Take, after: Take): string[] {
  const shape = (t: Take) => {
    const view = t.view ?? CLIP.wide
    const c = t.crop ? fitCrop(t.crop, view) : undefined
    return `${view.width}x${view.height}@${view.scale}${c ? ` crop ${c.w}x${c.h}` : ''}`
  }
  const [a, b] = [shape(before), shape(after)]
  return a === b ? [] : [`the before take films ${a} and the after take ${b}; film both with the same shape and crop size`]
}

/** Renders the take before a change and the take after it as one clip, each half labeled in its footer, so a reader sees what changed without comparing two images. */
export async function renderCompare(
  before: string,
  after: string,
  out: string,
  opts: { bar?: Bar; x?: boolean } = {},
): Promise<Review & { stills: string[]; signals?: Signals }> {
  const fails = checkPair(readTake(before).take, readTake(after).take)
  if (fails.length) return { fails, fixes: [], suggests: [], stills: [] }
  const halves: [string, Side][] = [
    [before, 'Before'],
    [after, 'After'],
  ]
  const results: (Review & { stills: string[]; signals?: Signals })[] = []
  for (const [dir, side] of halves) results.push(await renderTake(dir, join(dir, 'half.mp4'), { ...opts, side }))
  const label = (side: Side, lines: string[]) => lines.map(l => `${side}: ${l}`)
  const review: Review = {
    fails: results.flatMap((r, i) => label(halves[i][1], r.fails)),
    fixes: results.flatMap((r, i) => label(halves[i][1], r.fixes)),
    suggests: results.flatMap((r, i) => label(halves[i][1], r.suggests)),
  }
  if (review.fails.length) return { ...review, stills: [] }
  const parts = halves.map(([dir]) => join(dir, 'half.mp4'))
  await run(['ffmpeg', '-v', 'error', '-y', ...parts.flatMap(p => ['-i', p]), '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]', '-map', '[v]', '-c:v', 'libx264', '-r', String(CLIP.fps), '-movflags', '+faststart', out])
  review.fails.push(...(await reviewFile(out)))
  const seconds = await durationOf(out)
  if (seconds > CLIP.maxSeconds + 0.05) review.fails.push(`${out} runs ${tenth(seconds)} s, over ${CLIP.maxSeconds} s; shorten either take`)
  return { ...review, stills: results.flatMap(r => r.stills), signals: results[1].signals }
}

const durationOf = async (file: string) => Number((await run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file])).trim())

async function run(cmd: string[]): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  if (code !== 0) throw new Error(`${cmd[0]} exited ${code}: ${err.trim().slice(0, 300)}`)
  return out
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2)
  const flag = (name: string) => {
    const at = args.indexOf(`--${name}`)
    return at === -1 ? undefined : args[at + 1]
  }
  const x = args.includes('--x')
  if (cmd === 'review' && args[0]) {
    const { take, trail } = readTake(args[0])
    const review = reviewTake(take, trail, { x })
    printReview(review)
    process.exit(review.fails.length ? 1 : 0)
  } else if (cmd === 'render' && args[0] && args[1] && !args[1].startsWith('--')) {
    const tag = flag('tag')
    const title = flag('title')
    const before = flag('before')
    const opts = { bar: tag && title ? { tag, title } : undefined, x }
    const review = before ? await renderCompare(before, args[0], args[1], opts) : await renderTake(args[0], args[1], opts)
    printReview(review)
    process.exit(review.fails.length ? 1 : 0)
  } else {
    console.error('usage: bun scripts/clip.ts review <take dir> [--x] | render <take dir> <out.mp4> [--before <take dir>] [--tag <tag> --title <title>] [--x]')
    process.exit(2)
  }
}
