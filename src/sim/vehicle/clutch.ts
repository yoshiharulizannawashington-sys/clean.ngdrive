import { clamp, smoothstep } from '../math3';
import type { ClutchConfig } from './types';

/**
 * Slipping clutch.
 *
 * The clutch transmits a Coulomb friction torque up to `maxTorque * engagement`,
 * with a smooth transition through zero slip:
 *
 *     T = capacity * tanh(slip / slipScale)
 *
 * A hard clamp at capacity chatters between +capacity and -capacity at 120 Hz
 * once the driveline can absorb more torque than the tires can transmit. The
 * tanh curve is continuous, dissipates the slip energy physically, and
 * approximates a locked clutch to within `slipScale` rad/s while still
 * saturating at the friction limit under high slip.
 */

export function clutchCapacity(clutch: ClutchConfig, engagement: number): number {
  return clutch.maxTorque * clamp(engagement, 0, 1);
}

export function slipSpeed(engineOmega: number, shaftOmega: number): number {
  return engineOmega - shaftOmega;
}

/**
 * Torque transmitted through the clutch this step, positive when it accelerates
 * the driveline (engine faster than the shaft).
 */
export function clutchTorque(
  clutch: ClutchConfig,
  engagement: number,
  engineOmega: number,
  shaftOmega: number,
  capacityLimit = Number.POSITIVE_INFINITY,
): number {
  const capacity = Math.min(clutchCapacity(clutch, engagement), Math.max(0, capacityLimit));
  if (capacity <= 0) return 0;

  const slip = slipSpeed(engineOmega, shaftOmega);
  if (Math.abs(slip) < 1e-9) return 0;

  return capacity * Math.tanh(slip / Math.max(clutch.slipScale, 1e-3));
}

/**
 * Automatic clutch engagement.
 *
 * Two independent drivers:
 *  - road speed: once rolling, the clutch is locked (engine braking works);
 *  - engine rpm under throttle: at low speed the clutch slips and only closes
 *    as the engine revs, which is what makes a launch possible without the
 *    engine being dragged to a stall by full clutch capacity at idle.
 */
export function clutchEngagementTarget(
  clutch: ClutchConfig,
  engineRpm: number,
  speedAbs: number,
  inGear: boolean,
  shifting: boolean,
): number {
  if (!inGear || shifting) return 0;

  // Once the engine has revved past its launch speed the clutch closes; how
  // much torque it may then transmit is limited separately (launchCapacityLimit
  // plus the engine's available torque), so a part-throttle start does not
  // leave the clutch open and let the engine scream at the limiter.
  const rolling = smoothstep(clutch.lockSpeed * 0.5, clutch.lockSpeed, speedAbs);
  const launch = smoothstep(clutch.launchRpm * 0.55, clutch.launchRpm * 1.2, engineRpm);
  return clamp(Math.max(rolling, launch, clutch.creepEngagement * (1 - rolling)), 0, 1);
}

/**
 * Launch capacity limit.
 *
 * A driver does not dump full clutch capacity at idle: the clutch is modulated
 * so it transmits roughly what the engine can produce at that moment. Modelling
 * that as a capacity that grows with rpm and throttle prevents the clutch from
 * out-torquing the engine and stalling it during a standing start, while still
 * allowing full capacity (and therefore engine braking) once the car is rolling.
 */
export function launchCapacityLimit(
  clutch: ClutchConfig,
  engineRpm: number,
  idleRpm: number,
  throttle: number,
  rolling: boolean,
): number {
  if (rolling) return clutch.maxTorque;
  const lower = idleRpm * 0.8;
  const upper = Math.max(clutch.launchRpm * 1.3, lower + 1);
  const rpmFactor = Math.min(1, Math.max(0.12, (engineRpm - lower) / (upper - lower)));
  const pedal = 0.35 + 0.4 * Math.min(1, Math.max(0, throttle));
  return clutch.maxTorque * rpmFactor * pedal;
}

/** Exponential approach with separate engage/release time constants. */
export function advanceEngagement(
  current: number,
  target: number,
  engageTime: number,
  releaseTime: number,
  dt: number,
): number {
  const timeConstant = target > current ? engageTime : releaseTime;
  const alpha = 1 - Math.exp(-dt / Math.max(timeConstant, 1e-3));
  return current + (target - current) * alpha;
}
