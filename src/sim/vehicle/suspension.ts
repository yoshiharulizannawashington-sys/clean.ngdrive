import type { SuspensionConfig } from './types';

export const MAX_SUSPENSION_FORCE = 150000;

/**
 * Spring + damper force for one corner, in N, acting to extend the strut.
 *
 * Compression is positive. Bump damping resists compression, rebound damping
 * resists extension, and the bump stop is a progressive spring past the travel
 * limit. Force is clamped so a numerical spike cannot launch the chassis.
 */
export function suspensionForce(
  config: SuspensionConfig,
  springRate: number,
  bumpDamping: number,
  reboundDamping: number,
  compression: number,
  compressionRate: number,
): number {
  if (compression <= 0) return 0;

  const rate = Math.max(-8, Math.min(8, compressionRate));
  const damper = rate >= 0 ? bumpDamping * rate : reboundDamping * rate;
  let force = springRate * compression + damper;

  if (compression > config.maxCompression) {
    force += config.bumpStopRate * (compression - config.maxCompression);
  }

  return Math.max(0, Math.min(force, MAX_SUSPENSION_FORCE));
}

/**
 * Anti-roll bar force added to the left wheel (and subtracted from the right).
 * When the left side is more compressed, the bar pushes it up and pulls the
 * other side down, which is what resists body roll.
 */
export function antiRollForce(rate: number, compressionLeft: number, compressionRight: number): number {
  return rate * (compressionLeft - compressionRight);
}

/** Compression of a corner at rest under its share of the vehicle weight. */
export function staticCompression(massPerCorner: number, springRate: number, gravity = 9.81): number {
  return (massPerCorner * gravity) / springRate;
}

/**
 * Suspension compression from a downward ray hit distance.
 * The ray starts at the mount and is `restLength + tireRadius` long.
 */
export function compressionFromRay(hitDistance: number, tireRadius: number, restLength: number): number {
  const strutLength = hitDistance - tireRadius;
  return restLength - strutLength;
}
