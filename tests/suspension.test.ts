import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import {
  MAX_SUSPENSION_FORCE,
  antiRollForce,
  compressionFromRay,
  staticCompression,
  suspensionForce,
} from '../src/sim/vehicle/suspension';

const config = SEDAN.suspension;
const spring = SEDAN.suspension.springRateFront;
const bump = SEDAN.suspension.bumpDampingFront;
const rebound = SEDAN.suspension.reboundDampingFront;

describe('suspension force', () => {
  it('produces no force at or beyond full droop', () => {
    expect(suspensionForce(config, spring, bump, rebound, 0, 0)).toBe(0);
    expect(suspensionForce(config, spring, bump, rebound, -0.05, 0)).toBe(0);
  });

  it('rises with compression', () => {
    const a = suspensionForce(config, spring, bump, rebound, 0.05, 0);
    const b = suspensionForce(config, spring, bump, rebound, 0.1, 0);
    expect(a).toBeCloseTo(spring * 0.05, 5);
    expect(b).toBeGreaterThan(a);
  });

  it('damps compression and rebound in opposite directions', () => {
    const neutral = suspensionForce(config, spring, bump, rebound, 0.1, 0);
    expect(suspensionForce(config, spring, bump, rebound, 0.1, 0.5)).toBeGreaterThan(neutral);
    expect(suspensionForce(config, spring, bump, rebound, 0.1, -0.5)).toBeLessThan(neutral);
  });

  it('never pulls the chassis down', () => {
    expect(suspensionForce(config, spring, bump, rebound, 0.01, -8)).toBe(0);
  });

  it('engages the bump stop past maximum compression', () => {
    const atLimit = suspensionForce(config, spring, bump, rebound, config.maxCompression, 0);
    const over = suspensionForce(config, spring, bump, rebound, config.maxCompression + 0.05, 0);
    expect(over - atLimit).toBeGreaterThan(9000);
  });

  it('is capped to avoid numerical launches', () => {
    expect(suspensionForce(config, spring, bump, rebound, 5, 8)).toBeLessThanOrEqual(MAX_SUSPENSION_FORCE);
  });
});

describe('anti-roll bars', () => {
  it('adds force to the compressed side', () => {
    expect(antiRollForce(12000, 0.12, 0.06)).toBe(720);
    expect(antiRollForce(12000, 0.06, 0.12)).toBe(-720);
  });
});

describe('geometry helpers', () => {
  it('computes static compression from corner mass', () => {
    expect(staticCompression(380, 34000)).toBeCloseTo(0.1096, 3);
  });

  it('converts a ray hit distance to compression', () => {
    expect(compressionFromRay(0.52, 0.34, 0.3)).toBeCloseTo(0.12, 6);
  });
});
