import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEDAN } from '../data/vehicles/sedan';
import { TEST_FACILITY } from '../data/maps/test-facility';
import { NEUTRAL_INPUT, type InputState } from '../src/sim/protocol';
import { createTestWorld } from '../src/sim/world';
import { VehicleSim } from '../src/sim/vehicle/vehicle';

/**
 * Integration tests for the real solver: Rapier rigid bodies, the raycast
 * suspension and the tire model, stepped exactly like the worker steps them.
 *
 * These are deterministic physics checks, not browser tests.
 */

const DT = 1 / 120;

beforeAll(async () => {
  const wasm = readFileSync(
    new URL('../node_modules/@dimforge/rapier3d-compat/dist/rapier_wasm3d_bg.wasm', import.meta.url),
  );
  const init = RAPIER.init as unknown as (input?: unknown) => Promise<void>;
  await init({ module_or_path: new Uint8Array(wasm) });
});

function createSim() {
  const world = createTestWorld();
  const vehicle = new VehicleSim(world.world, SEDAN, TEST_FACILITY.spawn);
  return { world, vehicle };
}

function run(
  sim: ReturnType<typeof createSim>,
  seconds: number,
  input: InputState = NEUTRAL_INPUT,
): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    sim.vehicle.step(DT, input);
    sim.world.step(DT);
  }
}

describe('vehicle solver integration', () => {
  it('settles onto its suspension at the spawn point', () => {
    const sim = createSim();
    run(sim, 2);
    const snapshot = sim.vehicle.snapshot();
    expect(snapshot.wheels.every((wheel) => wheel.contact)).toBe(true);
    // Static compression should be close to weight / spring rate.
    for (const wheel of snapshot.wheels) {
      expect(wheel.compression).toBeGreaterThan(0.05);
      expect(wheel.compression).toBeLessThan(0.2);
    }
    expect(snapshot.position[1]).toBeGreaterThan(0.4);
    expect(snapshot.position[1]).toBeLessThan(0.75);
  });

  it('stays parked at idle with no input', () => {
    const sim = createSim();
    run(sim, 6);
    const snapshot = sim.vehicle.snapshot();
    const drift = Math.abs(snapshot.position[2] - TEST_FACILITY.spawn.position[2]);
    expect(Math.abs(snapshot.speedKmh)).toBeLessThan(1);
    expect(drift).toBeLessThan(0.35);
  });

  it('accelerates forward under throttle', () => {
    const sim = createSim();
    run(sim, 1);
    run(sim, 5, { ...NEUTRAL_INPUT, throttle: 1 });
    const snapshot = sim.vehicle.snapshot();
    expect(snapshot.speedKmh).toBeGreaterThan(40);
    expect(snapshot.position[2]).toBeGreaterThan(TEST_FACILITY.spawn.position[2] + 20);
    expect(snapshot.rpm).toBeGreaterThan(1500);
  });

  it('brakes to a stop and does not roll away', () => {
    const sim = createSim();
    run(sim, 1);
    run(sim, 4, { ...NEUTRAL_INPUT, throttle: 1 });
    const moving = sim.vehicle.snapshot();
    expect(moving.speedKmh).toBeGreaterThan(30);

    run(sim, 3, { ...NEUTRAL_INPUT, brake: 1 });
    const stopped = sim.vehicle.snapshot();
    expect(Math.abs(stopped.speedKmh)).toBeLessThan(3);
  });

  it('transfers load to the outside wheels in a turn', () => {
    const sim = createSim();
    run(sim, 1);
    run(sim, 3, { ...NEUTRAL_INPUT, throttle: 0.5 });
    run(sim, 1.5, { ...NEUTRAL_INPUT, throttle: 0.4, steer: -1 });
    const snapshot = sim.vehicle.snapshot();
    // Steering left compresses the right-hand wheels.
    expect(snapshot.wheels[1].load).toBeGreaterThan(snapshot.wheels[0].load);
    expect(snapshot.wheels[3].load).toBeGreaterThan(snapshot.wheels[2].load);
  });

  it('locks the rear wheels with the handbrake', () => {
    const sim = createSim();
    run(sim, 1);
    run(sim, 3, { ...NEUTRAL_INPUT, throttle: 0.8 });
    run(sim, 1.2, { ...NEUTRAL_INPUT, handbrake: 1 });
    const snapshot = sim.vehicle.snapshot();
    // Locked rear wheels develop a large negative slip ratio while moving.
    expect(snapshot.wheels[2].slipRatio).toBeLessThan(-0.3);
    expect(snapshot.wheels[3].slipRatio).toBeLessThan(-0.3);
  });

  it('resets back to the spawn point', () => {
    const sim = createSim();
    run(sim, 3, { ...NEUTRAL_INPUT, throttle: 1 });
    sim.vehicle.reset();
    const snapshot = sim.vehicle.snapshot();
    expect(snapshot.speedKmh).toBeCloseTo(0, 5);
    expect(snapshot.position[0]).toBeCloseTo(TEST_FACILITY.spawn.position[0], 5);
    expect(snapshot.position[2]).toBeCloseTo(TEST_FACILITY.spawn.position[2], 5);
  });
});
