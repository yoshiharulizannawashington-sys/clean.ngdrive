import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import {
  effectiveMu,
  peakSlipAngle,
  peakSlipRatio,
  tireForces,
} from '../src/sim/vehicle/tire';

const tire = SEDAN.tire;

describe('tire slip model', () => {
  it('reaches peak longitudinal force near the peak slip ratio', () => {
    const peak = peakSlipRatio(tire);
    const atPeak = tireForces(tire, { load: 4000, slipRatio: peak, slipAngle: 0, forwardSpeed: 20 });
    const mu = effectiveMu(tire, 4000);
    expect(Math.abs(atPeak.longitudinal)).toBeGreaterThan(mu * 4000 * 0.9);
    expect(Math.abs(atPeak.longitudinal)).toBeLessThanOrEqual(mu * 4000 + 1e-6);
  });

  it('rises monotonically at small slip', () => {
    const a = tireForces(tire, { load: 4000, slipRatio: 0.02, slipAngle: 0, forwardSpeed: 20 });
    const b = tireForces(tire, { load: 4000, slipRatio: 0.06, slipAngle: 0, forwardSpeed: 20 });
    const c = tireForces(tire, { load: 4000, slipRatio: 0.1, slipAngle: 0, forwardSpeed: 20 });
    expect(b.longitudinal).toBeGreaterThan(a.longitudinal);
    expect(c.longitudinal).toBeGreaterThan(b.longitudinal);
  });

  it('produces lateral force that opposes the slip angle', () => {
    const right = tireForces(tire, { load: 4000, slipRatio: 0, slipAngle: 0.08, forwardSpeed: 20 });
    const left = tireForces(tire, { load: 4000, slipRatio: 0, slipAngle: -0.08, forwardSpeed: 20 });
    expect(right.lateral).toBeLessThan(0);
    expect(left.lateral).toBeGreaterThan(0);
  });

  it('peaks in lateral force near the peak slip angle', () => {
    const peak = peakSlipAngle(tire);
    const atPeak = tireForces(tire, { load: 4000, slipRatio: 0, slipAngle: peak, forwardSpeed: 20 });
    expect(Math.abs(atPeak.lateral)).toBeGreaterThan(effectiveMu(tire, 4000) * 4000 * 0.9);
  });

  it('keeps combined force inside the friction circle', () => {
    const force = tireForces(tire, { load: 4000, slipRatio: 0.4, slipAngle: 0.45, forwardSpeed: 20 });
    const limit = effectiveMu(tire, 4000) * 4000;
    expect(Math.hypot(force.longitudinal, force.lateral)).toBeLessThanOrEqual(limit + 1);
    expect(force.saturated).toBe(true);
  });

  it('loses friction per unit load as vertical load rises', () => {
    expect(effectiveMu(tire, 8000)).toBeLessThan(effectiveMu(tire, 3000));
  });

  it('produces no force without load', () => {
    const force = tireForces(tire, { load: 0, slipRatio: 0.3, slipAngle: 0.3, forwardSpeed: 10 });
    expect(force.longitudinal).toBe(0);
    expect(force.lateral).toBe(0);
  });

  it('applies rolling resistance against motion', () => {
    const forward = tireForces(tire, { load: 4000, slipRatio: 0, slipAngle: 0, forwardSpeed: 10 });
    const backward = tireForces(tire, { load: 4000, slipRatio: 0, slipAngle: 0, forwardSpeed: -10 });
    expect(forward.longitudinal).toBeLessThan(0);
    expect(backward.longitudinal).toBeGreaterThan(0);
  });
});
