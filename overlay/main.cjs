// TLI Build Planner as a desktop app: the planner (the web UI, served by the planner server) in a
// window, plus an always-on-top overlay over the game. The overlay shows what the log can't tell
// the planner and takes the screenshots that fill it in: it hides itself for the moment of each
// capture so it isn't in the picture. Starts the planner server when it isn't running yet.
//   npm run app
const { app, BrowserWindow, Menu, Tray, globalShortcut, ipcMain, nativeImage, screen, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const BASE = `http://127.0.0.1:${process.env.PORT || 4317}`;
// Each hotkey's accelerators in order of preference: your own choice first (overlay.json "hotkeys",
// set from the mini box's ⚙), then these; the first one free is used (another program may own
// one), and HOTKEYS ends up holding what was actually registered (null if nothing was)
const HOTKEY_CHOICES = {
  capture: ['CommandOrControl+Shift+S', 'CommandOrControl+Alt+S'],
  overlay: ['CommandOrControl+Shift+O', 'CommandOrControl+Alt+O'],
  // Pins and unpins the mini box. Not Ctrl+Shift+T: a global hotkey takes the key from every
  // program, and browsers reopen their last tab with that one
  clickThrough: ['CommandOrControl+Alt+P', 'CommandOrControl+Alt+U', 'CommandOrControl+Shift+U'],
  mini: ['CommandOrControl+Shift+M', 'CommandOrControl+Alt+M'],
};
const HOTKEYS = Object.fromEntries(Object.entries(HOTKEY_CHOICES).map(([name, [first]]) => [name, first]));
const HOTKEY_FNS = {};
const tryRegister = (acc, fn) => {
  try {
    return globalShortcut.register(acc, fn);
  } catch {
    return false; // not an accelerator at all
  }
};
function registerHotkey(name, fn) {
  HOTKEY_FNS[name] = fn;
  const own = typeof saved?.hotkeys?.[name] === 'string' ? [saved.hotkeys[name]] : [];
  for (const acc of [...own, ...HOTKEY_CHOICES[name]]) {
    if (tryRegister(acc, fn)) {
      HOTKEYS[name] = acc;
      return;
    }
  }
  console.log(`hotkey "${name}" unavailable: ${[...own, ...HOTKEY_CHOICES[name]].join(', ')} are all taken by other programs`);
  HOTKEYS[name] = null;
}
// Rebind a hotkey (the mini box's ⚙ asks); the choice is kept in overlay.json. Says what the hotkey
// is afterwards and whether the new one took: another program, or another of these hotkeys, may
// already have it.
function setHotkey(name, acc) {
  const current = HOTKEYS[name] ?? null;
  if (!HOTKEY_FNS[name] || typeof acc !== 'string' || !acc.trim()) return { ok: false, hotkey: current, reason: 'not a key combination' };
  acc = acc.trim();
  if (current === acc) return { ok: true, hotkey: acc };
  if (Object.entries(HOTKEYS).some(([other, a]) => other !== name && a === acc)) return { ok: false, hotkey: current, reason: 'already one of the overlay\'s hotkeys' };
  // Let go of the old one first; it comes back if the new one can't be had
  if (current) globalShortcut.unregister(current);
  if (tryRegister(acc, HOTKEY_FNS[name])) {
    HOTKEYS[name] = acc;
    saved = { ...saved, hotkeys: { ...saved?.hotkeys, [name]: acc } };
    saveState();
    tellState();
    console.log(`hotkey "${name}" is now ${acc}`);
    return { ok: true, hotkey: acc };
  }
  if (current) tryRegister(current, HOTKEY_FNS[name]);
  return { ok: false, hotkey: current, reason: 'taken by another program' };
}
const OVERLAY_SIZE = { width: 380, height: 560 };

const ICON = path.join(__dirname, 'icon.png');
const TRAY_ICON = path.join(__dirname, 'tray.png');

let planner = null; // the full planner window
let overlay = null; // the in-game overlay
let server = null; // the planner server, when this app started it
let tray = null; // the system tray icon: the app lives there; only its Quit ends it
let quitting = false;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const serverUp = () =>
  fetch(`${BASE}/api/status`)
    .then((r) => r.ok)
    .catch(() => false);

// The planner server: use the running one, else start it and wait for it. From the repo that's
// npm run dev; the packaged app runs server/index.js with Electron's own Node (ELECTRON_RUN_AS_NODE)
// against the built UI, keeping its database, screenshots and price caches in the user's app-data
// folder (TLI_DATA_DIR), since the app's own files are read-only.
async function ensureServer() {
  if (await serverUp()) return;
  if (app.isPackaged) {
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', TLI_DATA_DIR: path.join(app.getPath('userData'), 'data'), PORT: String(process.env.PORT || 4317) };
    const serverFile = path.join(ROOT, 'server', 'index.js');
    server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', serverFile, '--prod'], { cwd: ROOT, env, windowsHide: true, stdio: 'ignore' });
  } else {
    server = spawn('npm', ['run', 'dev'], { cwd: ROOT, shell: true, windowsHide: true, stdio: 'ignore' });
  }
  for (let i = 0; i < 120 && !(await serverUp()); i++) await wait(1000);
}

// Where the overlay was left and how: { x, y, width, height, miniWidth, miniHeight, layout,
// clickThrough }. width/height are the full panel's, miniWidth/miniHeight the mini box's. layout:
// 'full' (the panel), 'bar' (minimized to a small bar at the same spot), 'mini' (the compact
// farming box, ETor-style). clickThrough: the window ignores the mouse so the game gets every
// click (mini layout only).
const LAYOUTS = new Set(['full', 'bar', 'mini']);
const BAR_SIZE = { width: 300, height: 56 };
const MINI_SIZE = { width: 320, height: 180 };
const MINI_LIMITS = { minHeight: 48, maxHeight: 900 };
const stateFile = () => path.join(app.getPath('userData'), 'overlay.json');
let saved = null;
let miniGrown = null; // { from, to }: the app made the mini box taller for its content (drops unfolded)
const loadState = () => {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    // Before layouts there was only "collapsed"
    if (s && !LAYOUTS.has(s.layout)) s.layout = s.collapsed ? 'bar' : 'full';
    return s;
  } catch {
    return null;
  }
};
const saveState = () => {
  if (!overlay || overlay.isDestroyed()) return;
  const b = overlay.getBounds();
  const size = saved?.layout === 'full' ? { width: b.width, height: b.height } : saved?.layout === 'mini' ? { miniWidth: b.width, miniHeight: b.height } : {};
  saved = { ...saved, x: b.x, y: b.y, ...size };
  try {
    fs.writeFileSync(stateFile(), JSON.stringify(saved));
  } catch {
    // Remembering the position is a convenience only
  }
};
const layoutSize = (layout) =>
  layout === 'bar'
    ? BAR_SIZE
    : layout === 'mini'
      ? { width: saved?.miniWidth ?? MINI_SIZE.width, height: saved?.miniHeight ?? MINI_SIZE.height }
      : { width: saved?.width ?? OVERLAY_SIZE.width, height: saved?.height ?? OVERLAY_SIZE.height };
