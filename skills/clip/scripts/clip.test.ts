import { describe, expect, test } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  captionHtml,
  captionOverlay,
  captionWindows,
  changedBox,
  changedPct,
  checkBar,
  checkCaption,
  checkPair,
  checkTitle,
  checkTrail,
  CLIP,
  renderClip,
  alignBeats,
  changedArea,
  renderPair,
  stackLayout,
  sameMotion,
  wipePlan,
  fitCrop,
  openClip,
  fixCaption,
  reviewTake,
  shiftBeats,
  squeezePlan,
  stillRuns,
  stroke,
  type Take,
  type TrailRow,
} from './clip.ts'

const trail = (n: number, at: (i: number) => [number, number, number, number, number]): TrailRow[] =>
  Array.from({ length: n }, (_, i) => [i * (1000 / 60), ...at(i)] as TrailRow)

const take = (captions: Take['captions'], seconds = 10): Take => ({ video: 'clip.webm', startMs: 200, endMs: 200 + seconds * 1000, trailFrom: 0, captions, view: CLIP.x, textPx: 16 })

describe('the cursor trail', () => {
  test('passes a cursor glued to the pointer while held and settling on free moves', () => {
    const t = trail(120, i => (i < 60 ? [0, i * 2 - (i < 50 ? 3 : 0), 0, i * 2, 0] : [1, i * 2, 0, i * 2, 0]))
    expect(checkTrail(t).problems).toEqual([])
  })

  test('fails a spring that diverges while a button is down', () => {
    const t = trail(60, i => [1, i * 3 + (i % 2 ? 9 : -9), 0, i * 3, 0])
    const { problems } = checkTrail(t)
    expect(problems.some(p => p.includes('turned back on its own'))).toBe(true)
    expect(problems.some(p => p.includes('left the pointer'))).toBe(true)
  })

  test('fails a jump at a press', () => {
    const t = trail(20, i => (i < 10 ? [0, 100, 0, 140, 0] : [1, 140, 0, 140, 0]))
    expect(checkTrail(t).problems).toEqual([expect.stringContaining('jumped 40 px at a press')])
  })

  test('fails pointer moves that arrive in uneven jumps while a button is down', () => {
    const t = trail(90, i => [1, Math.floor(i / 3) * 6, 0, Math.floor(i / 3) * 6, 0])
    expect(checkTrail(t).problems).toEqual([expect.stringContaining('50 ms apart')])
  })

  test('skips the setup before filming', () => {
    const t = trail(20, i => (i < 10 ? [0, 100, 0, 140, 0] : [1, 140, 0, 140, 0]))
    expect(checkTrail(t, t[9][0] + 1).problems).toEqual([])
  })
})

