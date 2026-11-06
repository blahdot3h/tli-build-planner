// What the overlay page can ask the app for (window.overlayApp): screenshots without the overlay in
// them, opening the full planner window, hiding, its layout (full panel / small bar / mini farming
// box), click-through for the mini box, and the hotkeys
const { contextBridge, ipcRenderer } = require('electron');

const subscribe = (channel, fn) => {
  const listener = (e, ...args) => fn(...args);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
};

contextBridge.exposeInMainWorld('overlayApp', {
  capture: (label, reason) => ipcRenderer.invoke('overlay:capture', label, reason),
  openPlanner: () => ipcRenderer.invoke('overlay:openPlanner'),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  // Minimized to a small bar, or back to the full panel; collapsed() says which it was left as
  collapse: (collapsed) => ipcRenderer.invoke('overlay:collapse', collapsed),
  collapsed: () => ipcRenderer.invoke('overlay:collapsed'),
  // 'full' | 'bar' | 'mini'; state() = { layout, clickThrough, hotkeys }
  layout: (layout) => ipcRenderer.invoke('overlay:layout', layout),
  state: () => ipcRenderer.invoke('overlay:state'),
  // The mini box lets clicks through to the game (its hotkey turns it back)
  clickThrough: (on) => ipcRenderer.invoke('overlay:clickThrough', on),
  // While pinned: the pointer is over the box's icons (true) or has left them (false)
  hover: (over) => ipcRenderer.invoke('overlay:hover', over),
  // The parts of the pinned box that must stay clickable, as [{ x, y, width, height }] in page pixels
  grabZones: (zones) => ipcRenderer.invoke('overlay:grabZones', zones),
  // The mini box's content size, so the window hugs it
  fit: (width, height) => ipcRenderer.invoke('overlay:fit', width, height),
  hotkeys: () => ipcRenderer.invoke('overlay:hotkeys'),
  // Rebind one ('clickThrough', 'mini', …) to an Electron accelerator; { ok, hotkey, reason? }
  setHotkey: (name, accelerator) => ipcRenderer.invoke('overlay:setHotkey', name, accelerator),
  // Let the overlay take the keyboard (true) while the page listens for a new hotkey, and give it back (false)
  focusable: (on) => ipcRenderer.invoke('overlay:focusable', on),
  // Return the unsubscribe
  onHotkeyCapture: (fn) => subscribe('overlay:hotkeyCapture', () => fn()),
  onState: (fn) => subscribe('overlay:state', fn),
});
