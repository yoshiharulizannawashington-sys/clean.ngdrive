import type { DrivetrainLayout } from './types';

/** Which of the four wheels are driven. Index order: FL, FR, RL, RR. */
export function drivenWheelIndices(layout: DrivetrainLayout): number[] {
  switch (layout) {
    case 'FWD':
      return [0, 1];
    case 'RWD':
      return [2, 3];
    case 'AWD':
      return [0, 1, 2, 3];
  }
}

export interface AxleTorque {
  front: number;
  rear: number;
}

/**
 * Split total driveline torque between the axles.
 *
 * The current differential model is an open differential: each driven wheel is
 * given half of its axle's torque, so a spinning wheel simply spins (its tire
 * force saturates) instead of dragging the other wheel along. Limited-slip
 * behaviour is a later phase.
 */
export function splitAxleTorque(
  layout: DrivetrainLayout,
  frontSplit: number,
  totalTorque: number,
): AxleTorque {
  if (layout === 'FWD') return { front: totalTorque, rear: 0 };
  if (layout === 'RWD') return { front: 0, rear: totalTorque };
  const split = Math.min(1, Math.max(0, frontSplit));
  return { front: totalTorque * split, rear: totalTorque * (1 - split) };
}

/** Per-wheel drive torque for one axle. */
export function perWheelTorque(axleTorque: number, drivenWheelsOnAxle = 2): number {
  if (drivenWheelsOnAxle <= 0) return 0;
  return axleTorque / drivenWheelsOnAxle;
}
