import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import {
  engineNetTorque,
  enginePowerKw,
  peakPower,
  peakTorque,
  torqueAtRpm,
} from '../src/sim/vehicle/engine';

describe('torque curve', () => {
  it('interpolates linearly between curve points', () => {
    expect(torqueAtRpm(SEDAN.engine.torqueCurve, 3500)).toBeCloseTo(310, 5);
    const mid = torqueAtRpm(SEDAN.engine.torqueCurve, 3850);
    expect(mid).toBeGreaterThan(310);
    expect(mid).toBeLessThan(320);
  });

  it('clamps outside the curve', () => {
    expect(torqueAtRpm(SEDAN.engine.torqueCurve, 0)).toBeCloseTo(180, 5);
    expect(torqueAtRpm(SEDAN.engine.torqueCurve, 9000)).toBeCloseTo(245, 5);
  });

  it('reports peak torque and peak power', () => {
    expect(peakTorque(SEDAN.engine.torqueCurve).torque).toBeCloseTo(320, 5);
    const power = peakPower(SEDAN.engine.torqueCurve);
    expect(power.powerKw).toBeGreaterThan(160);
    expect(power.rpm).toBeGreaterThan(5000);
  });

  it('computes power from torque and rpm', () => {
    expect(enginePowerKw(320, 4200)).toBeCloseTo(140.74, 1);
  });
});

describe('net engine torque', () => {
  it('scales combustion with throttle', () => {
    const full = engineNetTorque(SEDAN.engine, 4200, 1);
    const half = engineNetTorque(SEDAN.engine, 4200, 0.5);
    expect(full).toBeGreaterThan(280);
    expect(half).toBeLessThan(full);
    expect(half).toBeGreaterThan(100);
  });

  it('drags the driveline with a closed throttle', () => {
    expect(engineNetTorque(SEDAN.engine, 5000, 0)).toBeLessThan(0);
  });

  it('cuts torque past the rev limiter', () => {
    expect(engineNetTorque(SEDAN.engine, SEDAN.engine.redlineRpm + 400, 1)).toBeLessThan(0);
  });

  it('clamps the curve above the redline but below the limiter', () => {
    const atRedline = engineNetTorque(SEDAN.engine, SEDAN.engine.redlineRpm, 1);
    const beyond = engineNetTorque(SEDAN.engine, SEDAN.engine.redlineRpm + 500, 1);
    expect(atRedline).toBeGreaterThan(0);
    expect(beyond).toBeLessThan(0);
  });
});
