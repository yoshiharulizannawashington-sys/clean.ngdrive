import type { SurfaceGrip } from '../surfaces';
import type { TireConfig } from './types';

/**
 * Simplified Magic Formula tire model with combined-slip friction ellipse.
 *
 * This is a real slip-based model: force is produced from longitudinal slip
 * ratio and lateral slip angle, scaled by the vertical load and its sensitivity.
 * It is not a lookup table and it does not move the vehicle by script.
 *
 * The contact surface supplies its available longitudinal and lateral grip plus
 * rolling resistance; the tire compound still defines the shape of the slip
 * curve and the load sensitivity.
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

export const REFERENCE_SURFACE: SurfaceGrip = {
  gripLong: 1,
  gripLat: 1,
  rollingResistance: 0.014,
};

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

export function tireForces(
  tire: TireConfig,
  input: TireForceInput,
  surface: SurfaceGrip = REFERENCE_SURFACE,
): TireForces {
  const load = Math.max(0, input.load);
  if (load <= 1) {
    return { longitudinal: 0, lateral: 0, effectiveMu: 0, saturated: false };
  }

  const mu = effectiveMu(tire, load);
  // The surface scales the available force per axis; the compound still defines
  // the shape of the curve and how load sensitivity reduces it.
  const peakLong = mu * load * Math.max(0, surface.gripLong);
  const peakLat = mu * load * Math.max(0, surface.gripLat);

  let fx = magicFormula(input.slipRatio, tire.bLong, tire.cLong, peakLong, tire.eLong);
  let fy = -magicFormula(input.slipAngle, tire.bLat, tire.cLat, peakLat, tire.eLat);

  // Combined slip: a friction ellipse across the two axes, so using grip for
  // cornering takes it away from acceleration and vice versa.
  let saturated = false;
  if (peakLong > 1e-6 && peakLat > 1e-6) {
    const utilisation = Math.hypot(fx / peakLong, fy / peakLat);
    if (utilisation > 1) {
      const k = 1 / utilisation;
      fx *= k;
      fy *= k;
      saturated = true;
    }
  }

  // Rolling resistance opposes motion at the contact patch.
  if (Math.abs(input.forwardSpeed) > 0.25) {
    fx -= Math.sign(input.forwardSpeed) * surface.rollingResistance * load;
  }

  return { longitudinal: fx, lateral: fy, effectiveMu: mu, saturated };
}