const overlayState = () => ({ layout: saved?.layout ?? 'full', clickThrough: !!saved?.clickThrough, hotkeys: HOTKEYS });
const tellState = () => {
  if (overlay && !overlay.isDestroyed()) overlay.webContents.send('overlay:state', overlayState());
  updateTray();
};

function setLayout(layout) {
  if (!overlay || overlay.isDestroyed() || !LAYOUTS.has(layout)) return;
  saveState();
  saved = { ...saved, layout };
  const { x, y } = overlay.getBounds();
  miniGrown = null;
  overlay.setResizable(layout !== 'bar');
  overlay.setBounds({ x, y, ...layoutSize(layout) });
  // Only the mini box is ever click-through; the others need their buttons
  applyClickThrough(layout === 'mini' && !!saved.clickThrough);
  saveState();
  tellState();
}

// The page says how tall the mini box's content is: the window grows when the content needs more
// (the drops unfolded) and goes back to its old height once it doesn't. Its width, and any height
// you drag it to, stay yours.
function fitMini(width, height) {
  const need = Math.round(Math.min(MINI_LIMITS.maxHeight, Math.max(MINI_LIMITS.minHeight, Number(height) || 0)));
  if (!need || !overlay || overlay.isDestroyed() || saved?.layout !== 'mini') return;
  const b = overlay.getBounds();
  if (need > b.height) {
    miniGrown = { from: miniGrown?.from ?? b.height, to: need };
    overlay.setBounds({ x: b.x, y: b.y, width: b.width, height: need });
  } else if (miniGrown && b.height === miniGrown.to && need <= miniGrown.from) {
    overlay.setBounds({ x: b.x, y: b.y, width: b.width, height: miniGrown.from });
    miniGrown = null;
  }
}

