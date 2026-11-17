import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import {
  Transmission,
  gearRatioFor,
  wheelRpmFromWheelOmega,
} from '../src/sim/vehicle/transmission';
import type { TransmissionInput } from '../src/sim/vehicle/transmission';

const config = SEDAN.transmission;

const neutralInput: TransmissionInput = {
  rpm: 1000,
  throttle: 0,
  speed: 0,
  brake: 0,
  shiftUp: false,
  shiftDown: false,
};

describe('gear ratios', () => {
  it('maps gears, reverse and neutral', () => {
    expect(gearRatioFor(config, 1)).toBe(3.55);
    expect(gearRatioFor(config, 5)).toBe(0.8);
    expect(gearRatioFor(config, 0)).toBe(0);
    expect(gearRatioFor(config, -1)).toBe(-3.4);
    expect(gearRatioFor(config, 9)).toBe(0);
  });

  it('converts wheel speed to engine rpm', () => {
    expect(wheelRpmFromWheelOmega(100, 3.55, 3.73)).toBeCloseTo(12644.7, 1);
  });
});

describe('automatic transmission', () => {
  it('upshifts above the upshift rpm', () => {
    const gearbox = new Transmission(config);
    const update = gearbox.update(0.016, { ...neutralInput, rpm: 6200, throttle: 0.8, speed: 30 });
    expect(gearbox.gear).toBe(2);
    expect(update.shifted).toBe(true);
    expect(update.torqueCut).toBe(true);
  });

  it('does not shift again while a shift is in progress', () => {
    const gearbox = new Transmission(config);
    gearbox.update(0.016, { ...neutralInput, rpm: 6200, throttle: 0.8, speed: 30 });
    gearbox.update(0.016, { ...neutralInput, rpm: 6200, throttle: 0.8, speed: 30 });
    expect(gearbox.gear).toBe(2);
    // Shift completes with realistic post-shift rpm for 2nd gear.
    gearbox.update(config.shiftTime + 0.01, { ...neutralInput, rpm: 3800, throttle: 0.5, speed: 30 });
    expect(gearbox.shifting).toBe(false);
    expect(gearbox.gear).toBe(2);
    gearbox.update(0.016, { ...neutralInput, rpm: 6200, throttle: 0.8, speed: 45 });
    expect(gearbox.gear).toBe(3);
  });

  it('downshifts below the downshift rpm', () => {
    const gearbox = new Transmission(config);
    gearbox.update(0.016, { ...neutralInput, rpm: 6200, throttle: 0.8, speed: 30 });
    gearbox.update(config.shiftTime + 0.02, { ...neutralInput, rpm: 3800, throttle: 0.5, speed: 30 });
    gearbox.update(0.016, { ...neutralInput, rpm: 6200, throttle: 0.8, speed: 45 });
    gearbox.update(config.shiftTime + 0.02, { ...neutralInput, rpm: 4200, throttle: 0.5, speed: 45 });
    expect(gearbox.gear).toBe(3);
    gearbox.update(0.016, { ...neutralInput, rpm: 1400, throttle: 0.1, speed: 12 });
    expect(gearbox.gear).toBe(2);
  });

  it('engages reverse from a standstill on the brake', () => {
    const gearbox = new Transmission(config);
    gearbox.update(0.016, { ...neutralInput, brake: 0.6, speed: 0 });
    expect(gearbox.gear).toBe(-1);
    // The reverse shift itself takes shiftTime before another change is allowed.
    gearbox.update(config.shiftTime + 0.02, { ...neutralInput, brake: 0.4, speed: -1 });
    expect(gearbox.gear).toBe(-1);
    gearbox.update(0.016, { ...neutralInput, throttle: 0.5, speed: 0 });
    expect(gearbox.gear).toBe(1);
  });

  it('cuts torque while shifting', () => {
    const gearbox = new Transmission(config);
    const update = gearbox.update(0.016, { ...neutralInput, rpm: 6200, throttle: 0.8, speed: 30 });
    expect(update.torqueCut).toBe(true);
  });
});

describe('manual transmission', () => {
  const manual = { ...config, type: 'manual' as const };

  it('never shifts on its own', () => {
    const gearbox = new Transmission(manual);
    gearbox.update(0.016, { ...neutralInput, rpm: 7000, throttle: 1, speed: 40 });
    expect(gearbox.gear).toBe(1);
  });

  it('shifts on command and clamps at the ends', () => {
    const gearbox = new Transmission(manual);
    gearbox.update(0.016, { ...neutralInput, rpm: 3000, shiftUp: true });
    expect(gearbox.gear).toBe(2);
    gearbox.update(config.shiftTime + 0.02, neutralInput);
    gearbox.update(0.016, { ...neutralInput, rpm: 3000, shiftDown: true });
    expect(gearbox.gear).toBe(1);
    gearbox.update(config.shiftTime + 0.02, neutralInput);
    gearbox.update(0.016, { ...neutralInput, rpm: 3000, shiftDown: true });
    expect(gearbox.gear).toBe(1);
  });
});