describe('a take', () => {
  test('passes the debut pace', () => {
    const r = reviewTake(take([{ t: 0.45, text: 'Draw a note' }, { t: 4.9, text: 'Add a shape' }, { t: 8.2, text: 'Connect them' }, { t: 11, text: 'Sketch with the pen' }], 14.6), [], { x: true })
    expect(r).toEqual({ fails: [], fixes: [], suggests: [] })
  })

  test('fixes a lowercase caption and a closing period on its own', () => {
    const r = reviewTake(take([{ t: 0.4, text: 'draw a note.' }]), [])
    expect(r.fixes).toEqual(['caption "draw a note." renders as "Draw a note"'])
    expect(r.fails).toEqual([])
  })

  test('fails a beat too short to read and a clip too long for a chat upload', () => {
    const r = reviewTake(take([{ t: 0.4, text: 'Draw a note' }, { t: 1, text: 'Add a shape' }], 21), [])
    expect(r.fails).toEqual([expect.stringContaining('runs 21.2 s'), expect.stringContaining('"Draw a note" shows for 0.6 s')])
  })

  test('cuts a long still stretch down, splitting it where a caption starts', () => {
    // The popover clip: the popover sat open for 2.2 s, across the start of the next caption at 3.1 s.
    expect(squeezePlan([[1.1, 3.3]], [0.2, 3.1, 5.9], 9)).toEqual([[1.5, 3.1]])
  })

  test('keeps each caption up long enough to read', () => {
    expect(squeezePlan([[0.3, 1.5]], [0.2, 1.5], 4)).toEqual([[1.4, 1.5]])
  })

  test('holds the last frame a little longer than a still in the middle', () => {
    expect(squeezePlan([[7.5, 10]], [0.2, 4], 10)).toEqual([[8.1, 10]])
    expect(squeezePlan([[2, 2.3]], [0.2], 6)).toEqual([])
  })

  test('ends each take of a before-and-after clip sooner, since the clip then holds both results', () => {
    expect(squeezePlan([[7.5, 10]], [0.2, 4], 10, [], CLIP.compareEndS)).toEqual([[7.9, 10]])
  })

  test('keeps a read hold whole, such as a toast at the end', () => {
    // The table clip's refusal toast lost 2.4 s of reading time to the end hold before read() existed.
    expect(squeezePlan([[11.4, 14]], [0.2, 9], 14, [[11.4, 13.4]])).toEqual([[13.4, 14]])
    expect(squeezePlan([[11.4, 14]], [0.2, 9], 14)).toEqual([[12, 14]])
  })

  test('moves later captions back by the time cut before them', () => {
    expect(shiftBeats([{ t: 0.2, text: 'A' }, { t: 3.1, text: 'B' }, { t: 5.9, text: 'C' }], [[1.8, 3.1], [5, 5.5]])).toEqual([
      { t: 0.2, text: 'A' },
      { t: 1.8, text: 'B' },
      { t: 4.1, text: 'C' },
    ])
  })

  test('judges the length after the still cut, and each caption on the filmed clock', () => {
    const r = reviewTake(take([{ t: 0.4, text: 'Draw a note' }, { t: 15, text: 'Connect them' }], 17), [], { x: true, cutS: 4 })
    expect(r).toEqual({ fails: [], fixes: [], suggests: [] })
  })

  test('fails an X clip whose page text is too small to read on a phone', () => {
    const wide = { ...take([{ t: 0.4, text: 'Delete the whole table' }]), view: CLIP.wide, crop: { x: 0, y: 0, w: 1100, h: 720 } }
    expect(reviewTake(wide, [], { x: true }).fails).toEqual([expect.stringContaining('shows at 4.5 pt')])
    expect(reviewTake(wide, []).fails).toEqual([])
    expect(reviewTake({ ...wide, textPx: undefined }, [], { x: true }).suggests).toEqual([expect.stringContaining('no text size')])
  })

  test('judges an X-shape take at the X pace without being asked', () => {
    const long = take([{ t: 0.4, text: 'Draw a note' }, { t: 15, text: 'Connect them' }], 17)
    expect(reviewTake(long, []).suggests).toEqual([expect.stringContaining('an X clip reads best')])
    expect(reviewTake({ ...long, view: CLIP.wide }, []).suggests).toEqual([])
  })

  test('refuses an X-shape clip without a title bar, so the chat clip is the one X can post', () => {
    const one = take([{ t: 0.4, text: 'Draw a note' }])
    expect(checkBar(one)).toEqual([expect.stringContaining('needs a title bar')])
    expect(checkBar(one, { tag: 'board', title: 'notes in your doc' })).toEqual([])
    expect(checkBar({ ...one, view: CLIP.wide })).toEqual([])
  })

  test('counts typing as motion and a blinking caret as still', () => {
    // Measured changes per frame on the board clips: a caret blink and a typed letter.
    const caret = 30
    const letter = 90
    const letters = [20, 24, 28, 32, 36]
    const frameAt = (i: number) => (i + 1) / 60
    const ms = (s: number) => Math.round(s * 1000) / 1000
    const changed = Array.from({ length: 60 }, (_, i): [number, number] => [frameAt(i), i === 10 ? caret : letters.includes(i) ? letter : 0])
    expect(stillRuns(changed, 1)).toEqual([[0, ms(frameAt(letters[0]))], [ms(frameAt(letters.at(-1)!)), 1]])
  })

  test('measures how much of the frame the result changed', () => {
    const before = new Uint8Array(100).fill(250)
    const after = before.slice()
    after.fill(233, 0, 10)
    after.fill(247, 10, 20)
    expect(changedPct(before, after)).toBe(10)
  })

  test('suggests opening on the action and a shorter X clip', () => {
    const r = reviewTake(take([{ t: 2, text: 'Draw a note' }], 17), [], { x: true })
    expect(r.suggests).toEqual([expect.stringContaining('an X clip reads best'), expect.stringContaining('the first caption shows at 2.2 s')])
  })
})

