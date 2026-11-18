import RAPIER from '@dimforge/rapier3d-compat';
import { TEST_FACILITY } from '../../data/maps/test-facility';
import {
  NEUTRAL_INPUT,
  PROTOCOL_VERSION,
  SIM_HZ,
  SNAPSHOT_HZ,
  isMainToSim,
  sanitizeInput,
  type InputState,
  type MainToSim,
  type SimSnapshot,
  type SimToMain,
  type SpawnPoint,
} from './protocol';
import { SimulationClock } from './simulation-clock';
import { createTestWorld, type SimWorld } from './world';
import { VehicleSim } from './vehicle/vehicle';
import { validateVehicleConfig, type VehicleConfig } from './vehicle/types';

/**
 * Simulation worker.
 *
 * Owns the authoritative world: it advances a fixed 120 Hz clock, runs the
 * vehicle solver and Rapier, and publishes snapshots at 60 Hz. The renderer
 * never steps physics and cannot change the timestep.
 */

const ctx = globalThis as unknown as {
  postMessage: (message: SimToMain) => void;
  addEventListener: (type: 'message', listener: (event: MessageEvent) => void) => void;
};

let simWorld: SimWorld | null = null;
let vehicle: VehicleSim | null = null;
let clock = new SimulationClock(SIM_HZ, 8);
let input: InputState = { ...NEUTRAL_INPUT };
let running = false;
let disposed = false;
let loopHandle: ReturnType<typeof setTimeout> | null = null;
let lastTick = 0;
let lastPublishTime = Number.NEGATIVE_INFINITY;
let sequence = 0;
let stepAverageMs = 0;
let stepMaxMs = 0;
let stepLastMs = 0;
let config: VehicleConfig | null = null;

function post(message: SimToMain): void {
  ctx.postMessage(message);
}

function publishSnapshot(): void {
  if (!vehicle || !simWorld) return;
  const snapshot: SimSnapshot = {
    seq: sequence,
    time: clock.time * 1000,
    vehicle: vehicle.snapshot(),
    props: simWorld.propSnapshots(),
    stats: {
      stepMs: stepLastMs,
      averageStepMs: stepAverageMs,
      maxStepMs: stepMaxMs,
      simTime: clock.time,
      steps: clock.steps,
      droppedTime: clock.dropped,
      bodies: simWorld.bodyCount(),
    },
  };
  sequence += 1;
  post({ type: 'snapshot', snapshot });
}

function tick(): void {
  if (disposed) return;
  loopHandle = setTimeout(tick, 4);

  const now = performance.now();
  const frameMs = lastTick === 0 ? 0 : Math.min(now - lastTick, 250);
  lastTick = now;

  if (!vehicle || !simWorld || !config || !running) return;

  try {
    const steps = clock.advance(frameMs);
    if (steps > 0) {
      const start = performance.now();
      for (let i = 0; i < steps; i += 1) {
        vehicle.step(clock.step, input);
        simWorld.step(clock.step);
      }
      stepLastMs = (performance.now() - start) / steps;
      stepAverageMs = stepAverageMs === 0 ? stepLastMs : stepAverageMs * 0.95 + stepLastMs * 0.05;
      stepMaxMs = Math.max(stepMaxMs, stepLastMs);
    }

    const simMs = clock.time * 1000;
    if (simMs - lastPublishTime >= 1000 / SNAPSHOT_HZ - 1e-6) {
      lastPublishTime = simMs;
      publishSnapshot();
    }
  } catch (error) {
    running = false;
    post({ type: 'fatal', message: `Simulation step failed: ${(error as Error).message}` });
  }
}

function startLoop(): void {
  if (loopHandle !== null) return;
  lastTick = performance.now();
  loopHandle = setTimeout(tick, 4);
}

async function initialize(nextConfig: VehicleConfig, spawn: SpawnPoint): Promise<void> {
  const problems = validateVehicleConfig(nextConfig);
  if (problems.length > 0) {
    post({ type: 'fatal', message: `Invalid vehicle definition: ${problems.join('; ')}` });
    return;
  }

  await RAPIER.init();

  simWorld = createTestWorld();
  vehicle = new VehicleSim(simWorld.world, nextConfig, spawn, (handle) =>
    simWorld ? simWorld.surfaceAt(handle) : 'asphalt-dry',
  );
  config = nextConfig;
  clock = new SimulationClock(SIM_HZ, 8);
  sequence = 0;
  stepAverageMs = 0;
  stepMaxMs = 0;
  stepLastMs = 0;
  lastPublishTime = Number.NEGATIVE_INFINITY;
  input = { ...NEUTRAL_INPUT };
  running = true;

  post({ type: 'ready', version: `protocol-${PROTOCOL_VERSION}`, world: TEST_FACILITY.name });
  publishSnapshot();
  startLoop();
}

ctx.addEventListener('message', (event: MessageEvent) => {
  const message = event.data as unknown;
  if (!isMainToSim(message)) {
    post({ type: 'error', message: 'Rejected malformed simulation message' });
    return;
  }

  const typed = message as MainToSim;
  switch (typed.type) {
    case 'init':
      void initialize(typed.config, typed.spawn).catch((error: unknown) => {
        post({ type: 'fatal', message: `Worker initialisation failed: ${(error as Error).message}` });
      });
      break;
    case 'input':
      input = sanitizeInput(typed.input);
      break;
    case 'set-running':
      running = typed.running;
      break;
    case 'reset':
      vehicle?.reset();
      input = { ...NEUTRAL_INPUT };
      break;
    case 'set-rate':
      if (typed.hz >= 30 && typed.hz <= 480) {
        clock = new SimulationClock(typed.hz, 8);
        stepAverageMs = 0;
        stepMaxMs = 0;
      }
      break;
    case 'dispose':
      disposed = true;
      running = false;
      if (loopHandle !== null) clearTimeout(loopHandle);
      loopHandle = null;
      simWorld?.world.free();
      simWorld = null;
      vehicle = null;
      break;
  }
});
