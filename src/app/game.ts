import { TEST_FACILITY } from '../../data/maps/test-facility';
import { SEDAN } from '../../data/vehicles/sedan';
import { InputManager } from '../input/input';
import { CameraRig, CAMERA_LABELS } from '../render/camera';
import { FacilityEnvironment } from '../render/environment';
import { EngineRenderer } from '../render/renderer';
import { VehicleView } from '../render/vehicle-view';
import {
  NEUTRAL_INPUT,
  SIM_HZ,
  isSimToMain,
  type MainToSim,
} from '../sim/protocol';
import { Hud } from '../ui/hud';
import { MenuUI } from '../ui/menu';
import { onRuntimeError, reportError } from './errors';
import {
  QUALITY_PROFILES,
  detectCapabilities,
  saveSettings,
  type AppSettings,
  type QualityProfile,
  type QualitySettings,
} from './settings';
import { SnapshotBuffer, type InterpolatedFrame } from './snapshot-buffer';

type GameState = 'loading' | 'menu' | 'playing' | 'paused';

/**
 * Application shell: builds the renderer, menus, HUD, input and the simulation
 * worker, then runs the render loop.
 *
 * Physics lives in the worker. This class only sends input and renders the
 * interpolated snapshots that come back.
 */
export class Game {
  private readonly renderer: EngineRenderer;
  private readonly cameraRig: CameraRig;
  private readonly environment: FacilityEnvironment;
  private readonly vehicleView: VehicleView;
  private readonly hud: Hud;
  private readonly menu: MenuUI;
  private readonly input: InputManager;
  private readonly buffer = new SnapshotBuffer();

  private worker: Worker | null = null;
  private settings: AppSettings;
  private quality: QualitySettings;
  private state: GameState = 'loading';
  private workerReady = false;

  private rafHandle = 0;
  private lastFrameAt = 0;
  private lastFrameData: InterpolatedFrame | null = null;
  private lastSentInput = '';

  private fps = 0;
  private fpsTimer = 0;
  private frameCounter = 0;
  private perfTimer = 0;
  private adaptiveCooldownMs = 0;

  constructor(canvas: HTMLCanvasElement, settings: AppSettings) {
    this.settings = settings;
    this.quality = QUALITY_PROFILES[settings.quality];

    this.renderer = new EngineRenderer(canvas, this.quality);
    this.cameraRig = new CameraRig(this.renderer.camera);
    this.environment = new FacilityEnvironment(
      this.renderer.scene,
      this.quality,
      this.renderer.maxAnisotropy,
    );
    this.vehicleView = new VehicleView(SEDAN);
    this.renderer.scene.add(this.vehicleView.root);

    this.hud = new Hud(settings.quality, settings.showPerf);
    this.input = new InputManager(canvas);

    this.menu = new MenuUI({
      onPlay: () => this.enterSession(),
      onQualityChange: (profile) => this.applyQuality(profile),
      onResume: () => this.resume(),
      onReset: () => this.resetVehicle(),
      onReturnToMenu: () => this.returnToMenu(),
    });

    this.menu.setQuality(settings.quality);
    this.menu.setCapability(detectCapabilities());
    this.menu.setLoading('Preparing simulation worker…', 0.35);

    onRuntimeError((message) => this.menu.showError(message));
    this.startWorker();
  }

