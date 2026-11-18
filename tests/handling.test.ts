import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import RAPIER from '@dimforge/rapier3d-compat';
import { SEDAN } from '../data/vehicles/sedan';
import { SEDAN_AWD } from '../data/vehicles/sedan-awd';
import { DIFF_LOCKER, DIFF_OPEN } from '../data/components';
import { TEST_FACILITY } from '../data/maps/test-facility';
import { NEUTRAL_INPUT, type InputState, type SpawnPoint, type VehicleSnapshot } from '../src/sim/protocol';
import { createTestWorld } from '../src/sim/world';
import { VehicleSim } from '../src/sim/vehicle/vehicle';
import { gearRatioFor } from '../src/sim/vehicle/transmission';
import type { VehicleConfig } from '../src/sim/vehicle/types';
import type { SurfaceId } from '../src/sim/surfaces';

/**
 * Handling regression suite.
 *
 * Each scenario starts from a documented initial condition, drives the real
 * solver (Rapier + suspension + tires + engine + clutch + differentials) at the
 * production 120 Hz step, and asserts a physical property that must hold.
 * They are self-consistent physics checks, not claims of real-world accuracy.
 */

const DT = 1 / 120;
const WHEEL_RADIUS = SEDAN.wheelRear.radius;

beforeAll(async () => {
  const wasm = readFileSync(
    new URL('../node_modules/@dimforge/rapier3d-compat/dist/rapier_wasm3d_bg.wasm', import.meta.url),
  );
  const init = RAPIER.init as unknown as (input?: unknown) => Promise<void>;
  await init({ module_or_path: new Uint8Array(wasm) });
});

interface Sim {
  world: ReturnType<typeof createTestWorld>;
  vehicle: VehicleSim;
}

function makeSim(
  config: VehicleConfig = SEDAN,
  spawn: SpawnPoint = TEST_FACILITY.spawn,
  surface?: SurfaceId,
): Sim {
  const world = createTestWorld(surface ? { surfaceOverride: surface } : {});
  const vehicle = new VehicleSim(world.world, config, spawn, (handle) => world.surfaceAt(handle));
  return { world, vehicle };
}

function step(sim: Sim, input: InputState): VehicleSnapshot {
  sim.vehicle.step(DT, input);
  sim.world.step(DT);
  return sim.vehicle.snapshot();
}

function run(sim: Sim, seconds: number, input: InputState = NEUTRAL_INPUT): VehicleSnapshot {
  const steps = Math.round(seconds / DT);
  let snapshot = sim.vehicle.snapshot();
  for (let i = 0; i < steps; i += 1) snapshot = step(sim, input);
  return snapshot;
}

function yawOf(rotation: [number, number, number, number]): number {
  const [x, y, z, w] = rotation;
  return Math.atan2(2 * (w * y + x * z), 1 - 2 * (y * y + z * z));
}

function roadRpm(snapshot: VehicleSnapshot): number {
  const ratio = gearRatioFor(SEDAN.transmission, snapshot.gear);
  if (Math.abs(ratio) < 1e-6) return 0;
  const wheelOmega = snapshot.speedKmh / 3.6 / WHEEL_RADIUS;
  return Math.abs((wheelOmega * ratio * SEDAN.transmission.finalDrive * 60) / (2 * Math.PI));
}

describe('acceleration and launch', () => {
  it('launches from rest with wheelspin and engine rpm flare', () => {
    const sim = makeSim();
    run(sim, 1);
    let maxSlip = 0;
    let maxFlare = 0;
    for (let i = 0; i < Math.round(3 / DT); i += 1) {
      const snapshot = step(sim, { ...NEUTRAL_INPUT, throttle: 1 });
      maxSlip = Math.max(maxSlip, Math.abs(snapshot.wheels[2].slipRatio), Math.abs(snapshot.wheels[3].slipRatio));
      maxFlare = Math.max(maxFlare, snapshot.rpm - roadRpm(snapshot));
    }
    const final = sim.vehicle.snapshot();
    expect(Math.abs(final.speedKmh)).toBeGreaterThan(35);
    expect(maxSlip).toBeGreaterThan(0.2);
    // Wheelspin drives the engine above the speed the road speed implies.
    expect(maxFlare).toBeGreaterThan(250);
  });

  it('accelerates in AWD too, with all four wheels driven', () => {
    const sim = makeSim(SEDAN_AWD);
    run(sim, 1);
    const snapshot = run(sim, 4, { ...NEUTRAL_INPUT, throttle: 1 });
    expect(Math.abs(snapshot.speedKmh)).toBeGreaterThan(35);
    expect(snapshot.wheels.every((wheel) => wheel.contact)).toBe(true);
  });

  it('upshifts and drops engine speed on the shift', () => {
    const sim = makeSim();
    run(sim, 1);
    let previous = sim.vehicle.snapshot();
    let previousGear = previous.gear;
    let shiftRpm = 0;
    let drop = 0;
    let shifts = 0;
    let stepsSinceShift = -1;

    for (let i = 0; i < Math.round(8 / DT); i += 1) {
      const snapshot = step(sim, { ...NEUTRAL_INPUT, throttle: 1 });
      if (snapshot.gear !== previousGear) {
        shifts += 1;
        shiftRpm = previous.rpm;
        stepsSinceShift = 0;
        previousGear = snapshot.gear;
      } else if (stepsSinceShift >= 0) {
        stepsSinceShift += 1;
        if (stepsSinceShift === Math.round(0.6 / DT)) {
          drop = Math.max(drop, shiftRpm - snapshot.rpm);
          stepsSinceShift = -1;
        }
      }
      previous = snapshot;
    }

    expect(shifts).toBeGreaterThanOrEqual(2);
    expect(drop).toBeGreaterThan(400);
    expect(Math.abs(previous.speedKmh)).toBeGreaterThan(80);
  });
});

