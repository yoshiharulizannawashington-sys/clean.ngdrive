import type { TireConfig } from './types';

/**
 * Simplified Magic Formula tire model with combined-slip friction ellipse.
 *
 * This is a real slip-based model: force is produced from longitudinal slip
 * ratio and lateral slip angle, scaled by the vertical load and its sensitivity.
 * It is not a lookup table and it does not move the vehicle by script.
 */

export interface TireForceInput {
  /** Vertical load in N. */
  load: number;
  /** Longitudinal slip ratio (0 = free rolling). */
  slipRatio: number;
  /** Lateral slip angle in radians. */
  slipAngle: number;
  /** Longitudinal contact-patch speed in m/s, used for rolling resistance. */
  forwardSpeed: number;
}

export interface TireForces {
  longitudinal: number;
  lateral: number;
  effectiveMu: number;
  saturated: boolean;
}

/** Standard Pacejka-style curve: D * sin(C * atan(B*s - E*(B*s - atan(B*s)))). */
export function magicFormula(slip: number, stiffness: number, shape: number, peak: number, curvature: number): number {
  const x = stiffness * slip;
  return peak * Math.sin(shape * Math.atan(x - curvature * (x - Math.atan(x))));
}

/**
 * Friction falls off as load rises (tire load sensitivity), which is why weight
 * transfer reduces total grip. Clamped so light loads do not gain unrealistic grip.
 */
export function effectiveMu(tire: TireConfig, load: number): number {
  if (load <= 0) return 0;
  const ratio = load / tire.nominalLoad;
  const mu = tire.mu * (1 - tire.loadSensitivity * (ratio - 1));
  return Math.max(tire.mu * 0.55, Math.min(tire.mu * 1.15, mu));
}

/** Slip ratio at which longitudinal force peaks; used by tests and tuning. */
export function peakSlipRatio(tire: TireConfig): number {
  return Math.tan(Math.PI / (2 * tire.cLong)) / tire.bLong;
}

/** Slip angle (radians) at which lateral force peaks. */
export function peakSlipAngle(tire: TireConfig): number {
  return Math.tan(Math.PI / (2 * tire.cLat)) / tire.bLat;
}

export function tireForces(tire: TireConfig, input: TireForceInput): TireForces {
  const load = Math.max(0, input.load);
  if (load <= 1) {
    return { longitudinal: 0, lateral: 0, effectiveMu: 0, saturated: false };
  }

  const mu = effectiveMu(tire, load);
  const peak = mu * load;

  let fx = magicFormula(input.slipRatio, tire.bLong, tire.cLong, peak, tire.eLong);
  let fy = -magicFormula(input.slipAngle, tire.bLat, tire.cLat, peak, tire.eLat);

  // Combined slip: the friction circle couples longitudinal and lateral demand.
  const magnitude = Math.hypot(fx, fy);
  let saturated = false;
  if (magnitude > peak) {
    const k = peak / magnitude;
    fx *= k;
    fy *= k;
    saturated = true;
  }

  // Rolling resistance opposes rotation-independent motion at the contact patch.
  if (Math.abs(input.forwardSpeed) > 0.25) {
    fx -= Math.sign(input.forwardSpeed) * tire.rollingResistance * load;
  }

  return { longitudinal: fx, lateral: fy, effectiveMu: mu, saturated };
}
