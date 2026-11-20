---
name: clip
description: Record, check and render a demo clip of a web page, or one before-and-after clip of a change, for a chat message, a team post or a social post. Use before recording any clip of an app, before attaching before and after screenshots of a change (one before-and-after clip replaces them), when a clip looks robotic, shaky, rushed or too polished, and when the owner changes how clips look, move or read.
---

# Clip

One recorder makes every demo clip, `scripts/clip.ts` in this skill's folder, written `<skill dir>` below. It draws a cursor that lands like a hand, sends pointer input on a steady 60 Hz clock, films at 60 fps, and reviews each take before it renders.

## Set up

The recorder runs on Bun and ffmpeg. The first time, and whenever `<skill dir>/scripts/node_modules` is missing, run `bun install --cwd <skill dir>/scripts`, then `bunx --cwd <skill dir>/scripts playwright-core install chromium` if Chromium will not launch.

## Record a clip

1. Write a scene, a Bun script that opens the page, sets it up, films the gesture and finishes. Keep it with the work it shows, such as the run's own folder.

   ```ts
   import { openClip } from '<skill dir>/scripts/clip.ts'

   const clip = await openClip('http://localhost:3000/editor')
   // Setup happens here, through clip.page, and stays out of the clip.
   await clip.place(700, 500)
   await clip.film(process.argv[2])
   clip.beat('Draw a note')
   await clip.click(clip.page.getByRole('button', { name: 'Note' }))
   await clip.drag([300, 200], [470, 310])
   await clip.wait(800)
   console.log(JSON.stringify(await clip.finish({ x: 200, y: 100, w: 600, h: 400 })))
   ```

2. Run `bun <scene>.ts <take dir>`. It writes `clip.webm`, `trail.json` and `take.json` there.
3. Run `bun <skill dir>/scripts/clip.ts review <take dir>` and fix it as Review and fix says.
4. Run `bun <skill dir>/scripts/clip.ts render <take dir> <out.mp4> --tag <tag> --title "<title>"`. The title bar is the clip's headline, a one-word area tag and what you do in a few lowercase words, such as `board / a whiteboard inside your doc`. It refuses a take with a FAIL, cuts it, adds the bars, encodes at 60 fps, reviews the file, and writes one still at the end of each caption into `<take dir>/stills/`, printing a `STILL` line for each. Its `SIGNALS` line, saved as `<take dir>/signals.json`, gives the clip's length, when something first moves, the share of time something moves, how much of the frame the result changes, and the page text's size on a phone.
5. Read every still before the clip goes anywhere.

## Before and after

A change to something a reader already saw, such as a control, a layout, copy, a style or a gesture that behaved wrong, shows as one clip of the old behavior and then the new, not as two images. A feature with nothing before it gets a plain clip.

1. Run the same scene twice with the same shape and crop, once against the code before the change, such as a worktree at the parent commit or the deployed site, and once against the change. Caption what each half shows, such as `Old toolbar` and `New toolbar`. A half where nothing moves holds its result with `read(1500)`, so the viewer can read it.
2. Review both takes, then run `bun <skill dir>/scripts/clip.ts render <after take> <out.mp4> --before <before take>`, with the same bar flags as a plain clip. It labels each half Before or After in its footer, plays them in that order, and refuses two takes whose frames differ in size.
3. Read the stills of both halves.

## Method

These are the parts no check can see.

- Move only through the clip, with `glide`, `drag`, `over`, `press`, `click` and `write`. Playwright's `page.mouse` waits until each move is handled, so a stroke grows in uneven jumps on a smooth video. `page.mouse` and `page.keyboard.type` are for setup before `film()`. During the clip, type with `write` and press keys with `page.keyboard.press`. Hold a modifier through a drag with `keyDown` and `keyUp`, such as Shift for a circle, because a key held with `page.keyboard.down` never reaches the clip's mouse events.
- Call `beat()` as each action starts. Its caption says what you do in a few words, such as `Draw a note`. A keyboard clip shows its keys, such as `[N] [Enter]`, because the video cannot.
- Show the feature where a reader meets it, inside the page or document around it, and crop to the feature and that context.
- Keep it drafty, snappy and straight to the point. Open on the action and end on the result. Add no zoom, frame, wallpaper, motion blur or music. The owner turned down Screen Studio polish and called about 14 s for four beats the pace (2026-11-18), then found long pauses lose the viewer (2026-11-19). Render cuts every still stretch on its own, so a `wait` only paces an action. Where a viewer must read something that just appeared, such as a toast or a label, hold with `read(ms)`, about 1 s for a label and 2 to 3 s for a toast, and render keeps that hold whole.
- Film light mode unless the change is about dark mode. A clip films a 540 by 675 page, X's shape, so lay the scene out for a narrow page and stack the steps down the frame. `{ shape: 'wide' }` films 1100 by 720, only for a clip that answers a question in chat and never goes out as a demo.
- A page behind a sign-in opens with `{ storageState: '<file>' }`, the Playwright storage state the project's own login helper saves.
- Ease a pen stroke with `stroke`, which starts already moving, because the `minimumJerk` curve dwells at the start and pools ink in a blob.
- A clip with no mouse, such as a keyboard clip, opens with `{ cursor: false }`, so no idle cursor sits on the page.
- A demo is one clip for the team chat and for X, so the same file can go out on X later (owner, 2026-11-20). Its title bar repeats the message in chat, and is its headline on X.