describe('braking', () => {
  function brakeTest(surface?: SurfaceId): { entrySpeed: number; seconds: number; distance: number } {
    // Start at 50 km/h so both surfaces are tested at the same entry speed.
    const spawn: SpawnPoint = { position: [0, 0.62, -18], yaw: 0, velocity: [0, 0, 14] };
    const sim = makeSim(SEDAN, spawn, surface);
    run(sim, 0.4);
    const start = sim.vehicle.snapshot();
    let previous = start.position;
    let distance = 0;
    let seconds = 0;
    for (let i = 0; i < Math.round(15 / DT); i += 1) {
      const snapshot = step(sim, { ...NEUTRAL_INPUT, brake: 1 });
      distance += Math.hypot(
        snapshot.position[0] - previous[0],
        snapshot.position[2] - previous[2],
      );
      previous = snapshot.position;
      seconds += DT;
      if (Math.abs(snapshot.speedKmh) < 0.6) break;
    }
    return { entrySpeed: Math.abs(start.speedKmh) / 3.6, seconds, distance };
  }

  it('stops from speed on dry asphalt', () => {
    const result = brakeTest();
    expect(result.entrySpeed).toBeGreaterThan(12);
    expect(result.seconds).toBeLessThan(5);
    expect(result.distance).toBeLessThan(60);
  });

  it('needs far longer to stop on ice than on dry asphalt', () => {
    const dry = brakeTest();
    const ice = brakeTest('ice');
    // Same entry speed, so absolute distance and time are comparable.
    expect(Math.abs(ice.entrySpeed - dry.entrySpeed)).toBeLessThan(2);
    expect(ice.distance).toBeGreaterThan(dry.distance * 2);
    expect(ice.seconds).toBeGreaterThan(dry.seconds * 2);
  });

  it('does not roll away after stopping', () => {
    const sim = makeSim();
    run(sim, 1);
    run(sim, 4, { ...NEUTRAL_INPUT, throttle: 0.7 });
    run(sim, 3, { ...NEUTRAL_INPUT, brake: 1 });
    const stopped = sim.vehicle.snapshot();
    const after = run(sim, 2, { ...NEUTRAL_INPUT, brake: 1 });
    expect(Math.abs(after.speedKmh)).toBeLessThan(1.2);
    expect(Math.abs(after.position[2] - stopped.position[2])).toBeLessThan(0.2);
  });
});

describe('surface and differential traction', () => {
  function splitFrictionSlip(differential: VehicleConfig['drivetrain']['rearDifferential']): number {
    const config = structuredClone(SEDAN);
    config.drivetrain.rearDifferential = differential;
    // Straddle the split lane: dry asphalt under the left wheels, ice under the right.
    const sim = makeSim(config, { position: [32, 0.62, 165], yaw: 0 });
    run(sim, 1);
    const snapshot = run(sim, 2, { ...NEUTRAL_INPUT, throttle: 0.8 });
    return Math.abs(snapshot.wheels[3].slipRatio - snapshot.wheels[2].slipRatio);
  }

  it('a limited-slip differential reduces the split-friction wheel-speed difference', () => {
    const open = splitFrictionSlip(DIFF_OPEN);
    const lsd = splitFrictionSlip(SEDAN.drivetrain.rearDifferential);
    expect(lsd).toBeLessThan(open * 0.9);
  });

  it('a locking differential couples the wheels almost completely', () => {
    const open = splitFrictionSlip(DIFF_OPEN);
    const locker = splitFrictionSlip(DIFF_LOCKER);
    expect(locker).toBeLessThan(open * 0.6);
  });

  it('reduces available acceleration on ice compared with asphalt', () => {
    const dry = makeSim(SEDAN, TEST_FACILITY.spawn, 'asphalt-dry');
    const ice = makeSim(SEDAN, TEST_FACILITY.spawn, 'ice');
    run(dry, 1);
    run(ice, 1);
    const dryResult = run(dry, 4, { ...NEUTRAL_INPUT, throttle: 0.7 });
    const iceResult = run(ice, 4, { ...NEUTRAL_INPUT, throttle: 0.7 });
    expect(Math.abs(dryResult.speedKmh)).toBeGreaterThan(Math.abs(iceResult.speedKmh) * 2);
  });
});

