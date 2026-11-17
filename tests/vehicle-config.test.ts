import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import { validateVehicleConfig, type VehicleConfig } from '../src/sim/vehicle/types';
import { drivenWheelIndices, splitAxleTorque } from '../src/sim/vehicle/drivetrain';

function clone(): VehicleConfig {
  return structuredClone(SEDAN);
}

describe('vehicle definition', () => {
  it('accepts the shipped vehicle', () => {
    expect(validateVehicleConfig(SEDAN)).toEqual([]);
  });

  it('describes a road-legal sedan with plausible numbers', () => {
    expect(SEDAN.chassis.mass).toBeGreaterThan(1000);
    expect(SEDAN.chassis.mass).toBeLessThan(2200);
    expect(SEDAN.engine.torqueCurve.length).toBeGreaterThan(4);
    expect(SEDAN.transmission.gearRatios.length).toBe(5);
    expect(SEDAN.drivetrain.layout).toBe('RWD');
  });

  it('rejects zero mass', () => {
    const broken = clone();
    broken.chassis.mass = 0;
    expect(validateVehicleConfig(broken).join(' ')).toContain('mass');
  });

  it('rejects an invalid torque curve', () => {
    const broken = clone();
    broken.engine.torqueCurve = [
      { rpm: 4000, torque: 200 },
      { rpm: 3000, torque: 210 },
    ];
    expect(validateVehicleConfig(broken).join(' ')).toContain('strictly increase');
  });

  it('rejects a redline below idle', () => {
    const broken = clone();
    broken.engine.redlineRpm = 600;
    expect(validateVehicleConfig(broken).join(' ')).toContain('redline');
  });

  it('rejects negative gear ratios', () => {
    const broken = clone();
    broken.transmission.gearRatios = [3, -1, 0];
    expect(validateVehicleConfig(broken).join(' ')).toContain('gear ratios');
  });
});

describe('drivetrain layout', () => {
  it('drives the correct wheels', () => {
    expect(drivenWheelIndices('RWD')).toEqual([2, 3]);
    expect(drivenWheelIndices('FWD')).toEqual([0, 1]);
    expect(drivenWheelIndices('AWD')).toEqual([0, 1, 2, 3]);
  });

  it('splits torque by axle', () => {
    expect(splitAxleTorque('RWD', 0, 1000)).toEqual({ front: 0, rear: 1000 });
    expect(splitAxleTorque('FWD', 0, 1000)).toEqual({ front: 1000, rear: 0 });
    const awd = splitAxleTorque('AWD', 0.4, 1000);
    expect(awd.front).toBeCloseTo(400, 6);
    expect(awd.rear).toBeCloseTo(600, 6);
  });
});