  private startWorker(): void {
    try {
      const worker = new Worker(new URL('../sim/physics-worker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (event: MessageEvent) => this.handleWorkerMessage(event.data);
      worker.onerror = (event) => {
        this.menu.showError(`Simulation worker failed: ${event.message}`);
        reportError('Simulation worker failed', event);
      };
      this.worker = worker;
      this.send({ type: 'init', config: SEDAN, spawn: TEST_FACILITY.spawn });
    } catch (error) {
      reportError('Could not start the simulation worker', error);
      this.menu.showError('The simulation worker could not be started.');
    }
  }

  private send(message: MainToSim): void {
    this.worker?.postMessage(message);
  }

  private handleWorkerMessage(raw: unknown): void {
    if (!isSimToMain(raw)) return;

    switch (raw.type) {
      case 'ready':
        this.workerReady = true;
        this.menu.setLoading('Ready', 1);
        this.menu.hideLoading();
        this.enterMenuState();
        break;
      case 'snapshot':
        this.buffer.push(raw.snapshot);
        break;
      case 'error':
        this.menu.showError(raw.message);
        break;
      case 'fatal':
        reportError(raw.message);
        this.menu.showError(raw.message);
        break;
    }
  }

  private enterMenuState(): void {
    this.state = 'menu';
    this.menu.showMenu();
    this.menu.hidePause();
    this.hud.setHudVisible(false);
    this.hud.setShowPerformance(this.settings.showPerf);
    this.hud.setCamera(CAMERA_LABELS[this.cameraRig.mode]);
    this.send({ type: 'set-running', running: true });
    this.cameraRig.snap();
  }

  private enterSession(): void {
    this.state = 'playing';
    this.menu.hideMenu();
    this.menu.hidePause();
    this.hud.setHudVisible(true);
    this.hud.setShowPerformance(this.settings.showPerf);
    this.input.reset();
    this.cameraRig.snap();
    this.send({ type: 'set-running', running: true });
    this.sendInput(true);
  }

  private togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  private pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.reset();
    this.send({ type: 'input', input: { ...NEUTRAL_INPUT } });
    this.send({ type: 'set-running', running: false });
    const frame = this.lastFrameData;
    const stats = this.buffer.latestStats;
    this.menu.showPause(
      frame && stats
        ? `${Math.abs(Math.round(frame.speedKmh))} km/h · ${Math.round(frame.rpm)} rpm · gear ${frame.gear === -1 ? 'R' : frame.gear} · ${stats.averageStepMs.toFixed(2)} ms/step`
        : 'Simulation paused',
    );
  }

  private resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menu.hidePause();
    this.input.reset();
    this.send({ type: 'set-running', running: true });
    this.sendInput(true);
  }

  private returnToMenu(): void {
    this.state = 'menu';
    this.menu.hidePause();
    this.hud.setHudVisible(false);
    this.input.reset();
    this.send({ type: 'input', input: { ...NEUTRAL_INPUT } });
    this.send({ type: 'reset' });
    this.send({ type: 'set-running', running: true });
    this.menu.showMenu();
    this.cameraRig.mode = 'chase';
    this.cameraRig.snap();
    this.hud.setCamera(CAMERA_LABELS.chase);
  }

  private resetVehicle(): void {
    this.send({ type: 'reset' });
    this.input.reset();
    this.cameraRig.snap();
    if (this.state === 'paused') this.resume();
  }

  private applyQuality(profile: QualityProfile): void {
    this.settings = { ...this.settings, quality: profile };
    this.quality = QUALITY_PROFILES[profile];
    saveSettings(this.settings);
    this.renderer.applyQuality(this.quality);
    this.environment.setQuality(this.quality);
    this.hud.setProfile(profile);
    this.hud.setRenderScale(1);
    this.menu.setQuality(profile);
  }

  private sendInput(force = false): void {
    if (!this.worker) return;
    const state = this.input.state;
    const key = `${state.throttle.toFixed(3)}|${state.brake.toFixed(3)}|${state.steer.toFixed(3)}|${state.handbrake}|${state.shiftUp}|${state.shiftDown}`;
    if (!force && key === this.lastSentInput) return;
    this.lastSentInput = key;
    this.send({ type: 'input', input: { ...state } });
  }

  start(): void {
    if (this.rafHandle !== 0) return;
    this.lastFrameAt = 0;
    this.rafHandle = requestAnimationFrame(this.handleFrame);
  }

  private handleFrame = (now: number): void => {
    this.rafHandle = requestAnimationFrame(this.handleFrame);
    // Raw delta drives the FPS readout and adaptation; the clamped delta drives
    // interpolation and input smoothing so a hitch cannot break the frame.
    const rawDeltaMs = this.lastFrameAt === 0 ? 16.7 : now - this.lastFrameAt;
    this.lastFrameAt = now;
    const dtMs = Math.min(rawDeltaMs, 100);
    try {
      this.tick(dtMs, rawDeltaMs);
    } catch (error) {
      reportError('Render loop error', error);
    }
  };

