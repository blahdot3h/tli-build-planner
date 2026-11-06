import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import Overlay from './components/Overlay.jsx';
import './styles.css';

// ?view=overlay: the compact in-game overlay (the desktop app's always-on-top window)
const overlay = new URLSearchParams(location.search).get('view') === 'overlay';
if (overlay) document.documentElement.classList.add('overlay-mode');

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {overlay ? <Overlay /> : <App />}
  </StrictMode>,
);
