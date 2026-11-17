import { readValue, writeValue } from '../save/store';

export type QualityProfile = 'performance' | 'balanced' | 'high';

export interface QualitySettings {
  /** Multiplier applied on top of the device pixel ratio. */
  renderScale: number;
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  anisotropy: number;
  /** Number of instanced background trees. */
  treeCount: number;
}

/**
 * Graphics quality only. Simulation accuracy is never tied to these settings:
 * the vehicle solver always runs at the fixed simulation rate with the same
 * tire, suspension and engine models.
 */
export const QUALITY_PROFILES: Record<QualityProfile, QualitySettings> = {
  performance: {
    renderScale: 0.7,
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 1024,
    anisotropy: 2,
    treeCount: 24,
  },
  balanced: {
    renderScale: 1,
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 2048,
    anisotropy: 4,
    treeCount: 48,
  },
  high: {
    renderScale: 1,
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 4096,
    anisotropy: 8,
    treeCount: 64,
  },
};

export interface AppSettings {
  quality: QualityProfile;
  showPerf: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  quality: 'balanced',
  showPerf: true,
};

const SETTINGS_KEY = 'settings-v1';

function isQualityProfile(value: unknown): value is QualityProfile {
  return value === 'performance' || value === 'balanced' || value === 'high';
}

export async function loadSettings(): Promise<AppSettings> {
  const stored = await readValue<Partial<AppSettings>>(SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_SETTINGS };
  return {
    quality: isQualityProfile(stored.quality) ? stored.quality : DEFAULT_SETTINGS.quality,
    showPerf: typeof stored.showPerf === 'boolean' ? stored.showPerf : DEFAULT_SETTINGS.showPerf,
  };
}

export function saveSettings(settings: AppSettings): void {
  void writeValue(SETTINGS_KEY, settings);
}

/** Best-effort capability summary for the menu footer. */
export function detectCapabilities(): string {
  const cores = typeof navigator.hardwareConcurrency === 'number' ? navigator.hardwareConcurrency : null;
  const parts: string[] = [];

  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) {
      return 'WebGL 2 unavailable — this browser cannot run the simulator';
    }
    parts.push('WebGL 2');
    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    if (debugInfo) {
      const raw = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      if (typeof raw === 'string') {
        const concise = raw.replace(/^ANGLE \(/, '').replace(/\)$/, '').split(',')[0];
        parts.push(concise.slice(0, 42));
      }
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    parts.push('WebGL 2');
  }

  if (cores) parts.push(`${cores} threads`);
  return parts.join(' · ');
}
