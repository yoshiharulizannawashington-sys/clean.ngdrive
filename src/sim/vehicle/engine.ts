import type { EngineConfig, TorquePoint } from './types';

/** Linear interpolation of the torque curve, clamped to its endpoints. */
export function torqueAtRpm(curve: TorquePoint[], rpm: number): number {
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

export function peakTorque(curve: TorquePoint[]): { rpm: number; torque: number } {
  let best = { rpm: 0, torque: 0 };
  for (const point of curve) {
    if (point.torque > best.torque) best = { rpm: point.rpm, torque: point.torque };
  }
  return best;
}

export function peakPower(curve: TorquePoint[]): { rpm: number; powerKw: number } {
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
