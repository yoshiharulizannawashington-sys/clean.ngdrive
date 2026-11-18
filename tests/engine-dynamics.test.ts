import { describe, expect, it } from 'vitest';
import { SEDAN } from '../data/vehicles/sedan';
import { Engine } from '../src/sim/vehicle/engine';

const DT = 1 / 120;

function run(engine: Engine, seconds: number, throttle: number, loadTorque: number): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) engine.update(DT, throttle, loadTorque);
}

describe('engine rotational dynamics', () => {
  it('has its own angular velocity and inertia', () => {
    const engine = new Engine(SEDAN.engine);
    expect(engine.rpm).toBeCloseTo(SEDAN.engine.idleRpm, 0);
    expect(engine.angularVelocity).toBeGreaterThan(0);
    expect(SEDAN.engine.inertia).toBeGreaterThan(0);
  });

  it('holds idle with the governor and no load', () => {
    const engine = new Engine(SEDAN.engine);
    run(engine, 6, 0, 0);
    expect(engine.rpm).toBeGreaterThan(SEDAN.engine.idleRpm - 120);
    expect(engine.rpm).toBeLessThan(SEDAN.engine.idleRpm + 150);
    expect(engine.isRunning).toBe(true);
  });

  it('accelerates against its own inertia and hits the limiter, not infinity', () => {
    const engine = new Engine(SEDAN.engine);
    run(engine, 2, 1, 0);
    expect(engine.rpm).toBeGreaterThan(SEDAN.engine.idleRpm + 1500);
    run(engine, 4, 1, 0);
    expect(engine.rpm).toBeLessThanOrEqual(SEDAN.engine.redlineRpm * 1.05);
    expect(engine.rpm).toBeGreaterThan(SEDAN.engine.redlineRpm - 400);
  });

  it('takes real time to rev (inertia, not an instant rpm target)', () => {
    const engine = new Engine(SEDAN.engine);
    let timeTo3000 = -1;
    for (let i = 0; i < 120 * 3; i += 1) {
      engine.update(DT, 1, 0);
      if (timeTo3000 < 0 && engine.rpm >= 3000) timeTo3000 = i * DT;
    }
    expect(timeTo3000).toBeGreaterThan(0.12);
    expect(timeTo3000).toBeLessThan(2.5);
  });

  it('drops under load instead of holding a target rpm', () => {
    const engine = new Engine(SEDAN.engine);
    run(engine, 1, 1, 0);
    const free = engine.rpm;
    run(engine, 1, 1, 600);
    expect(engine.rpm).toBeLessThan(free - 200);
  });

  it('stalls when the load exceeds what it can produce', () => {
    const engine = new Engine(SEDAN.engine);
    run(engine, 3, 0.2, 700);
    expect(engine.isRunning).toBe(false);
    expect(engine.rpm).toBeLessThan(SEDAN.engine.stallRpm);
  });

  it('restarts on the starter motor', () => {
    const engine = new Engine(SEDAN.engine);
    engine.stall();
    expect(engine.isRunning).toBe(false);
    run(engine, 1.5, 1, 0);
    expect(engine.isRunning).toBe(true);
    expect(engine.rpm).toBeGreaterThan(SEDAN.engine.idleRpm * 0.5);
  });

  it('produces engine braking torque with a closed throttle', () => {
    const engine = new Engine(SEDAN.engine);
    const torque = engine.torque(DT, 0);
    expect(torque).toBeLessThan(0);

    const coasting = new Engine(SEDAN.engine);
    run(coasting, 1, 0, 0);
    const before = coasting.rpm;
    run(coasting, 1, 0, 30);
    expect(coasting.rpm).toBeLessThan(before);
  });

  it('is not spun backwards by a reverse load; it stalls instead', () => {
    const engine = new Engine(SEDAN.engine);
    run(engine, 2, 1, 900);
    expect(engine.angularVelocity).toBeGreaterThanOrEqual(0);
    expect(engine.isRunning).toBe(false);
  });
});
