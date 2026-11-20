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
  endLayout,
  renderEndPage,
  renderPush,
  fitCrop,
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
    expect(squeezePlan([[1.1, 3.3]], [0.2, 3.1, 5.9], 9)).toEqual([[1.8, 3.1]])
  })

  test('keeps each caption up long enough to read', () => {
    expect(squeezePlan([[0.3, 1.5]], [0.2, 1.5], 4)).toEqual([[1.4, 1.5]])
  })

  test('holds the last frame a little longer than a still in the middle', () => {
    expect(squeezePlan([[7.5, 10]], [0.2, 4], 10)).toEqual([[8.5, 10]])
    expect(squeezePlan([[2, 2.6]], [0.2], 6)).toEqual([])
  })

  test('keeps a read hold whole, such as a toast at the end', () => {
    // The table clip's refusal toast lost 2.4 s of reading time to the end hold before read() existed.
    expect(squeezePlan([[11.4, 14]], [0.2, 9], 14, [[11.4, 13.4]])).toEqual([[13.4, 14]])
    expect(squeezePlan([[11.4, 14]], [0.2, 9], 14)).toEqual([[12.4, 14]])
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
  test('shrinks a long title until it fits one line with its badge, at the same size on both halves', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-bar-'))
    const clip = join(dir, 'page.mp4')
    Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=white:s=540x400:d=0.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
    const bar = { tag: 'markdown', title: 'keep your yaml front matter intact' }
    const before = await renderClip(clip, join(dir, 'before.mp4'), { bar, side: 'Before' })
    const after = await renderClip(clip, join(dir, 'after.mp4'), { bar, side: 'After' })
    expect(before.titlePx).toBeLessThan(CLIP.titlePx.max)
    expect(after.titlePx).toBe(before.titlePx)
    expect((await renderClip(clip, join(dir, 'short.mp4'), { bar: { tag: 'board', title: 'notes' } })).titlePx).toBe(CLIP.titlePx.max)
    await expect(renderClip(clip, join(dir, 'none.mp4'), { side: 'After' })).rejects.toThrow('needs a title bar')
    expect((await renderClip(clip, join(dir, 'end.mp4'), { bar, badgeRoom: true })).titlePx).toBe(before.titlePx)
  }, 60_000)

  test('ends a before-and-after clip on both last frames, moving there from the After frame without a cut', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-end-'))
    const pages = ['white', 'gray'].map(c => {
      const page = join(dir, `${c}.mp4`)
      Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=540x400:d=0.3`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', page])
      return page
    }) as [string, string]
    const out = join(dir, 'end.mp4')
    await renderEndPage(pages, out)
    const probe = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'default=nw=1:nk=1', out]).stdout.toString().trim().split('\n').map(Number)
    expect(probe.slice(0, 2)).toEqual([540, 400])
    expect(probe[2]).toBeCloseTo(CLIP.compareHoldS, 1)
    const gray = (seek: string[]) => Bun.spawnSync(['ffmpeg', '-v', 'error', ...seek, '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout[0]
    const after = Bun.spawnSync(['ffmpeg', '-v', 'error', '-i', pages[1], '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout[0]
    expect(Math.abs(gray([]) - after)).toBeLessThan(3)
    expect(gray(['-sseof', '-0.1']) - after).toBeGreaterThan(40)
  }, 60_000)

  test('ends on the area that changed, at its own size, so a phone can read it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-end-'))
    const pages = ['', ',drawbox=x=70:y=100:w=400:h=40:color=black:t=fill'].map((box, i) => {
      const page = join(dir, `${i}.mp4`)
      Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', `color=c=white:s=540x400:d=0.3${box}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', page])
      return page
    }) as [string, string]
    const out = join(dir, 'end.mp4')
    await renderEndPage(pages, out)
    const last = Bun.spawnSync(['ffmpeg', '-v', 'error', '-sseof', '-0.1', '-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout
    // The whole page side by side would show the 400 by 40 bar at under half its size, about 3,400 dark pixels.
    expect(last.filter(v => v < 64).length).toBeGreaterThan(12_000)
  }, 60_000)

  test('slides the footer the After half ends on out of the end, so the panels take its height', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-end-'))
    const pages = ['white', 'gray'].map(c => {
      const page = join(dir, `${c}.mp4`)
      Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=540x400:d=0.3`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', page])
      return page
    }) as [string, string]
    const out = join(dir, 'end.mp4')
    await renderEndPage(pages, out, { caption: 'Draw a note' })
    const size = Bun.spawnSync(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out]).stdout.toString().trim()
    expect(size).toBe('540,476')
    const footLuma = (seek: string[]) =>
      Bun.spawnSync(['ffmpeg', '-v', 'error', ...seek, '-i', out, '-frames:v', '1', '-vf', 'crop=540:60:0:410,scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout[0]
    expect(footLuma([])).toBeLessThan(40)
    expect(footLuma(['-sseof', '-0.1'])).toBeGreaterThan(100)
  }, 60_000)

  test('puts the badges to the left of stacked panels when a badge row would shrink them', () => {
    const badge: [number, number] = [93, 28]
    const tall = endLayout({ x: 0, y: 0, w: 270, h: 152 }, 540, 400, badge)
    expect([tall.row, tall.left, tall.k]).toEqual([false, true, 1])
    const strip = endLayout({ x: 0, y: 0, w: 540, h: 150 }, 540, 675, badge)
    expect([strip.row, strip.left]).toEqual([false, false])
    expect(endLayout({ x: 0, y: 0, w: 270, h: 100 }, 540, 675, badge, 2).k).toBeGreaterThan(1.5)
  })

  test('pushes the After page in from the right without a cut', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clip-push-'))
    const pages = ['white', 'black'].map(c => {
      const page = join(dir, `${c}.mp4`)
      Bun.spawnSync(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${c}:s=540x400:d=0.3`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', page])
      return page
    }) as [string, string]
    const out = join(dir, 'push.mp4')
    await renderPush(pages, true, out)
    const duration = Number(Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).stdout.toString())
    expect(duration).toBeCloseTo(CLIP.pushS, 1)
    const luma = (seek: string[], crop = 'iw:ih:0:0') =>
      Bun.spawnSync(['ffmpeg', '-v', 'error', ...seek, '-i', out, '-frames:v', '1', '-vf', `crop=${crop},scale=1:1`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']).stdout[0]
    expect(luma([])).toBeGreaterThan(240)
    expect(luma(['-sseof', '-0.02'])).toBeLessThan(15)
    const mid = ['-ss', '0.1']
    expect(luma(mid, '60:400:0:0')).toBeGreaterThan(200)
    expect(luma(mid, '60:400:480:0')).toBeLessThan(60)
  }, 60_000)

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