describe('a before-and-after pair', () => {
  const at = (crop?: Take['crop'], view = CLIP.wide): Take => ({ ...take([{ t: 0, text: 'Open the menu' }]), view, crop })

  test('plays as one clip when both takes film the same shape and crop size', () => {
    expect(checkPair(at({ x: 0, y: 0, w: 600, h: 400 }), at({ x: 40, y: 20, w: 600, h: 400 }))).toEqual([])
  })

  test('refuses takes whose frames differ, naming both sizes', () => {
    expect(checkPair(at({ x: 0, y: 0, w: 600, h: 400 }), at({ x: 0, y: 0, w: 640, h: 400 }))).toEqual([
      'the before take films 1100x720@1 crop 600x400 and the after take 1100x720@1 crop 640x400; film both with the same shape and crop size',
    ])
    expect(checkPair(at(undefined, CLIP.wide), at(undefined, CLIP.x))).toHaveLength(1)
  })

  test('refuses takes with different beats, which leave nothing to line them up by', () => {
    const one = take([{ t: 0, text: 'Bold it' }])
    const two = take([{ t: 0, text: 'Bold it' }, { t: 2, text: 'Undo it' }])
    expect(checkPair(one, two)).toEqual(['the before take has 1 captions and the after take 2; caption the same beats in both, so they play in step'])
  })

  test('lines both takes up caption by caption, holding the shorter one', () => {
    const { plan, starts, frames } = alignBeats([[12, 100], [12, 160]], [200, 220], 30)
    expect(starts).toEqual([12, 160])
    expect(frames).toEqual(12 + 148 + 100 + 30)
    expect(plan[0]).toEqual([[0, 12, 0], [12, 100, 60], [100, 200, 30]])
    expect(plan[1]).toEqual([[0, 12, 0], [12, 160, 0], [160, 220, 70]])
    for (const spans of plan) expect(spans.reduce((n, [a, b, held]) => n + b - a + held, 0)).toBe(frames)
  })

  test('crops to the changed area, fills the width the rail leaves as far as the pixels allow and keeps the clip inside 9:16', () => {
    const { width, height } = CLIP.x
    const room = width - 8 - 4
    const tallest = width * (16 / 9) - 80 - 76
    const line = stackLayout({ x: 100, y: 300, w: 300, h: 20 }, width, height, 2)
    expect(line.k).toBeCloseTo(room / 332)
    expect(line.panel.w).toBeCloseTo(room)
    expect(line.crop.h).toBeCloseTo(height / 4)
    const narrow = stackLayout({ x: 200, y: 300, w: 60, h: 20 }, width, height, 2)
    expect([narrow.k, narrow.crop.w, narrow.panel.w]).toEqual([2, room / 2, room])
    const page = stackLayout(undefined, width, height, 2)
    expect(page.panel.h * 2 + 2).toBeLessThanOrEqual(tallest + 1e-6)
    expect(stackLayout({ x: 0, y: 0, w: 500, h: 600 }, width, height, 2).panel.h * 2 + 2).toBeLessThanOrEqual(tallest + 1e-6)
    expect(page.crop.h).toBe(height)
  })

  test('a wipe plays the before take once and wipes to each differing result, back before the next step, and ends on the after result', () => {
    const { pieces, starts } = wipePlan([[0, 100], [0, 120]], [200, 220], [false, true, true], 24, 72)
    expect(pieces).toEqual([
      { play: 0, from: 0, to: 100 },
      { wipe: [0, 99, 1, 119], frames: 24 },
      { hold: 1, at: 119, frames: 72 },
      { wipe: [1, 119, 0, 99], frames: 24 },
      { play: 0, from: 100, to: 200 },
      { wipe: [0, 199, 1, 219], frames: 24 },
      { hold: 1, at: 219, frames: 72 },
    ])
    expect(starts).toEqual([0, 220])
    expect(wipePlan([[0], [0]], [100, 100], [false, false], 24, 72).pieces.at(-1)).toEqual({ hold: 0, at: 99, frames: 72 })
  })

  test('takes move the same when they differ only in timing or in what a step leaves, and not when a gesture shows something the other never does', () => {
    const size = 64
    const frame = (...blocks: [number, number, number][]) => {
      const f = new Uint8Array(size * size * 3).fill(255)
      for (const [x0, y0, n] of blocks) for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) f.fill(0, 3 * (y * size + x), 3 * (y * size + x) + 3)
      return f
    }
    const menu: [number, number, number] = [4, 4, 30]
    const before = [frame(), frame(menu), frame(menu), frame([34, 34, 28])]
    const after = [frame(), frame(), frame(menu), frame([34, 34, 20])]
    const steps: [[number, number][], [number, number][]] = [[[0, 4]], [[0, 4]]]
    expect(sameMotion([before, after], steps, size, size)).toBe(true)
    const wrong = [frame(), frame([4, 30, 30]), frame(menu), frame([34, 34, 28])]
    expect(sameMotion([wrong, after], steps, size, size)).toBe(false)
  })

  test('an X clip with its bars is 2:3', () => {
    expect((CLIP.x.height + 80 + 76) / CLIP.x.width).toBe(3 / 2)
  })

  test('finds what changes during either take, not just at the end, and ignores the moving cursor', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-area-'))
    const clip = (name: string, boxes: string) => {
      const file = join(dir, `${name}.mp4`)
      Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', `color=c=white:s=540x400:d=2${boxes}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file])
      return file
    }
    // A menu that opens and closes in the before take, and a cursor-sized square that moves in both.
    const cursor = ",drawbox=x='20+100*t':y=20:w=20:h=24:color=black:t=fill"
    const before = clip('before', `${cursor},drawbox=x=60:y=200:w=300:h=80:color=black:t=fill:enable='between(t,0.5,1)'`)
    const after = clip('after', cursor)
    const box = (await changedArea([before, after], 1))!
    expect(box.y).toBeGreaterThan(180)
    expect(box.y + box.h).toBeLessThan(300)
    expect(box.x).toBeLessThan(70)
    expect(box.x + box.w).toBeGreaterThan(350)
  }, 60_000)

  test('stacks a before still above an after still, cropped to where they differ', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-pair-'))
    const still = (name: string, boxes: string) => {
      const file = join(dir, `${name}.png`)
      Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', `color=c=white:s=800x600${boxes}`, '-frames:v', '1', file])
      return file
    }
    const before = still('before', ',drawbox=x=100:y=400:w=200:h=30:color=gray:t=fill')
    const after = still('after', ',drawbox=x=100:y=400:w=200:h=30:color=black:t=fill')
    const out = join(dir, 'pair.png')
    expect((await renderPair([before, after], out)).fails).toEqual([])
    const [w, h] = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out]).stdout.toString().trim().split(',').map(Number)
    expect(w).toBe(400)
    // Each panel is 150 px of page under a strip that holds its badge.
    expect(h).toBeGreaterThan(2 * 150 + 8 + 2 * 20)
    expect(h).toBeLessThan(2 * 150 + 8 + 2 * 60)
    expect((await renderPair([before, before], out)).fails[0]).toContain('show the same thing')
    const other = join(dir, 'other.png')
    Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=640x480', '-frames:v', '1', other])
    expect((await renderPair([before, other], out)).fails[0]).toContain('take both at one size')
  }, 60_000)
})