## Review and fix

Every take goes through review before anyone sees it, and you fix what it finds without asking.

- `FAIL` lines break a rule. Fix the scene and record again. Never send or show a clip with a FAIL. Each line names its fix.
- `FIXED` lines are what render corrected on its own, such as a caption's capital or a crop's odd side. Fix the scene too, so the next take is clean.
- `TRY` lines would make the clip better. Apply each one that does, and say which you skipped and why.
- Then judge the stills for what no check sees. The frame shows what its caption says, typed text is complete and spelled right, nothing covers the feature, such as a style panel or an open menu, the cursor is off the result on the last frame, and the page around the feature reads.
- Report in a line or two what you fixed and what you would still change. When a rule makes a clip worse, say so and propose the change.

## When the owner changes a rule

The owner's latest word wins over this skill and the code. Change this skill's source repository, never an installed copy, in the same turn:

1. Change the code that enforces it: a value in `CLIP`, a check in `scripts/clip.ts` (`checkTrail`, `checkCaption`, `checkTitle`, `checkPair`, `reviewTake`, `reviewFile`), or the `Clip` method that does the motion. A rule that no code can hold goes in Method above.
2. Put the date and the owner's words in a comment beside the change, such as `(the owner, 2026-11-19)`.
3. Run `bun scripts/rules.ts`. It rewrites the rule list below from `RULES` in `scripts/clip.ts`.
4. Add or change the test in `scripts/clip.test.ts`, then run `bun test` in `scripts/`. `rules.test.ts` fails while this list and the code disagree.
5. A bot that reads `CLIP`'s length and size limits into its own media rules needs a restart after a change to them.

When the owner corrects the same thing a second time, make it a check that fails on the take they corrected, rather than another line in Method.

## Rules

<!-- rules: written by `bun scripts/rules.ts` -->
- Film and render at 60 fps. (`reviewFile` in `scripts/clip.ts`)
- A clip runs at most 20 s and 8 MB. An X clip aims for 16 s or less. (`reviewTake`, `reviewFile` in `scripts/clip.ts`)
- The first caption shows within 0.8 s, so the clip opens on the action. (`reviewTake` in `scripts/clip.ts`)
- Each caption stays up at least 1.2 s. (`reviewTake` in `scripts/clip.ts`)
- Nothing on screen sits still for more than 0.7 s, or 1 s at the end. Render cuts the extra still frames on its own, but never takes a caption under 1.2 s and never cuts a hold the scene marks with `read(ms)`. (`squeezePlan`, `renderTake` in `scripts/clip.ts`)
- A caption is white text on a black footer under the clip, so it never reads as page text. Keys show as white keycaps in it. (`captionHtml`, `renderClip` in `scripts/clip.ts`)
- A caption is a short sentence of at most 6 words with no closing period. It starts with a capital, unless it starts with a [Key]. Render fixes the capital and the period on its own. (`checkCaption`, `fixCaption` in `scripts/clip.ts`)
- A caption switches on as its action starts and off as the next one starts, with no fade. (`captionOverlay` in `scripts/clip.ts`)
- While a button is down, the drawn cursor stays within 0.5 px of the pointer and never turns back on its own. (`checkTrail` in `scripts/clip.ts`)
- The drawn cursor jumps at most 2 px at a press, and turns back at most 3 times on free moves. (`checkTrail` in `scripts/clip.ts`)
- While a button is down, the pointer moves every frame, at most 25 ms apart at the 90th percentile, so a stroke grows smoothly. (`checkTrail` in `scripts/clip.ts`)
- A title bar holds a one-word lowercase tag and a lowercase title of at most 6 words, on one line at 36 px, shrunk down to 24 px to fit. (`checkTitle`, `renderClip` in `scripts/clip.ts`)
- A crop has even sides inside the viewport. Render rounds and clamps it on its own. (`fitCrop` in `scripts/clip.ts`)
- A clip films X's shape, a page 540 px wide and 4:5 tall at 2× pixels, unless it opens with `{ shape: 'wide' }`. Its page text shows at 9 pt or more in a phone's feed, which shows a clip about 312 pt wide. (`openClip`, `reviewTake` in `scripts/clip.ts`)
- Render refuses an X-shape clip without a title bar, so the clip a team chat gets is the one X can post. (`checkBar` in `scripts/clip.ts`)
- A change to something a reader already saw shows as one clip, the take before the change and then the take after it, each half labeled Before or After in its footer. Both takes film the same shape and crop, and the whole clip keeps the length and size limits. (`checkPair`, `renderCompare` in `scripts/clip.ts`)
<!-- /rules -->