// Clicks go to the game, except over the mini box's icons and sliders ("grab zones", rectangles
// the page reports in its own pixels): while pinned the app watches the cursor and takes the mouse
// back whenever it is over one of them, so the pin can always be clicked off. (Electron can forward
// mouse moves to a click-through window, but not reliably, so the cursor is polled instead.)
const GRAB_POLL_MS = 40;
let grabZones = [];
let grabTimer = null;
let grabbed = false;
function applyClickThrough(on) {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setIgnoreMouseEvents(on, { forward: true });
  grabbed = !on;
  if (on && saved?.layout === 'mini' && saved.clickThrough) startGrabWatch();
  else stopGrabWatch();
}
function cursorOverZone() {
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return false;
  const c = screen.getCursorScreenPoint();
  const b = overlay.getContentBounds();
  const x = c.x - b.x;
  const y = c.y - b.y;
  return grabZones.some((z) => x >= z.x && x <= z.x + z.width && y >= z.y && y <= z.y + z.height);
}
function startGrabWatch() {
  if (grabTimer) return;
  grabTimer = setInterval(() => {
    if (!overlay || overlay.isDestroyed() || saved?.layout !== 'mini' || !saved.clickThrough) return stopGrabWatch();
    const over = cursorOverZone();
    if (over === grabbed) return;
    grabbed = over;
    overlay.setIgnoreMouseEvents(!over, { forward: true });
  }, GRAB_POLL_MS);
}
function stopGrabWatch() {
  clearInterval(grabTimer);
  grabTimer = null;
}
// The page's own word that the pointer is over its icons (used when forwarding does work)
function hoverIcons(over) {
  if (saved?.layout !== 'mini' || !saved.clickThrough) return;
  grabbed = over;
  overlay?.setIgnoreMouseEvents(!over, { forward: true });
}
function setClickThrough(on) {
  saved = { ...saved, clickThrough: !!on };
  if (saved.layout !== 'mini' && on) setLayout('mini');
  else {
    applyClickThrough(saved.layout === 'mini' && !!on);
    saveState();
    tellState();
  }
}

function openPlanner() {
  if (!planner || planner.isDestroyed()) createPlanner();
  planner.show();
  planner.focus();
}

function toggleOverlay() {
  if (!overlay || overlay.isDestroyed()) return createOverlay();
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive();
  updateTray();
}

// The tray menu mirrors the overlay's state; closing windows leaves the app here
function updateTray() {
  if (!tray) return;
  const shown = !!overlay && !overlay.isDestroyed() && overlay.isVisible();
  const key = (name) => (HOTKEYS[name] ? HOTKEYS[name].replace('CommandOrControl', 'Ctrl') : undefined);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: shown ? 'Hide overlay' : 'Show overlay', sublabel: key('overlay'), click: toggleOverlay },
      { type: 'separator' },
      { label: 'Compact economy box', type: 'radio', checked: saved?.layout === 'mini', click: () => setLayout('mini') },
      { label: 'Full overlay', type: 'radio', checked: saved?.layout === 'full', click: () => setLayout('full') },
      { label: 'Small bar', type: 'radio', checked: saved?.layout === 'bar', click: () => setLayout('bar') },
      { label: 'Pin: clicks go to the game', sublabel: key('clickThrough'), type: 'checkbox', checked: !!saved?.clickThrough, click: (item) => setClickThrough(item.checked) },
      { type: 'separator' },
      { label: 'Open planner window', click: openPlanner },
      { type: 'separator' },
      {
        label: 'Quit TLI Planner',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
  tray.setToolTip('TLI Build Planner');
  tray.on('click', toggleOverlay);
  tray.on('double-click', openPlanner);
  updateTray();
}