describe('captions and bars', () => {
  test('captions are short sentences with keycaps', () => {
    expect(() => checkCaption('Hold [Shift] for a circle')).not.toThrow()
    expect(() => checkCaption('[Enter] type')).not.toThrow()
    expect(() => checkCaption('draw a note')).toThrow('starts with a capital')
    expect(() => checkCaption('Draw a note.')).toThrow('without a period')
    expect(() => checkCaption('Draw a note then type a long label in it')).toThrow(`more than ${CLIP.captionWords} words`)
    expect(fixCaption(' sketch with the pen. ')).toBe('Sketch with the pen')
    expect(captionHtml('Hold [Shift] for a circle').match(/border-radius/g)).toHaveLength(1)
    expect(captionHtml('[N] [Enter]').match(/border-radius/g)).toHaveLength(2)
  })

  test('shows each caption until the next, and the last one long enough to read', () => {
    const w = captionWindows([{ t: 0.5, text: 'Draw a note' }, { t: 2, text: '[R]' }, { t: 7.9, text: '[Esc]' }], 8)
    expect(w.map(x => [x.from, x.to])).toEqual([[0.5, 2], [2, 7.9], [7.9, 9.1]])
  })

  test('cuts from one caption to the next with no frame showing both', () => {
    const f = captionOverlay({ from: 2, to: 4 }, 'v0', '3:v', 'v1')
    expect(f).toContain("enable='gte(t,2.000)*lt(t,4.000)'")
    expect(f).not.toContain('fade')
  })

  test('titles are lowercase and short', () => {
    expect(() => checkTitle('board', 'draw it the size you drag')).not.toThrow()
    expect(() => checkTitle('Board', 'draw it')).toThrow('one lowercase word')
    expect(() => checkTitle('board', 'Draw It')).toThrow('lowercase')
    expect(() => checkTitle('board', 'one two three four five six seven')).toThrow(`${CLIP.titleWords} words`)
  })

  test('rounds a crop to even sides inside the viewport', () => {
    expect(fitCrop({ x: -3, y: 11, w: 1201, h: 401 })).toEqual({ x: 0, y: 12, w: 1100, h: 400 })
  })

  test('a pen stroke starts moving and lands on its end', () => {
    expect(stroke(0)).toBe(0)
    expect(stroke(1)).toBeCloseTo(1)
    expect(stroke(0.05)).toBeGreaterThan(0.02)
  })
})

