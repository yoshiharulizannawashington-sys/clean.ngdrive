import type {
  AeroConfig,
  BrakeConfig,
  ChassisConfig,
  ClutchConfig,
  DifferentialConfig,
  EngineConfig,
  SuspensionConfig,
  TireConfig,
  TransmissionConfig,
  WheelConfig,
} from '../../src/sim/vehicle/types';

/**
 * Reusable vehicle components.
 *
 * Vehicles are assembled from these objects, so an engine, gearbox or
 * differential can be shared by several cars without duplicating numbers. The
 * resolver clones everything before handing it to the solver, so one vehicle can
 * never mutate another's data.
 */

export const ENGINE_TURBO_2_0: EngineConfig = {
  idleRpm: 780,
  redlineRpm: 6500,
  stallRpm: 400,
  starterTorque: 120,
  frictionTorque: 22,
  engineBraking: 62,
  inertia: 0.22,
  torqueCurve: [
    { rpm: 700, torque: 180 },
    { rpm: 1500, torque: 240 },
    { rpm: 2500, torque: 290 },
    { rpm: 3500, torque: 310 },
    { rpm: 4200, torque: 320 },
    { rpm: 5000, torque: 305 },
    { rpm: 5800, torque: 280 },
    { rpm: 6500, torque: 245 },
  ],
  idleControl: { targetRpm: 780, proportional: 0.35, integral: 0.9, maxTorque: 120 },
  stallTime: 0.25,
};

export const CLUTCH_SPORT: ClutchConfig = {
  maxTorque: 420,
  inertia: 0.03,
  engageTime: 0.22,
  releaseTime: 0.08,
  launchRpm: 1800,
  lockSpeed: 3,
  creepEngagement: 0,
  slipScale: 18,
};

export const TRANSMISSION_AUTO_5: TransmissionConfig = {
  type: 'automatic',
  gearRatios: [3.55, 2.1, 1.4, 1.0, 0.8],
  reverseRatio: 3.4,
  finalDrive: 3.73,
  efficiency: 0.92,
  shiftTime: 0.4,
  upshiftRpm: 6000,
  downshiftRpm: 1900,
  kickdownRpm: 3200,
};

export const TRANSMISSION_MANUAL_6: TransmissionConfig = {
  type: 'manual',
  gearRatios: [3.8, 2.4, 1.7, 1.3, 1.05, 0.85],
  reverseRatio: 3.5,
  finalDrive: 3.55,
  efficiency: 0.94,
  shiftTime: 0.25,
  upshiftRpm: 6400,
  downshiftRpm: 2200,
  kickdownRpm: 3500,
};

export const DIFF_OPEN: DifferentialConfig = {
  type: 'open',
  preload: 0,
  torqueBias: 1,
  lockingStrength: 0,
  viscosity: 0,
  maxLockTorque: 0,
};

export const DIFF_CLUTCH_LSD: DifferentialConfig = {
  type: 'clutch-lsd',
  preload: 45,
  torqueBias: 2.4,
  lockingStrength: 0.35,
  viscosity: 0,
  maxLockTorque: 700,
};

export const DIFF_GEARED_LSD: DifferentialConfig = {
  type: 'geared-lsd',
  preload: 25,
  torqueBias: 2.1,
  lockingStrength: 0.4,
  viscosity: 0,
  maxLockTorque: 650,
};

export const DIFF_LOCKER: DifferentialConfig = {
  type: 'locking',
  preload: 0,
  torqueBias: 1,
  lockingStrength: 1,
  viscosity: 0,
  maxLockTorque: 4000,
};

export const DIFF_VISCOUS: DifferentialConfig = {
  type: 'viscous',
  preload: 0,
  torqueBias: 1,
  lockingStrength: 0,
  viscosity: 180,
  maxLockTorque: 500,
};

export const TIRE_PERFORMANCE: TireConfig = {
  mu: 0.95,
  bLong: 10,
  cLong: 1.65,
  eLong: 0.95,
  bLat: 16,
  cLat: 1.35,
  eLat: 0.94,
  nominalLoad: 4000,
  loadSensitivity: 0.12,
  rollingResistance: 0.014,
};

export const SUSPENSION_SPORT: SuspensionConfig = {
  restLength: 0.3,
  maxCompression: 0.22,
  bumpStopRate: 220000,
  springRateFront: 34000,
  springRateRear: 30000,
  bumpDampingFront: 4200,
  bumpDampingRear: 3900,
  reboundDampingFront: 5200,
  reboundDampingRear: 4900,
  antiRollFront: 12000,
  antiRollRear: 8000,
};

export const CHASSIS_SEDAN: ChassisConfig = {
  mass: 1520,
  halfExtents: [0.86, 0.43, 2.2],
  wheelbase: 2.75,
  track: 1.58,
  frontAxleZ: 1.375,
  rearAxleZ: -1.375,
  mountHeight: -0.05,
  // Roll inertia is deliberately lower than a uniform box: real vehicle mass is
  // concentrated low in the chassis.
  inertia: { pitch: 2200, yaw: 2750, roll: 760 },
};

export const WHEELS_SEDAN: { front: WheelConfig; rear: WheelConfig } = {
  front: { radius: 0.34, width: 0.235, inertia: 1.15 },
  rear: { radius: 0.34, width: 0.255, inertia: 1.25 },
};

export const BRAKES_SEDAN: BrakeConfig = {
  maxTorqueFront: 2400,
  maxTorqueRear: 1600,
  handbrakeTorque: 3200,
};

export const AERO_SEDAN: AeroConfig = {
  dragCoefficient: 0.31,
  frontalArea: 2.18,
  downforceCoefficient: 0.32,
};
