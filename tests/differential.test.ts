import { describe, expect, it } from 'vitest';
import {
  DIFF_CLUTCH_LSD,
  DIFF_GEARED_LSD,
  DIFF_LOCKER,
  DIFF_OPEN,
  DIFF_VISCOUS,
} from '../data/components';
import {
  differentialCapacity,
  distributeAxleTorque,
  isLocking,
} from '../src/sim/vehicle/differential';

const DT = 1 / 120;
const INERTIA = 1.25;

describe('open differential', () => {
  it('splits input torque equally and cannot lock', () => {
    const split = distributeAxleTorque(DIFF_OPEN, 800, 10, 40, INERTIA, DT);
    expect(split.left).toBeCloseTo(400, 6);
    expect(split.right).toBeCloseTo(400, 6);
    expect(split.lockTorque).toBe(0);
    expect(isLocking(DIFF_OPEN)).toBe(false);
  });
});

describe('limited-slip differential', () => {
  it('sends torque to the slower wheel when speeds differ', () => {
    const split = distributeAxleTorque(DIFF_CLUTCH_LSD, 800, 10, 40, INERTIA, DT);
    expect(split.lockTorque).toBeGreaterThan(0);
    expect(split.left).toBeGreaterThan(split.right);
    expect(split.left - split.right).toBeLessThanOrEqual(DIFF_CLUTCH_LSD.maxLockTorque);
  });

  it('has a preload even without input torque', () => {
    const capacity = differentialCapacity(DIFF_CLUTCH_LSD, 0);
    expect(capacity).toBeCloseTo(DIFF_CLUTCH_LSD.preload, 6);
  });

  it('grows its capacity with input torque', () => {
    const low = differentialCapacity(DIFF_CLUTCH_LSD, 100);
    const high = differentialCapacity(DIFF_CLUTCH_LSD, 1000);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(DIFF_CLUTCH_LSD.maxLockTorque);
  });

  it('never exceeds the configured maximum lock torque', () => {
    const split = distributeAxleTorque(DIFF_CLUTCH_LSD, 5000, 0, 500, INERTIA, DT);
    expect(Math.abs(split.lockTorque)).toBeLessThanOrEqual(DIFF_CLUTCH_LSD.maxLockTorque + 1e-6);
  });

  it('a geared LSD biases through its bias ratio', () => {
    const capacity = differentialCapacity(DIFF_GEARED_LSD, 1000);
    expect(capacity).toBeGreaterThan(DIFF_GEARED_LSD.preload);
    expect(capacity).toBeLessThanOrEqual(DIFF_GEARED_LSD.maxLockTorque);
  });
});

describe('viscous differential', () => {
  it('responds proportionally to the speed difference', () => {
    const slow = distributeAxleTorque(DIFF_VISCOUS, 400, 0, 1, INERTIA, DT);
    const fast = distributeAxleTorque(DIFF_VISCOUS, 400, 0, 2, INERTIA, DT);
    expect(fast.lockTorque).toBeGreaterThan(slow.lockTorque);
    expect(slow.lockTorque).toBeCloseTo(DIFF_VISCOUS.viscosity, 5);
  });

  it('caps at its maximum transfer', () => {
    const split = distributeAxleTorque(DIFF_VISCOUS, 400, 0, 1e6, INERTIA, DT);
    expect(split.lockTorque).toBeLessThanOrEqual(DIFF_VISCOUS.maxLockTorque + 1e-6);
  });
});

describe('locking differential', () => {
  it('couples the wheel speeds together over time', () => {
    // Two wheel inertias carrying different drive torque, coupled by the diff.
    const left = { omega: 20, torque: 0 };
    const right = { omega: 80, torque: 0 };
    for (let i = 0; i < 60; i += 1) {
      const split = distributeAxleTorque(DIFF_LOCKER, 0, left.omega, right.omega, INERTIA, DT);
      left.omega += (split.left / INERTIA) * DT;
      right.omega += (split.right / INERTIA) * DT;
    }
    expect(Math.abs(left.omega - right.omega)).toBeLessThan(900);
    expect(isLocking(DIFF_LOCKER)).toBe(true);
  });

  it('equalises wheel speeds much faster than an open diff', () => {
    const simulate = (differential: typeof DIFF_LOCKER): number => {
      let left = 20;
      let right = 80;
      for (let i = 0; i < 30; i += 1) {
        const split = distributeAxleTorque(differential, 0, left, right, INERTIA, DT);
        left += (split.left / INERTIA) * DT;
        right += (split.right / INERTIA) * DT;
      }
      return Math.abs(left - right);
    };
    expect(simulate(DIFF_LOCKER)).toBeLessThan(simulate(DIFF_OPEN));
  });
});
