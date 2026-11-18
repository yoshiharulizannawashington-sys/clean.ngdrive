import { describe, expect, it } from 'vitest';
import { checkVehicleDefinition, resolveVehicle, VehicleDefinitionError } from '../src/sim/vehicle/definition';
import { SEDAN, SEDAN_DEFINITION } from '../data/vehicles/sedan';
import { SEDAN_AWD } from '../data/vehicles/sedan-awd';
import { ENGINE_TURBO_2_0, TRANSMISSION_AUTO_5 } from '../data/components';

describe('vehicle definition architecture', () => {
  it('resolves to a solver-ready flat configuration', () => {
    const resolved = resolveVehicle(SEDAN_DEFINITION);
    expect(resolved.wheelFront).toEqual(SEDAN_DEFINITION.wheels.front);
    expect(resolved.wheelRear).toEqual(SEDAN_DEFINITION.wheels.rear);
    expect(resolved.clutch).toBeDefined();
    expect(resolved.engine).toBeDefined();
  });

  it('shares components between vehicles without sharing runtime objects', () => {
    expect(SEDAN_AWD.engine).toEqual(ENGINE_TURBO_2_0);
    expect(SEDAN_AWD.transmission).toEqual(TRANSMISSION_AUTO_5);
    expect(SEDAN.engine).not.toBe(SEDAN_AWD.engine);

    // Mutating one resolved vehicle cannot affect the shared component.
    SEDAN.chassis.mass = 9999;
    expect(SEDAN_AWD.chassis.mass).not.toBe(9999);
    expect(ENGINE_TURBO_2_0.idleRpm).toBe(780);
    SEDAN.chassis.mass = 1520;
  });

  it('keeps the rear differential configuration in data', () => {
    expect(SEDAN.drivetrain.rearDifferential.type).toBe('clutch-lsd');
    expect(SEDAN_AWD.drivetrain.rearDifferential.type).toBe('geared-lsd');
    expect(SEDAN_AWD.drivetrain.layout).toBe('AWD');
    expect(SEDAN_AWD.drivetrain.frontSplit).toBeCloseTo(0.4, 6);
  });

  it('reports every problem with a readable error', () => {
    const broken = structuredClone(SEDAN_DEFINITION);
    broken.chassis.mass = 0;
    broken.engine.redlineRpm = 500;
    const problems = checkVehicleDefinition(broken);
    expect(problems.join(' ')).toContain('mass');
    expect(problems.join(' ')).toContain('redline');

    expect(() => resolveVehicle(broken)).toThrow(VehicleDefinitionError);
    try {
      resolveVehicle(broken);
    } catch (error) {
      expect((error as Error).message).toContain('falcon-s4');
      expect((error as Error).message).toContain('mass');
    }
  });

  it('rejects an invalid differential configuration', () => {
    const broken = structuredClone(SEDAN_DEFINITION);
    broken.drivetrain.rearDifferential = {
      ...broken.drivetrain.rearDifferential,
      type: 'locking',
      maxLockTorque: 0,
    };
    expect(checkVehicleDefinition(broken).join(' ')).toContain('maxLockTorque');
  });
});