function createPlanner() {
  // Same bridge as the overlay: its capture buttons hide the overlay for the screenshot too
  planner = new BrowserWindow({ width: 1500, height: 950, title: 'TLI Build Planner', icon: ICON, backgroundColor: '#0d0e11', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs') } });
  planner.loadURL(BASE);
  planner.webContents.setWindowOpenHandler(({ url }) => {
    // Screenshots and outside links open outside the app
    shell.openExternal(url);
    return { action: 'deny' };
  });
  planner.on('closed', () => (planner = null));
}

function createOverlay() {
  const area = screen.getPrimaryDisplay().workArea;
  saved = loadState();
  const onScreen = saved && screen.getAllDisplays().some((d) => saved.x >= d.bounds.x && saved.x < d.bounds.x + d.bounds.width && saved.y >= d.bounds.y && saved.y < d.bounds.y + d.bounds.height);
  if (!onScreen) saved = { ...OVERLAY_SIZE, x: area.x + area.width - OVERLAY_SIZE.width - 24, y: area.y + 120, layout: saved?.layout ?? 'full', clickThrough: !!saved?.clickThrough, hotkeys: saved?.hotkeys };
  overlay = new BrowserWindow({
    x: saved.x,
    y: saved.y,
    ...layoutSize(saved.layout),
    frame: false,
    transparent: true,
    resizable: saved.layout !== 'bar',
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false, // clicking it doesn't take focus from the game
    hasShadow: false,
    title: 'TLI Planner overlay',
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs') },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setVisibleOnAllWorkspaces(true);
  overlay.loadURL(`${BASE}/?view=overlay`);
  applyClickThrough(saved.layout === 'mini' && !!saved.clickThrough);
  // Problems in the overlay page show in the app's console
  overlay.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level === 'warning') console.log(`overlay ${e.level}: ${e.message}`);
  });
  overlay.webContents.on('did-fail-load', (e, code, desc) => console.log(`overlay failed to load: ${desc} (${code})`));
  overlay.webContents.on('render-process-gone', (e, d) => console.log(`overlay page crashed: ${d.reason}`));
  overlay.on('moved', saveState);
  overlay.on('resized', saveState);
  // Closing the overlay only hides it (the tray brings it back); Quit is in the tray menu
  overlay.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    overlay.hide();
    updateTray();
  });
  overlay.on('show', updateTray);
  overlay.on('hide', updateTray);
  overlay.on('closed', () => (overlay = null));
}

// A screenshot of the game without the overlay in it: hide, let the screen redraw, capture, show
async function capture(label, reason = 'button') {
  const shown = overlay && !overlay.isDestroyed() && overlay.isVisible();
  if (shown) overlay.hide();
  await wait(180);
  try {
    const res = await fetch(`${BASE}/api/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ label, reason }) });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    return body;
  } finally {
    if (shown && overlay && !overlay.isDestroyed()) overlay.showInactive();
  }
}

ipcMain.handle('overlay:capture', (e, label, reason) => capture(String(label ?? 'Game screen'), reason));
ipcMain.handle('overlay:openPlanner', openPlanner);
ipcMain.handle('overlay:hide', () => {
  overlay?.hide();
  updateTray();
});
ipcMain.handle('overlay:collapse', (e, collapsed) => setLayout(collapsed ? 'bar' : 'full'));
ipcMain.handle('overlay:collapsed', () => saved?.layout === 'bar');
// Also from the planner window: brings the overlay up if it was hidden
ipcMain.handle('overlay:layout', (e, layout) => {
  if (!overlay || overlay.isDestroyed()) createOverlay();
  setLayout(String(layout));
  if (!overlay.isVisible()) overlay.showInactive();
});
ipcMain.handle('overlay:state', () => overlayState());
ipcMain.handle('overlay:clickThrough', (e, on) => setClickThrough(!!on));
ipcMain.handle('overlay:hover', (e, over) => hoverIcons(!!over));
ipcMain.handle('overlay:grabZones', (e, zones) => {
  grabZones = (Array.isArray(zones) ? zones : []).map((z) => ({ x: Number(z.x) || 0, y: Number(z.y) || 0, width: Number(z.width) || 0, height: Number(z.height) || 0 })).filter((z) => z.width > 0 && z.height > 0);
});
ipcMain.handle('overlay:fit', (e, width, height) => fitMini(width, height));
ipcMain.handle('overlay:hotkeys', () => HOTKEYS);
ipcMain.handle('overlay:setHotkey', (e, name, acc) => setHotkey(String(name), acc));
// The overlay never takes the keyboard from the game, except while the page is listening for a new
// hotkey: then it must, for the keys to reach it
ipcMain.handle('overlay:focusable', (e, on) => {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setFocusable(!!on);
  if (on) overlay.focus();
  else overlay.blur();
});

app.setAppUserModelId('tli-build-planner');
app.whenReady().then(async () => {
  await ensureServer();
  createTray();
  createOverlay();
  createPlanner();
  // Capture from inside the game: the overlay picks the label (the screenshot it's asking for)
  registerHotkey('capture', () => overlay?.webContents.send('overlay:hotkeyCapture'));
  registerHotkey('overlay', toggleOverlay);
  registerHotkey('clickThrough', () => setClickThrough(!saved?.clickThrough));
  registerHotkey('mini', () => setLayout(saved?.layout === 'mini' ? 'full' : 'mini'));
  console.log(`hotkeys: ${Object.entries(HOTKEYS).map(([k, v]) => `${k}=${v ?? 'none'}`).join(' ')}`);
  tellState();
});

app.on('before-quit', () => (quitting = true));
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  tray?.destroy();
  // A server this app started stops with it
  if (server) spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true });
});
// With every window closed the app stays in the tray; "Quit TLI Planner" there ends it
app.on('window-all-closed', () => {});
