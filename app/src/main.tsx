import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { captureConsole } from './core/log';
import { platform } from './platform';
import { isTypingTarget, keyString } from './ui/hotkeys';
import { closeProject } from './state/project';
import { flushSettings, loadSettings } from './state/settings';
import { App } from './ui/App';
// Story node kinds join the canvas before any graph is opened.
import './story/kinds';
import './ui/theme/tokens.css';

// Browser shortcuts that make no sense in a desktop application (reload, print, find in page, view source).
const BLOCKED_KEYS = new Set(['F5', 'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+P', 'Ctrl+F', 'Ctrl+G', 'Ctrl+U', 'Ctrl+J']);

function blockBrowserBehaviour(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (BLOCKED_KEYS.has(keyString(e))) e.preventDefault();
    },
    true,
  );
  // The WebView's own menu (Back, Reload, Inspect) is hidden; text fields keep cut/copy/paste.
  window.addEventListener('contextmenu', (e) => {
    if (!isTypingTarget(e.target)) e.preventDefault();
  });
}

async function start(): Promise<void> {
  captureConsole();
  await loadSettings();
  if (platform().kind === 'tauri') blockBrowserBehaviour();
  platform().onWindowClose(async () => {
    await closeProject();
    await flushSettings();
  });
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
