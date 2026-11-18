import type { EngineConfig } from './types';
import { clamp } from '../math3';

const RPM_TO_RAD = Math.PI / 30;

/** Linear interpolation of the torque curve, clamped to its endpoints. */
export function torqueAtRpm(curve: EngineConfig['torqueCurve'], rpm: number): number {
  if (curve.length === 0) return 0;
  if (rpm <= curve[0].rpm) return curve[0].torque;
  const last = curve[curve.length - 1];
  if (rpm >= last.rpm) return last.torque;
  for (let i = 1; i < curve.length; i += 1) {
    const a = curve[i - 1];
    const b = curve[i];
    if (rpm <= b.rpm) {
      const t = (rpm - a.rpm) / (b.rpm - a.rpm);
      return a.torque + (b.torque - a.torque) * t;
    }
  }
  return last.torque;
}

export function enginePowerKw(torqueNm: number, rpm: number): number {
  return (torqueNm * rpm * Math.PI * 2) / 60 / 1000;
}

export function peakTorque(curve: EngineConfig['torqueCurve']): { rpm: number; torque: number } {
  let best = { rpm: 0, torque: 0 };
  for (const point of curve) {
    if (point.torque > best.torque) best = { rpm: point.rpm, torque: point.torque };
  }
  return best;
}

export function peakPower(curve: EngineConfig['torqueCurve']): { rpm: number; powerKw: number } {
  let best = { rpm: 0, powerKw: 0 };
  if (curve.length === 0) return best;
  const start = curve[0].rpm;
  const end = curve[curve.length - 1].rpm;
  for (let rpm = start; rpm <= end; rpm += 25) {
    const powerKw = enginePowerKw(torqueAtRpm(curve, rpm), rpm);
    if (powerKw > best.powerKw) best = { rpm, powerKw };
  }
  return best;
}

/**
 * Net crankshaft torque in Nm at a given rpm and throttle position.
 *
 * Includes internal friction, closed-throttle pumping losses (engine braking)
 * and a hard rev limiter. Negative values mean the engine is dragging the
 * drivetrain, which is what makes the car slow down in gear.
 */
export function engineNetTorque(engine: EngineConfig, rpm: number, throttle: number): number {
  const throttleClamped = Math.min(1, Math.max(0, throttle));
  if (rpm > engine.redlineRpm + 120) {
    return -engine.frictionTorque;
  }
  const rpmClamped = Math.min(engine.redlineRpm, Math.max(engine.idleRpm, rpm));
  const combustion = torqueAtRpm(engine.torqueCurve, rpmClamped) * throttleClamped;
  const friction = -engine.frictionTorque;
  const pumping = -engine.engineBraking * (1 - throttleClamped) * (rpmClamped / engine.redlineRpm);
  return combustion + friction + pumping;
}

/**
 * Rotating engine state.
 *
 * The engine has its own angular velocity and inertia. Engine speed is never
 * derived from wheel speed: torque flows through the clutch, which is solved by
 * the vehicle (see `clutch.ts`). That is what makes rev flare under wheelspin,
 * rpm drop under load and stalling emergent rather than scripted.
 */
export class Engine {
  private omega: number;
  private running = true;
  private stallTimer = 0;
  private idleIntegral = 0;
  private fuelCut = false;
  private starterActive = false;

  constructor(private readonly config: EngineConfig) {
    this.omega = this.config.idleRpm * RPM_TO_RAD;
  }

  get rpm(): number {
    return this.omega / RPM_TO_RAD;
  }

  get angularVelocity(): number {
    return this.omega;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get isFuelCut(): boolean {
    return this.fuelCut;
  }

  get isCranking(): boolean {
    return this.starterActive;
  }

  reset(): void {
    this.omega = this.config.idleRpm * RPM_TO_RAD;
    this.running = true;
    this.stallTimer = 0;
    this.idleIntegral = 0;
    this.fuelCut = false;
    this.starterActive = false;
  }

  /** Explicit restart (used by reset, tests and the starter input). */
  start(): void {
    this.running = true;
    this.stallTimer = 0;
    this.idleIntegral = 0;
    this.fuelCut = false;
    this.omega = Math.max(this.omega, this.config.idleRpm * 0.6 * RPM_TO_RAD);
  }

  /** Force the engine to stall — used by damage systems later and by tests. */
  stall(): void {
    this.running = false;
    this.stallTimer = 0;
    this.idleIntegral = 0;
  }

  /**
   * Crankshaft torque for this step, including the idle governor, rev limiter
   * and starter motor. Does not integrate.
   */
  torque(dt: number, throttle: number): number {
    const config = this.config;

    if (!this.running) {
      // Starter motor: the driver cranking the throttle restarts the engine.
      if (throttle > 0.1) {
        this.starterActive = true;
        this.omega += (config.starterTorque / config.inertia) * dt;
        if (this.rpm > config.idleRpm * 0.55) {
          this.running = true;
          this.starterActive = false;
          this.stallTimer = 0;
          this.idleIntegral = 0;
        }
        return 0;
      }
      this.starterActive = false;
      return 0;
    }

    // Rev limiter with hysteresis: fuel cut above redline, restored below it.
    if (this.rpm >= config.redlineRpm) this.fuelCut = true;
    else if (this.rpm < config.redlineRpm - 180) this.fuelCut = false;

    const effectiveThrottle = this.fuelCut ? 0 : throttle;
    let net = engineNetTorque(config, this.rpm, effectiveThrottle);

    // Idle governor: only while the driver is off the throttle and not on the
    // limiter. It is torque-limited, so a real load can still stall the engine.
    if (!this.fuelCut && throttle < 0.06) {
      const error = config.idleControl.targetRpm - this.rpm;
      this.idleIntegral = clamp(
        this.idleIntegral + error * config.idleControl.integral * dt,
        0,
        config.idleControl.maxTorque,
      );
      const assist = clamp(
        config.idleControl.proportional * error + this.idleIntegral,
        0,
        config.idleControl.maxTorque,
      );
      net += assist;
    } else {
      this.idleIntegral = Math.max(0, this.idleIntegral - config.idleControl.maxTorque * dt);
    }

    return net;
  }

  /**
   * Integrate the engine with an external load torque (the clutch).
   * `loadTorque` is positive when the driveline drags the engine down.
   */
  update(dt: number, throttle: number, loadTorque: number): void {
    const net = this.torque(dt, throttle);

    if (!this.running) {
      // Cranking or spinning down with no combustion.
      if (!this.starterActive) {
        this.omega = Math.max(0, this.omega - (this.config.frictionTorque / this.config.inertia) * dt);
      }
      this.omega = clamp(this.omega, 0, this.config.redlineRpm * 1.2 * RPM_TO_RAD);
      return;
    }

    const total = net - loadTorque;
    this.omega += (total / this.config.inertia) * dt;

    // An engine cannot rotate backwards: a reverse load stalls it instead.
    if (this.omega <= 0) {
      this.omega = 0;
      this.stall();
      return;
    }
    this.omega = clamp(this.omega, 0, this.config.redlineRpm * 1.2 * RPM_TO_RAD);

    if (this.rpm < this.config.stallRpm) {
      this.stallTimer += dt;
      if (this.stallTimer >= this.config.stallTime) this.stall();
    } else {
      this.stallTimer = Math.max(0, this.stallTimer - dt * 2);
    }
  }
}
