import { clamp } from '../math3';
import type { DifferentialConfig } from './types';

/**
 * Differential torque distribution.
 *
 * Each side receives half of the axle torque plus/minus a locking torque. The
 * locking torque is the impulse that would equalise the two wheel speeds within
 * one step, clamped to the differential's capacity — the same stable formulation
 * used for the clutch. An open differential has zero capacity, so the wheels are
 * free to spin at different speeds; a locked one has a large capacity and
 * behaves like a spool.
 *
 * Assumptions (documented rather than hidden):
 *  - clutch-type, geared and viscous units are modelled as speed-difference
 *    couplings with different capacity curves (preload + bias, or viscosity);
 *  - there is no separate differential housing inertia or gear backlash;
 *  - torque bias is applied through the locking capacity, not by asymmetric
 *    static torque distribution.
 */

export interface AxleTorqueSplit {
  left: number;
  right: number;
  /** Positive when the left wheel is being accelerated and the right retarded. */
  lockTorque: number;
  /** Capacity that was available for this step, Nm. */
  capacity: number;
}

export function differentialCapacity(
  differential: DifferentialConfig,
  inputTorque: number,
): number {
  switch (differential.type) {
    case 'open':
      return 0;
    case 'viscous':
      return differential.maxLockTorque;
    case 'locking':
      return differential.maxLockTorque;
    case 'clutch-lsd':
      return Math.min(
        differential.maxLockTorque,
        differential.preload + Math.abs(inputTorque) * differential.lockingStrength,
      );
    case 'geared-lsd': {
      const bias = Math.max(1, differential.torqueBias);
      const biasShare = ((bias - 1) / (bias + 1)) * Math.abs(inputTorque);
      return Math.min(differential.maxLockTorque, differential.preload + biasShare);
    }
  }
}

export function distributeAxleTorque(
  differential: DifferentialConfig,
  inputTorque: number,
  omegaLeft: number,
  omegaRight: number,
  wheelInertia: number,
  dt: number,
): AxleTorqueSplit {
  const base = inputTorque / 2;
  const speedDifference = omegaRight - omegaLeft;

  if (differential.type === 'open' || Math.abs(speedDifference) < 1e-9) {
    return { left: base, right: base, lockTorque: 0, capacity: 0 };
  }

  const capacity = differentialCapacity(differential, inputTorque);
  let lockTorque = 0;

  if (differential.type === 'viscous') {
    // Viscous coupling: torque proportional to speed difference, no 1/dt term.
    lockTorque = clamp(differential.viscosity * speedDifference, -capacity, capacity);
  } else {
    // Coulomb/mechanical locking: impulse that equalises this step, capped.
    const effectiveInertia = wheelInertia / 2;
    const equalising = (speedDifference * effectiveInertia) / Math.max(dt, 1e-6);
    lockTorque = clamp(equalising, -capacity, capacity);
  }

  return {
    left: base + lockTorque,
    right: base - lockTorque,
    lockTorque,
    capacity,
  };
}

/** Convenience: is this differential capable of transferring torque side to side? */
export function isLocking(differential: DifferentialConfig): boolean {
  return differential.type !== 'open' && differential.maxLockTorque > 0;
}
