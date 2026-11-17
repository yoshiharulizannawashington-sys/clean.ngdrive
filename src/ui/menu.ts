import type { QualityProfile } from '../app/settings';

export interface MenuHandlers {
  onPlay: () => void;
  onQualityChange: (profile: QualityProfile) => void;
  onResume: () => void;
  onReset: () => void;
  onReturnToMenu: () => void;
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing UI element #${id}`);
  return element as T;
}

/** Owns all non-HUD interface surfaces and keeps their state consistent. */
export class MenuUI {
  private readonly loading = must('loading');
  private readonly loadingStatus = must('loading-status');
  private readonly loadingBar = must('loading-bar');
  private readonly menu = must('menu');
  private readonly pause = must('pause');
  private readonly pauseStats = must('pause-stats');
  private readonly capability = must('menu-capability');
  private readonly qualitySelect = must<HTMLSelectElement>('quality');
  private readonly errorBanner = must('error-banner');
  private readonly errorText = must('error-text');
  private readonly playButton = must<HTMLButtonElement>('btn-play');

  constructor(handlers: MenuHandlers) {
    this.playButton.addEventListener('click', handlers.onPlay);
    must('btn-resume').addEventListener('click', handlers.onResume);
    must('btn-reset').addEventListener('click', handlers.onReset);
    must('btn-menu').addEventListener('click', handlers.onReturnToMenu);
    must('error-dismiss').addEventListener('click', () => {
      this.errorBanner.hidden = true;
    });
    this.qualitySelect.addEventListener('change', () => {
      const value = this.qualitySelect.value;
      if (value === 'performance' || value === 'balanced' || value === 'high') {
        handlers.onQualityChange(value);
      }
    });
  }

  setLoading(status: string, progress: number): void {
    this.loadingStatus.textContent = status;
    this.loadingBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  hideLoading(): void {
    this.loading.hidden = true;
  }

  setQuality(profile: QualityProfile): void {
    this.qualitySelect.value = profile;
  }

  setCapability(text: string): void {
    this.capability.textContent = text;
  }

  showMenu(): void {
    this.menu.hidden = false;
  }

  hideMenu(): void {
    this.menu.hidden = true;
  }

  showPause(stats: string): void {
    this.pauseStats.textContent = stats;
    this.pause.hidden = false;
  }

  hidePause(): void {
    this.pause.hidden = true;
  }

  get pauseVisible(): boolean {
    return !this.pause.hidden;
  }

  showError(message: string): void {
    this.errorText.textContent = message;
    this.errorBanner.hidden = false;
  }
}
