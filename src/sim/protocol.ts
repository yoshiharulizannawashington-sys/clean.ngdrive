import type { SurfaceId } from './surfaces';
import type { VehicleConfig } from './vehicle/types';

/** Shared message protocol between the main thread and the simulation worker. */

export const SIM_HZ = 120;
export const SNAPSHOT_HZ = 60;
export const PROTOCOL_VERSION = 1;

export interface SpawnPoint {
  position: [number, number, number];
  /** Yaw in radians about +Y. */
  yaw: number;
  /** Optional initial linear velocity in m/s (used by scenarios and tests). */
  velocity?: [number, number, number];
}

export interface InputState {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  /** 0..1 */
  handbrake: number;
  shiftUp: boolean;
  shiftDown: boolean;
}

export const NEUTRAL_INPUT: InputState = {
  throttle: 0,
  brake: 0,
  steer: 0,
  handbrake: 0,
  shiftUp: false,
  shiftDown: false,
};

export interface WheelSnapshot {
  steer: number;
  /** Accumulated visual rotation in radians. */
  spin: number;
  compression: number;
  contact: boolean;
  load: number;
  slipRatio: number;
  slipAngle: number;
  /** Surface material under this wheel. */
  surface: SurfaceId;
  /** Blended longitudinal grip multiplier (1 = dry asphalt). */
  grip: number;
}

export interface VehicleSnapshot {
  position: [number, number, number];
  rotation: [number, number, number, number];
  linearVelocity: [number, number, number];
  wheels: WheelSnapshot[];
  rpm: number;
  gear: number;
  speedKmh: number;
  throttle: number;
  brake: number;
  handbrake: number;
  steerAngle: number;
  /** False when the engine has stalled and is waiting to be restarted. */
  engineRunning: boolean;
  /** 0..1 clutch engagement. */
  clutchEngagement: number;
  /** Engine minus shaft angular velocity, rad/s (positive = clutch slipping). */
  clutchSlip: number;
}

export interface PropSnapshot {
  position: [number, number, number];
  rotation: [number, number, number, number];
}

export interface SimStats {
  /** Average time to compute one simulation step, in ms. */
  stepMs: number;
  /** Exponential moving average of step time, in ms. */
  averageStepMs: number;
  maxStepMs: number;
  simTime: number;
  steps: number;
  droppedTime: number;
  bodies: number;
}

export interface SimSnapshot {
  seq: number;
  /** Simulation time in milliseconds. */
  time: number;
  vehicle: VehicleSnapshot;
  props: PropSnapshot[];
  stats: SimStats;
}

export type MainToSim =
  | { type: 'init'; config: VehicleConfig; spawn: SpawnPoint }
  | { type: 'input'; input: InputState }
  | { type: 'set-running'; running: boolean }
  | { type: 'reset' }
  | { type: 'set-rate'; hz: number }
  | { type: 'dispose' };

export type SimToMain =
  | { type: 'ready'; version: string; world: string }
  | { type: 'snapshot'; snapshot: SimSnapshot }
  | { type: 'error'; message: string }
  | { type: 'fatal'; message: string };

const INPUT_FIELDS = ['throttle', 'brake', 'steer', 'handbrake'] as const;

/** Clamp incoming input to safe ranges so a bad message cannot destabilise the solver. */
export function sanitizeInput(input: Partial<InputState> | undefined): InputState {
  const safe: InputState = { ...NEUTRAL_INPUT };
  if (!input) return safe;
  for (const field of INPUT_FIELDS) {
    const value = input[field];
    safe[field] = typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(field === 'steer' ? -1 : 0, value)) : 0;
  }
  safe.shiftUp = input.shiftUp === true;
  safe.shiftDown = input.shiftDown === true;
  return safe;
}

/** Runtime validation for messages arriving from the main thread. */
export function isMainToSim(value: unknown): value is MainToSim {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return (
    type === 'init' ||
    type === 'input' ||
    type === 'set-running' ||
    type === 'reset' ||
    type === 'set-rate' ||
    type === 'dispose'
  );
}

/** Runtime validation for messages arriving from the worker. */
export function isSimToMain(value: unknown): value is SimToMain {
  if (typeof value !== 'object' || value === null) return false;
  const type = (value as { type?: unknown }).type;
  return type === 'ready' || type === 'snapshot' || type === 'error' || type === 'fatal';
}