describe('cornering and suspension', () => {
  it('builds lateral acceleration and turns into a corner', () => {
    const sim = makeSim(SEDAN, { position: [-46, 0.62, -40], yaw: 0 });
    run(sim, 1);
    // Build real road speed before turning: a burnout at walking pace is not a
    // cornering test.
    run(sim, 4, { ...NEUTRAL_INPUT, throttle: 0.6 });
    const start = sim.vehicle.snapshot();
    let maxLateral = 0;
    let previousYaw = yawOf(start.rotation);
    let turned = 0;

    for (let i = 0; i < Math.round(2 / DT); i += 1) {
      const snapshot = step(sim, { ...NEUTRAL_INPUT, throttle: 0.3, steer: -0.6 });
      const yaw = yawOf(snapshot.rotation);
      let delta = yaw - previousYaw;
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      turned += Math.abs(delta);
      previousYaw = yaw;
      const speed = Math.abs(snapshot.speedKmh) / 3.6;
      maxLateral = Math.max(maxLateral, speed * Math.abs(delta) / DT);
    }

    expect(turned).toBeGreaterThan(0.35);
    expect(maxLateral).toBeGreaterThan(2);
    const final = sim.vehicle.snapshot();
    // Steering left loads the right-hand wheels.
    expect(final.wheels[1].load).toBeGreaterThan(final.wheels[0].load);
  });

  it('absorbs articulation bumps and settles again', () => {
    const sim = makeSim(SEDAN, { position: [-32, 0.62, 22], yaw: 0 });
    run(sim, 1);
    let maxCompression = 0;
    for (let i = 0; i < Math.round(4 / DT); i += 1) {
      const snapshot = step(sim, { ...NEUTRAL_INPUT, throttle: 0.45 });
      maxCompression = Math.max(maxCompression, ...snapshot.wheels.map((wheel) => wheel.compression));
      expect(Number.isFinite(snapshot.position[1])).toBe(true);
    }
    expect(maxCompression).toBeGreaterThan(0.12);
    run(sim, 2, { ...NEUTRAL_INPUT, brake: 1 });
    const settled = run(sim, 1.5);
    for (const wheel of settled.wheels) {
      expect(wheel.contact).toBe(true);
      expect(wheel.compression).toBeGreaterThan(0.02);
      expect(Number.isFinite(wheel.compression)).toBe(true);
    }
  });
});

describe('numerical stability', () => {
  it('survives 20 seconds of continuous mixed input without exploding', () => {
    const sim = makeSim(SEDAN, { position: [-46, 0.62, -30], yaw: 0 });
    run(sim, 1);
    let peakSpeed = 0;
    let peakRpm = 0;
    let peakSlip = 0;

    for (let i = 0; i < Math.round(20 / DT); i += 1) {
      const t = i * DT;
      const input: InputState = {
        throttle: 0.55 + 0.3 * Math.sin(t * 0.9),
        brake: Math.sin(t * 0.5) > 0.93 ? 0.8 : 0,
        steer: 0.55 * Math.sin(t * 0.6),
        handbrake: Math.sin(t * 0.31) > 0.97 ? 1 : 0,
        shiftUp: false,
        shiftDown: false,
      };
      const snapshot = step(sim, input);
      for (const value of snapshot.position) expect(Number.isFinite(value)).toBe(true);
      expect(Number.isFinite(snapshot.rpm)).toBe(true);
      peakSpeed = Math.max(peakSpeed, Math.abs(snapshot.speedKmh));
      peakRpm = Math.max(peakRpm, snapshot.rpm);
      peakSlip = Math.max(peakSlip, ...snapshot.wheels.map((wheel) => Math.abs(wheel.slipRatio)));
    }

    expect(peakSpeed).toBeLessThan(140);
    expect(peakRpm).toBeLessThan(7600);
    expect(peakSlip).toBeLessThan(40);
    expect(sim.vehicle.snapshot().engineRunning).toBe(true);
  });

  it('resets engine and clutch state cleanly', () => {
    const sim = makeSim();
    run(sim, 3, { ...NEUTRAL_INPUT, throttle: 1 });
    const moving = sim.vehicle.snapshot();
    expect(Math.abs(moving.speedKmh)).toBeGreaterThan(20);

    sim.vehicle.reset();
    const reset = sim.vehicle.snapshot();
    expect(reset.speedKmh).toBeCloseTo(0, 5);
    expect(reset.rpm).toBeCloseTo(SEDAN.engine.idleRpm, 0);
    expect(reset.engineRunning).toBe(true);
    expect(reset.clutchEngagement).toBeCloseTo(0, 6);
  });
});
