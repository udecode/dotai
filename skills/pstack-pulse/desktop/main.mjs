import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOME = join(homedir(), '.pstack-pulse');
const SPRITE_URL = 'https://persistent.oaistatic.com/codex/pets/v1/codex-spritesheet-v4.webp';
const SPRITE = join(HOME, 'pets', 'codex-spritesheet-v4.webp');
const BOUNDS = join(HOME, 'pet-bounds.json');
const HERE = dirname(fileURLToPath(import.meta.url));
const PET = { width: 150, height: 150 };
const TRAY = { width: 320, height: 400 };
const OPENABLE = /^(https|claude|chatgpt):/u;

if (!app.requestSingleInstanceLock()) app.quit();
app.dock?.hide();

let win;
let trayOpen = false;

function startBounds() {
  try {
    return { ...JSON.parse(readFileSync(BOUNDS, 'utf8')), ...PET };
  } catch {
    const { workArea } = screen.getPrimaryDisplay();
    return { x: workArea.x + workArea.width - PET.width - 24, y: workArea.y + workArea.height - PET.height - 24, ...PET };
  }
}

async function spriteUrl() {
  if (!existsSync(SPRITE)) {
    mkdirSync(dirname(SPRITE), { recursive: true });
    const response = await fetch(SPRITE_URL);
    if (!response.ok) throw new Error(`sprite download failed: ${response.status}`);
    writeFileSync(SPRITE, Buffer.from(await response.arrayBuffer()));
  }
  return `data:image/webp;base64,${readFileSync(SPRITE).toString('base64')}`;
}

async function poll() {
  try {
    const { listPort, secret } = JSON.parse(readFileSync(join(HOME, 'config.json'), 'utf8'));
    const response = await fetch(`http://127.0.0.1:${listPort}/${secret}/state.json`);
    win.webContents.send('state', response.ok ? await response.json() : null);
  } catch {
    win.webContents.send('state', null);
  }
}

function resize(open) {
  const bounds = win.getBounds();
  const size = open ? TRAY : PET;
  win.setBounds({ x: bounds.x + bounds.width - size.width, y: bounds.y + bounds.height - size.height, ...size });
}

app.whenReady().then(async () => {
  win = new BrowserWindow({
    ...startBounds(),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    type: 'panel',
    backgroundColor: '#00000000',
    webPreferences: { preload: join(HERE, 'preload.cjs') },
  });
  if (process.argv.includes('--snapshot')) win.webContents.on('console-message', (details) => console.log(`page ${details.level}: ${details.message}`));
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await win.loadFile(join(HERE, 'index.html'));
  win.webContents.send('sprite', await spriteUrl());
  await poll();
  setInterval(poll, 2000);
  if (process.argv.includes('--snapshot')) setTimeout(snapshot, 3000);
});

async function snapshot() {
  writeFileSync(join(HOME, 'pet-snapshot.png'), (await win.webContents.capturePage()).toPNG());
  await win.webContents.executeJavaScript("document.getElementById('tray').classList.add('open')");
  trayOpen = true;
  resize(true);
  await new Promise((resolve) => setTimeout(resolve, 500));
  writeFileSync(join(HOME, 'pet-snapshot-tray.png'), (await win.webContents.capturePage()).toPNG());
  writeFileSync(join(HOME, 'pet-snapshot.json'), JSON.stringify({ bounds: win.getBounds(), onTop: win.isAlwaysOnTop(), allSpaces: win.isVisibleOnAllWorkspaces(), visible: win.isVisible() }));
  app.quit();
}

ipcMain.on('drag', (_event, dx, dy) => {
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.on('drag-end', () => {
  const bounds = win.getBounds();
  const pet = trayOpen ? { x: bounds.x + bounds.width - PET.width, y: bounds.y + bounds.height - PET.height } : { x: bounds.x, y: bounds.y };
  writeFileSync(BOUNDS, JSON.stringify(pet));
});
ipcMain.on('tray', (_event, open) => {
  trayOpen = open;
  resize(open);
});
ipcMain.on('open', (_event, url) => {
  if (OPENABLE.test(url ?? '')) shell.openExternal(url);
});
ipcMain.on('quit', () => app.quit());