  private tick(dtMs: number, rawDeltaMs: number): void {
    const dt = dtMs / 1000;
    this.input.update(dt);
    const actions = this.input.consumeActions();

    if (actions.pause) this.togglePause();
    if (actions.reset) this.resetVehicle();
    if (actions.cycleCamera) this.hud.setCamera(CAMERA_LABELS[this.cameraRig.cycle()]);
    if (actions.toggleFreeCamera) this.hud.setCamera(CAMERA_LABELS[this.cameraRig.toggleFree()]);

    if (this.state === 'playing') this.sendInput();

    this.buffer.advance(dtMs);
    const frame = this.buffer.sample();
    const freeCamera = this.input.consumeFreeCamera();

    if (frame) {
      this.vehicleView.update(frame);
      this.environment.updateProps(frame.props);
      this.hud.update(frame, SEDAN.engine.redlineRpm);
      this.renderer.focusShadow(frame.position);
      this.lastFrameData = frame;
    }

    const menuOrbit = this.state === 'menu' || this.state === 'loading';
    this.cameraRig.update(dt, frame, menuOrbit, freeCamera);
    this.environment.update(dt);
    this.renderer.render();

    this.updatePerformance(dtMs, rawDeltaMs);
    this.adaptResolution(rawDeltaMs, dtMs);
  }

  /**
   * Adaptive resolution. Rendering resolution is reduced on slow hardware and
   * restored when there is headroom. Physics is unaffected: the worker keeps
   * stepping at the same fixed rate with the same model.
   */
  private adaptResolution(frameMs: number, dtMs: number): void {
    this.adaptiveCooldownMs = Math.max(0, this.adaptiveCooldownMs - dtMs);
    if (this.adaptiveCooldownMs > 0) return;

    const scale = this.renderer.currentRenderScale;
    if (frameMs > 30 && scale > 0.42) {
      this.renderer.setRenderScale(scale - 0.15);
      this.hud.setRenderScale(this.renderer.currentRenderScale);
      this.adaptiveCooldownMs = 1200;
    } else if (frameMs < 14 && scale < 1) {
      this.renderer.setRenderScale(scale + 0.1);
      this.hud.setRenderScale(this.renderer.currentRenderScale);
      this.adaptiveCooldownMs = 2500;
    }
  }

  private updatePerformance(dtMs: number, rawDeltaMs: number): void {
    this.fpsTimer += rawDeltaMs;
    this.frameCounter += 1;
    if (this.fpsTimer >= 400) {
      this.fps = (this.frameCounter * 1000) / this.fpsTimer;
      this.fpsTimer = 0;
      this.frameCounter = 0;
    }

    this.perfTimer += dtMs;
    if (this.perfTimer < 200) return;
    this.perfTimer = 0;

    const info = this.renderer.renderer.info.render;
    this.hud.updatePerformance(
      {
        fps: this.fps,
        frameMs: Math.min(rawDeltaMs, 1000),
        snapshotAgeMs: this.buffer.ageMs,
        drawCalls: info.calls,
        triangles: info.triangles,
        simRateHz: SIM_HZ,
        renderScale: this.renderer.currentRenderScale,
      },
      this.buffer.latestStats,
    );
  }

  /** Introspection used by automated browser verification and the console. */
  getDiagnostics(): Record<string, unknown> {
    const frame = this.lastFrameData;
    const stats = this.buffer.latestStats;
    return {
      state: this.state,
      workerReady: this.workerReady,
      quality: this.settings.quality,
      fps: Number(this.fps.toFixed(1)),
      bufferedSnapshots: this.buffer.length,
      speedKmh: frame ? Number(frame.speedKmh.toFixed(2)) : 0,
      rpm: frame ? Math.round(frame.rpm) : 0,
      gear: frame?.gear ?? 0,
      groundedWheels: frame ? frame.wheels.filter((wheel) => wheel.contact).length : 0,
      wheelCompression: frame ? frame.wheels.map((wheel) => Number(wheel.compression.toFixed(3))) : [],
      position: frame
        ? [
            Number(frame.position.x.toFixed(2)),
            Number(frame.position.y.toFixed(2)),
            Number(frame.position.z.toFixed(2)),
          ]
        : null,
      simStepMs: stats ? Number(stats.averageStepMs.toFixed(3)) : null,
      simSteps: stats?.steps ?? 0,
      bodies: stats?.bodies ?? 0,
      drawCalls: this.renderer.renderer.info.render.calls,
    };
  }

  dispose(): void {
    cancelAnimationFrame(this.rafHandle);
    this.rafHandle = 0;
    this.send({ type: 'dispose' });
    this.worker?.terminate();
    this.worker = null;
    this.input.dispose();
    this.environment.dispose();
    this.renderer.dispose();
  }
}
