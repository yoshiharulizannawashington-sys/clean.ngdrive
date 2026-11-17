import type { InterpolatedFrame } from '../app/snapshot-buffer';
import type { QualityProfile } from '../app/settings';

export interface PerformanceReadout {
  fps: number;
  frameMs: number;
  snapshotAgeMs: number;
  drawCalls: number;
  triangles: number;
  simRateHz: number;
  renderScale: number;
}

function must<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing HUD element #${id}`);
  return element as T;
}

const GEAR_LABELS: Record<number, string> = { '-1': 'R', '0': 'N' };

/** Dashboard HUD plus the always-on performance monitor. */
export class Hud {
  private readonly root = must('hud');
  private readonly perf = must('perf');
  private readonly speed = must('hud-speed');
  private readonly speedFill = must('hud-speed-fill');
  private readonly rpm = must('hud-rpm');
  private readonly rpmFill = must('hud-rpm-fill');
  private readonly gear = must('hud-gear');
  private readonly throttle = must('hud-throttle');
  private readonly brake = must('hud-brake');
  private readonly contact = must('hud-contact');
  private readonly camera = must('hud-camera');
  private readonly simChip = must('hud-sim');

  private readonly perfFps = must('perf-fps');
  private readonly perfFrame = must('perf-frame');
  private readonly perfSim = must('perf-sim');
  private readonly perfSteps = must('perf-steps');
  private readonly perfAge = must('perf-age');
  private readonly perfScale = must('perf-scale');
  private readonly perfDraws = must('perf-draws');
  private readonly perfTris = must('perf-tris');
  private readonly perfProfile = must('perf-profile');
  private readonly perfQuality = must('perf-quality');

  private readonly cache = new Map<HTMLElement, string>();

  constructor(profile: QualityProfile, showPerf: boolean) {
    this.perfProfile.textContent = profile;
    this.perfQuality.textContent = profile;
    this.perf.hidden = !showPerf;
  }

  setHudVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  setShowPerformance(visible: boolean): void {
    this.perf.hidden = !visible;
  }

  setProfile(profile: QualityProfile): void {
    this.perfProfile.textContent = profile;
    this.perfQuality.textContent = profile;
  }

  setCamera(label: string): void {
    this.setText(this.camera, label);
  }

  setSimRate(hz: number): void {
    this.setText(this.simChip, `SIM ${hz} Hz`);
  }

  setRenderScale(scale: number): void {
    this.setText(this.perfScale, `${scale.toFixed(2)}×`);
  }

  update(frame: InterpolatedFrame | null, maxRpm: number): void {
    if (!frame) return;

    const speed = Math.round(Math.abs(frame.speedKmh));
    this.setText(this.speed, String(speed));
    this.setWidth(this.speedFill, Math.min(1, Math.abs(frame.speedKmh) / 260));

    const rpmValue = Math.round(frame.rpm);
    this.setText(this.rpm, String(rpmValue));
    this.setWidth(this.rpmFill, Math.min(1, frame.rpm / maxRpm));

    const gearLabel = GEAR_LABELS[frame.gear] ?? String(frame.gear);
    this.setText(this.gear, gearLabel);

    this.setWidth(this.throttle, frame.throttle);
    this.setWidth(this.brake, frame.brake);

    const grounded = frame.wheels.filter((wheel) => wheel.contact).length;
    this.setText(this.contact, `${grounded}/4 wheels grounded`);
  }

  updatePerformance(readout: PerformanceReadout, stats: { stepMs: number; averageStepMs: number } | null): void {
    this.setText(this.perfFps, readout.fps.toFixed(0));
    this.setText(this.perfFrame, `${readout.frameMs.toFixed(1)} ms`);
    this.setText(
      this.perfSim,
      stats ? `${stats.averageStepMs.toFixed(2)} ms` : '—',
    );
    this.setText(this.perfSteps, readout.simRateHz ? String(Math.round(readout.simRateHz)) : '—');
    this.setText(this.perfAge, `${readout.snapshotAgeMs.toFixed(0)} ms`);
    this.setText(this.perfScale, `${readout.renderScale.toFixed(2)}×`);
    this.setText(this.perfDraws, String(readout.drawCalls));
    this.setText(this.perfTris, readout.triangles > 1000 ? `${Math.round(readout.triangles / 1000)}k` : String(readout.triangles));
  }

  private setText(element: HTMLElement, value: string): void {
    if (this.cache.get(element) === value) return;
    this.cache.set(element, value);
    element.textContent = value;
  }

  private setWidth(element: HTMLElement, fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction));
    const value = `${(clamped * 100).toFixed(1)}%`;
    if (this.cache.get(element) === value) return;
    this.cache.set(element, value);
    element.style.width = value;
  }
}