describe('the title bar', () => {
  test('shrinks a long title until it fits one line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-bar-'))
    const clip = join(dir, 'page.mp4')
    Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=540x400:d=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
    expect((await renderClip(clip, join(dir, 'long.mp4'), { bar: { tag: 'markdown', title: 'keep your yaml front matter intact' } })).titlePx).toBeLessThan(CLIP.titlePx.max)
    expect((await renderClip(clip, join(dir, 'short.mp4'), { bar: { tag: 'board', title: 'notes' } })).titlePx).toBe(CLIP.titlePx.max)
  }, 60_000)

  test('hides a parked cursor, fades it once it rests and shows it again as it moves', async () => {
    const clip = await openClip('data:text/html,<body></body>')
    const opacity = () => clip.page.evaluate(() => Number([...document.documentElement.children].find(el => el.querySelector('svg'))!.style.opacity))
    try {
      await clip.place(60, 60)
      await clip.page.waitForTimeout(150)
      expect(await opacity()).toBe(0)
      await clip.page.mouse.move(100, 100)
      await clip.page.mouse.move(200, 200, { steps: 10 })
      await clip.page.waitForTimeout(150)
      expect(await opacity()).toBeGreaterThan(0.9)
      await clip.page.waitForTimeout((CLIP.cursorIdleS + CLIP.cursorFadeS) * 1000 + 300)
      expect(await opacity()).toBe(0)
      await clip.page.mouse.move(260, 260, { steps: 10 })
      await clip.page.waitForTimeout(150)
      expect(await opacity()).toBeGreaterThan(0.9)
    } finally {
      await clip.page.context().browser()!.close()
    }
  }, 30_000)

  test('a moved cursor does not widen the changed area', () => {
    const [w, h] = [100, 100]
    const before = new Uint8Array(w * h * 3).fill(255)
    const after = before.slice()
    const paint = (x0: number, y0: number, bw: number, bh: number) => {
      for (let y = y0; y < y0 + bh; y++) after.fill(0, 3 * (y * w + x0), 3 * (y * w + x0 + bw))
    }
    paint(10, 20, 60, 6)
    paint(90, 90, 2, 2)
    expect(changedBox(before, after, w, h)).toEqual({ x: 6, y: 16, w: 68, h: 14 })
  })
})
