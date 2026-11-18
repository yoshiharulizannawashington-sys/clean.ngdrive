import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import {
  advanceEngagement,
  clutchCapacity,
  clutchEngagementTarget,
  clutchTorque,
  launchCapacityLimit,
} from '../src/sim/vehicle/clutch';

const clutch = SEDAN.clutch;

describe('clutch capacity and slip torque', () => {
  it('scales capacity with engagement and clamps it', () => {
    expect(clutchCapacity(clutch, 0)).toBe(0);
    expect(clutchCapacity(clutch, 0.5)).toBeCloseTo(clutch.maxTorque * 0.5, 6);
    expect(clutchCapacity(clutch, 1)).toBeCloseTo(clutch.maxTorque, 6);
    expect(clutchCapacity(clutch, 3)).toBeCloseTo(clutch.maxTorque, 6);
  });

  it('transmits nothing when disengaged', () => {
    expect(clutchTorque(clutch, 0, 600, 0)).toBe(0);
  });

  it('transmits torque from the faster side to the slower side', () => {
    const accelerating = clutchTorque(clutch, 1, 400, 200);
    const engineBraking = clutchTorque(clutch, 1, 200, 400);
    expect(accelerating).toBeGreaterThan(0);
    expect(engineBraking).toBeLessThan(0);
    expect(accelerating).toBeCloseTo(-engineBraking, 6);
  });

  it('saturates at the friction capacity under large slip', () => {
    const huge = clutchTorque(clutch, 1, 2000, 0);
    expect(huge).toBeLessThan(clutch.maxTorque + 1e-6);
    expect(huge).toBeGreaterThan(clutch.maxTorque * 0.95);
  });

  it('is nearly linear at small slip (a locked clutch transmits torque)', () => {
    const small = clutchTorque(clutch, 1, 100, 98);
    const expected = clutch.maxTorque * Math.tanh(2 / clutch.slipScale);
    expect(small).toBeCloseTo(expected, 6);
    expect(small).toBeGreaterThan(0);
  });

  it('respects an external capacity limit (launch modulation)', () => {
    const limited = clutchTorque(clutch, 1, 1000, 0, 120);
    expect(limited).toBeLessThanOrEqual(120 + 1e-6);
  });
});

describe('launch capacity modulation', () => {
  it('allows full capacity once rolling', () => {
    expect(launchCapacityLimit(clutch, 1500, 780, 1, true)).toBeCloseTo(clutch.maxTorque, 6);
  });

  it('is small at idle and grows with rpm', () => {
    const idle = launchCapacityLimit(clutch, 800, 780, 1, false);
    const mid = launchCapacityLimit(clutch, 2400, 780, 1, false);
    const high = launchCapacityLimit(clutch, 5000, 780, 1, false);
    expect(idle).toBeLessThan(100);
    expect(mid).toBeGreaterThan(idle);
    expect(high).toBeGreaterThanOrEqual(mid);
    expect(high).toBeLessThanOrEqual(clutch.maxTorque);
  });

  it('is smaller with a closed throttle than at full throttle', () => {
    const closed = launchCapacityLimit(clutch, 2000, 780, 0, false);
    const open = launchCapacityLimit(clutch, 2000, 780, 1, false);
    expect(closed).toBeLessThan(open);
  });
});

describe('automatic clutch engagement', () => {
  it('is open in neutral and during a shift', () => {
    expect(clutchEngagementTarget(clutch, 2000, 20, false, false)).toBe(0);
    expect(clutchEngagementTarget(clutch, 2000, 20, true, true)).toBe(0);
  });

  it('is open at a standstill with the engine at idle', () => {
    expect(clutchEngagementTarget(clutch, 780, 0, true, false)).toBe(0);
  });

  it('closes as the engine revs', () => {
    const low = clutchEngagementTarget(clutch, 900, 0, true, false);
    const high = clutchEngagementTarget(clutch, 2500, 0, true, false);
    expect(low).toBeLessThan(0.2);
    expect(high).toBeGreaterThan(0.9);
  });

  it('locks once the car is rolling', () => {
    expect(clutchEngagementTarget(clutch, 900, 10, true, false)).toBe(1);
  });

  it('engages faster than it releases', () => {
    const engaged = advanceEngagement(0, 1, clutch.engageTime, clutch.releaseTime, 1 / 60);
    const released = advanceEngagement(1, 0, clutch.engageTime, clutch.releaseTime, 1 / 60);
    // The release fraction of the gap moved must be larger than the engage fraction.
    expect(1 - released).toBeGreaterThan(engaged);
  });
});
