import { Game } from './app/game';
import { installGlobalErrorHandlers, reportError } from './app/errors';
import { loadSettings } from './app/settings';

async function boot(): Promise<void> {
  installGlobalErrorHandlers();

  const canvas = document.getElementById('viewport');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Viewport canvas is missing from the document');
  }

  const settings = await loadSettings();
  const game = new Game(canvas, settings);
  game.start();

  // Exposed for automated verification and debugging from the console.
  (window as unknown as { browserDrive?: Game }).browserDrive = game;
}

function showStartupFailure(message: string): void {
  const status = document.getElementById('loading-status');
  const bar = document.getElementById('loading-bar');
  const banner = document.getElementById('error-banner');
  const text = document.getElementById('error-text');
  if (status) status.textContent = 'Startup failed';
  if (bar) bar.style.width = '100%';
  if (text) text.textContent = message;
  if (banner) banner.hidden = false;
}

void boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  reportError('Startup failed', error);
  showStartupFailure(message);
});
