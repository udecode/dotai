const FRAME = { width: 112, height: 1092 / 9 };
const row = (index, count, step, last) => Array.from({ length: count }, (_, column) => ({ row: index, column, ms: column === count - 1 ? last : step }));
const ANIMATIONS = {
  idle: [280, 110, 110, 140, 140, 320].map((ms, column) => ({ row: 0, column, ms: ms * 6 })),
  'running-right': row(1, 8, 120, 220),
  'running-left': row(2, 8, 120, 220),
  waving: row(3, 4, 140, 280),
  jumping: row(4, 5, 140, 280),
  failed: row(5, 8, 140, 240),
  waiting: row(6, 6, 150, 260),
  running: row(7, 6, 120, 220),
  review: row(8, 6, 150, 280),
};

const pet = document.getElementById('pet');
const badge = document.getElementById('badge');
const tray = document.getElementById('tray');
let mood = 'idle';
let dragMood = null;
let hovering = false;
let current = null;
let frame = 0;
let timer = null;

const shown = () => dragMood ?? (hovering && mood === 'idle' ? 'waving' : mood);

function play() {
  const name = shown();
  if (name !== current) {
    current = name;
    frame = 0;
  }
  const frames = ANIMATIONS[current];
  const { row: r, column, ms } = frames[frame % frames.length];
  pet.style.backgroundPosition = `${-column * FRAME.width}px ${-r * FRAME.height}px`;
  frame += 1;
  clearTimeout(timer);
  timer = setTimeout(play, ms);
}

function render(state) {
  mood = state?.mood ?? 'idle';
  const count = state?.badge ?? 0;
  badge.textContent = String(count);
  badge.style.display = count ? 'block' : 'none';
  const counts = state?.counts;
  document.getElementById('summary').textContent = state ? `${counts.needsYou} need you · ${counts.working} working · ${counts.failed} failed` : 'pstack-pulse daemon not reachable';
  const list = document.getElementById('needs');
  list.replaceChildren();
  for (const need of state?.needs ?? []) {
    const item = document.createElement('div');
    item.className = 'need';
    const title = document.createElement('b');
    title.textContent = need.title;
    const meta = document.createElement('small');
    meta.textContent = [need.repo, need.runtime].filter(Boolean).join(' · ');
    const question = document.createElement('p');
    question.textContent = need.question ?? '';
    item.append(title, meta, question);
    for (const [label, url] of [['Open', need.url], ['Plan', need.page]]) {
      if (!url) continue;
      const button = document.createElement('button');
      button.textContent = label;
      button.addEventListener('click', () => window.pulsePet.open(url));
      item.append(button);
    }
    list.append(item);
  }
  if (!state?.needs?.length) {
    const empty = document.createElement('div');
    empty.id = 'empty';
    empty.textContent = 'Nothing needs you.';
    list.append(empty);
  }
}

let press = null;
let dragging = false;
pet.addEventListener('pointerdown', (event) => {
  press = { x: event.screenX, y: event.screenY };
  dragging = false;
  pet.setPointerCapture(event.pointerId);
});
pet.addEventListener('pointermove', (event) => {
  if (!press) return;
  const dx = event.screenX - press.x;
  const dy = event.screenY - press.y;
  if (!dragging && Math.hypot(dx, dy) < 4) return;
  dragging = true;
  if (Math.abs(dx) >= 1) dragMood = dx > 0 ? 'running-right' : 'running-left';
  window.pulsePet.drag(dx, dy);
  press = { x: event.screenX, y: event.screenY };
});
pet.addEventListener('pointerup', () => {
  if (dragging) window.pulsePet.dragEnd();
  else {
    tray.classList.toggle('open');
    window.pulsePet.tray(tray.classList.contains('open'));
  }
  press = null;
  dragging = false;
  dragMood = null;
});
pet.addEventListener('pointerenter', () => { hovering = true; });
pet.addEventListener('pointerleave', () => { hovering = false; });
document.getElementById('quit').addEventListener('click', () => window.pulsePet.quit());

window.pulsePet.onSprite((url) => { pet.style.backgroundImage = `url("${url}")`; });
window.pulsePet.onState(render);
play();
