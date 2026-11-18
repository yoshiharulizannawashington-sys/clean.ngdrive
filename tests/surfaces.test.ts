import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import { SURFACES, surfaceGrip, type SurfaceId } from '../src/sim/surfaces';
import { tireForces } from '../src/sim/vehicle/tire';

const tire = SEDAN.tire;

describe('surface catalogue', () => {
  it('defines every required surface', () => {
    const required: SurfaceId[] = [
      'asphalt-dry',
      'asphalt-wet',
      'concrete',
      'gravel',
      'dirt',
      'mud',
      'grass',
      'sand',
      'snow',
      'ice',
    ];
    for (const id of required) {
      expect(SURFACES[id]).toBeDefined();
      expect(SURFACES[id].name.length).toBeGreaterThan(0);
    }
  });

  it('orders grip physically', () => {
    const dry = SURFACES['asphalt-dry'].gripLong;
    expect(dry).toBeGreaterThan(SURFACES['asphalt-wet'].gripLong);
    expect(SURFACES['asphalt-wet'].gripLong).toBeGreaterThan(SURFACES.gravel.gripLong);
    expect(SURFACES.gravel.gripLong).toBeGreaterThan(SURFACES.mud.gripLong);
    expect(SURFACES.mud.gripLong).toBeGreaterThan(SURFACES.snow.gripLong);
    expect(SURFACES.snow.gripLong).toBeGreaterThan(SURFACES.ice.gripLong);
  });

  it('uses separate longitudinal and lateral grip', () => {
    expect(SURFACES['asphalt-wet'].gripLat).toBeLessThan(SURFACES['asphalt-wet'].gripLong);
  });
});

describe('surface-dependent tire forces', () => {
  it('produces far less drive force on ice than on dry asphalt', () => {
    const input = { load: 4000, slipRatio: 0.12, slipAngle: 0, forwardSpeed: 10 };
    const dry = tireForces(tire, input, surfaceGrip(SURFACES['asphalt-dry']));
    const ice = tireForces(tire, input, surfaceGrip(SURFACES.ice));
    expect(Math.abs(ice.longitudinal)).toBeLessThan(Math.abs(dry.longitudinal) * 0.2);
  });

  it('produces less lateral grip on gravel than on dry asphalt', () => {
    const input = { load: 4000, slipRatio: 0, slipAngle: 0.09, forwardSpeed: 15 };
    const dry = tireForces(tire, input, surfaceGrip(SURFACES['asphalt-dry']));
    const gravel = tireForces(tire, input, surfaceGrip(SURFACES.gravel));
    expect(Math.abs(gravel.lateral)).toBeLessThan(Math.abs(dry.lateral));
  });

  it('keeps combined force inside the surface friction ellipse', () => {
    const grip = surfaceGrip(SURFACES.ice);
    const force = tireForces(tire, { load: 4500, slipRatio: 0.5, slipAngle: 0.5, forwardSpeed: 12 }, grip);
    const limit = tire.mu * 4500 * Math.max(grip.gripLong, grip.gripLat);
    expect(Math.hypot(force.longitudinal, force.lateral)).toBeLessThanOrEqual(limit * 1.02);
  });

  it('scales rolling resistance with the surface', () => {
    const asphalt = tireForces(
      tire,
      { load: 4000, slipRatio: 0, slipAngle: 0, forwardSpeed: 10 },
      surfaceGrip(SURFACES['asphalt-dry']),
    );
    const sand = tireForces(
      tire,
      { load: 4000, slipRatio: 0, slipAngle: 0, forwardSpeed: 10 },
      surfaceGrip(SURFACES.sand),
    );
    expect(sand.longitudinal).toBeLessThan(asphalt.longitudinal);
  });

  it('does not change force direction when a surface is applied', () => {
    const input = { load: 3500, slipRatio: 0.2, slipAngle: 0, forwardSpeed: 12 };
    const dry = tireForces(tire, input, surfaceGrip(SURFACES['asphalt-dry']));
    const snow = tireForces(tire, input, surfaceGrip(SURFACES.snow));
    expect(Math.sign(dry.longitudinal)).toBe(Math.sign(snow.longitudinal));
  });
});
