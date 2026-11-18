/** Vehicle definition format. Every vehicle is data; the solver is generic. */

export type DrivetrainLayout = 'FWD' | 'RWD' | 'AWD';
export type TransmissionType = 'automatic' | 'manual';
export type DifferentialType = 'open' | 'clutch-lsd' | 'geared-lsd' | 'viscous' | 'locking';

export interface TorquePoint {
  rpm: number;
  torque: number;
}

export interface ChassisConfig {
  /** Total vehicle mass in kg. */
  mass: number;
  /** Collision box half-extents (x = half width, y = half height, z = half length). */
  halfExtents: [number, number, number];
  wheelbase: number;
  track: number;
  /** Local z of the front and rear axle centres (positive z is forward). */
  frontAxleZ: number;
  rearAxleZ: number;
  /** Local y of the suspension mount points. */
  mountHeight: number;
  /** Principal moments of inertia in kg m^2. */
  inertia: { pitch: number; yaw: number; roll: number };
}

export interface WheelConfig {
  radius: number;
  width: number;
  /** Rotational inertia of the wheel assembly in kg m^2. */
  inertia: number;
}

export interface SuspensionConfig {
  restLength: number;
  maxCompression: number;
  bumpStopRate: number;
  springRateFront: number;
  springRateRear: number;
  bumpDampingFront: number;
  bumpDampingRear: number;
  reboundDampingFront: number;
  reboundDampingRear: number;
  antiRollFront: number;
  antiRollRear: number;
}

/**
 * Magic-formula tire coefficients. `mu` is the nominal friction coefficient at
 * `nominalLoad`; everything else shapes the slip curves. Surface grip is applied
 * on top of these values by the solver.
 */
export interface TireConfig {
  mu: number;
  bLong: number;
  cLong: number;
  eLong: number;
  bLat: number;
  cLat: number;
  eLat: number;
  nominalLoad: number;
  loadSensitivity: number;
  /** Rolling resistance coefficient on a rigid reference surface. */
  rollingResistance: number;
}

export interface IdleControlConfig {
  targetRpm: number;
  /** Throttle-independent idle torque, Nm per rpm of error. */
  proportional: number;
  /** Nm per (rpm * second) of accumulated error. */
  integral: number;
  /** Cap on idle governor torque, Nm. */
  maxTorque: number;
}

export interface EngineConfig {
  idleRpm: number;
  redlineRpm: number;
  stallRpm: number;
  starterTorque: number;
  /** Internal friction torque at operating temperature (engine running). */
  frictionTorque: number;
  /** Additional braking torque at redline with a closed throttle. */
  engineBraking: number;
  /** Crankshaft + flywheel rotational inertia, kg m^2. */
  inertia: number;
  torqueCurve: TorquePoint[];
  idleControl: IdleControlConfig;
  /** Seconds below `stallRpm` before the engine stalls. */
  stallTime: number;
}

/**
 * Automatic clutch. Torque capacity is `maxTorque * engagement`; engagement is
 * driven by throttle/rpm at low speed and locks once the car is rolling.
 */
export interface ClutchConfig {
  /** Torque capacity when fully engaged, Nm. */
  maxTorque: number;
  /** Rotational inertia of the clutch disc and input shaft, kg m^2. */
  inertia: number;
  /** Time constant for engagement (s). */
  engageTime: number;
  /** Time constant for disengagement (s). */
  releaseTime: number;
  /** Engine rpm at which full throttle engages the clutch fully. */
  launchRpm: number;
  /** Road speed (m/s) above which the clutch locks regardless of rpm. */
  lockSpeed: number;
  /** Engagement that remains at a standstill with the throttle closed (0 = no creep). */
  creepEngagement: number;
  /** Slip speed (rad/s) at which the clutch reaches ~76% of its capacity. */
  slipScale: number;
}

export interface DifferentialConfig {
  type: DifferentialType;
  /** Locking torque present without any input torque, Nm. */
  preload: number;
  /** Static torque bias ratio (slow wheel torque / fast wheel torque). */
  torqueBias: number;
  /** Fraction of input torque that may be transferred across the axle. */
  lockingStrength: number;
  /** Viscous coupling coefficient, Nm per rad/s of speed difference. */
  viscosity: number;
  /** Hard cap on the locking torque, Nm. */
  maxLockTorque: number;
}

export interface TransmissionConfig {
  type: TransmissionType;
  /** Ratios for 1st..top gear (index 0 = 1st). */
  gearRatios: number[];
  reverseRatio: number;
  finalDrive: number;
  efficiency: number;
  shiftTime: number;
  upshiftRpm: number;
  downshiftRpm: number;
  kickdownRpm: number;
}

export interface DrivetrainConfig {
  layout: DrivetrainLayout;
  /** Share of torque sent to the front axle for AWD. */
  frontSplit: number;
  frontDifferential: DifferentialConfig;
  rearDifferential: DifferentialConfig;
  /** Centre coupling for AWD; null means a fixed torque split. */
  centerDifferential: DifferentialConfig | null;
}

export interface BrakeConfig {
  maxTorqueFront: number;
  maxTorqueRear: number;
  handbrakeTorque: number;
}

export interface AeroConfig {
  dragCoefficient: number;
  frontalArea: number;
  downforceCoefficient: number;
}

export interface VehicleConfig {
  id: string;
  name: string;
  manufacturer: string;
  category: string;
  years: string;
  summary: string;
  color: number;
  chassis: ChassisConfig;
  wheelFront: WheelConfig;
  wheelRear: WheelConfig;
  suspension: SuspensionConfig;
  tire: TireConfig;
  engine: EngineConfig;
  clutch: ClutchConfig;
  transmission: TransmissionConfig;
  drivetrain: DrivetrainConfig;
  brakes: BrakeConfig;
  aero: AeroConfig;
}

const DIFFERENTIAL_TYPES: DifferentialType[] = [
  'open',
  'clutch-lsd',
  'geared-lsd',
  'viscous',
  'locking',
];

function validateDifferential(
  label: string,
  differential: DifferentialConfig | null,
  problems: string[],
): void {
  if (!differential) return;
  if (!DIFFERENTIAL_TYPES.includes(differential.type)) {
    problems.push(`${label}.type "${differential.type}" is not a known differential`);
  }
  for (const field of ['preload', 'lockingStrength', 'viscosity', 'maxLockTorque'] as const) {
    if (!(differential[field] >= 0)) problems.push(`${label}.${field} must not be negative`);
  }
  if (!(differential.torqueBias >= 1)) problems.push(`${label}.torqueBias must be at least 1`);
  if (differential.type !== 'open' && !(differential.maxLockTorque > 0)) {
    problems.push(`${label}.maxLockTorque must be positive for a locking differential`);
  }
}

/** Structural validation so a broken vehicle definition fails loudly. */
export function validateVehicleConfig(config: VehicleConfig): string[] {
  const problems: string[] = [];
  const { chassis, suspension, engine, transmission, tire, brakes, aero, clutch } = config;

  if (!config.id) problems.push('id is required');
  if (!(chassis.mass > 0)) problems.push('chassis.mass must be positive');
  if (!chassis.halfExtents.every((v) => v > 0)) problems.push('chassis.halfExtents must be positive');
  if (!(chassis.wheelbase > 0)) problems.push('chassis.wheelbase must be positive');
  if (!(chassis.track > 0)) problems.push('chassis.track must be positive');
  if (chassis.frontAxleZ === chassis.rearAxleZ) problems.push('front and rear axles must differ');
  if (!chassis.inertia || !(chassis.inertia.pitch > 0 && chassis.inertia.yaw > 0 && chassis.inertia.roll > 0)) {
    problems.push('chassis.inertia entries must be positive');
  }

  for (const [label, wheel] of [
    ['front', config.wheelFront],
    ['rear', config.wheelRear],
  ] as const) {
    if (!(wheel.radius > 0)) problems.push(`${label} wheel radius must be positive`);
    if (!(wheel.width > 0)) problems.push(`${label} wheel width must be positive`);
    if (!(wheel.inertia > 0)) problems.push(`${label} wheel inertia must be positive`);
  }

  if (!(suspension.restLength > 0)) problems.push('suspension.restLength must be positive');
  if (!(suspension.maxCompression > 0)) problems.push('suspension.maxCompression must be positive');
  if (!(suspension.springRateFront > 0 && suspension.springRateRear > 0)) {
    problems.push('spring rates must be positive');
  }
  if (suspension.bumpDampingFront < 0 || suspension.reboundDampingRear < 0) {
    problems.push('damping values must not be negative');
  }

  if (!(tire.mu > 0)) problems.push('tire.mu must be positive');
  if (!(tire.nominalLoad > 0)) problems.push('tire.nominalLoad must be positive');

  if (!(engine.idleRpm > 0)) problems.push('engine.idleRpm must be positive');
  if (!(engine.redlineRpm > engine.idleRpm)) problems.push('engine redline must exceed idle');
  if (!(engine.inertia > 0)) problems.push('engine.inertia must be positive');
  if (!(engine.stallRpm > 0 && engine.stallRpm < engine.idleRpm)) {
    problems.push('engine.stallRpm must be positive and below idle');
  }
  if (!(engine.stallTime > 0)) problems.push('engine.stallTime must be positive');
  if (!engine.idleControl) {
    problems.push('engine.idleControl is required');
  } else {
    if (!(engine.idleControl.targetRpm > 0)) problems.push('engine.idleControl.targetRpm must be positive');
    if (!(engine.idleControl.maxTorque >= 0)) problems.push('engine.idleControl.maxTorque must not be negative');
  }
  if (engine.torqueCurve.length < 2) problems.push('engine torque curve needs at least two points');
  for (let i = 1; i < engine.torqueCurve.length; i += 1) {
    if (engine.torqueCurve[i].rpm <= engine.torqueCurve[i - 1].rpm) {
      problems.push('engine torque curve rpm values must strictly increase');
      break;
    }
  }

  if (!(clutch.maxTorque > 0)) problems.push('clutch.maxTorque must be positive');
  if (!(clutch.inertia >= 0)) problems.push('clutch.inertia must not be negative');
  if (!(clutch.engageTime > 0) || !(clutch.releaseTime > 0)) {
    problems.push('clutch engage/release times must be positive');
  }
  if (!(clutch.launchRpm > engine.idleRpm)) problems.push('clutch.launchRpm must exceed idle');
  if (clutch.creepEngagement < 0 || clutch.creepEngagement > 1) {
    problems.push('clutch.creepEngagement must be within [0, 1]');
  }
  if (!(clutch.slipScale > 0)) problems.push('clutch.slipScale must be positive');

  if (transmission.gearRatios.length === 0) problems.push('at least one gear ratio is required');
  if (transmission.gearRatios.some((r) => !(r > 0))) problems.push('gear ratios must be positive');
  if (!(transmission.reverseRatio > 0)) problems.push('reverse ratio must be positive');
  if (!(transmission.finalDrive > 0)) problems.push('final drive must be positive');
  if (!(transmission.efficiency > 0 && transmission.efficiency <= 1)) {
    problems.push('transmission efficiency must be in (0, 1]');
  }

  if (!['FWD', 'RWD', 'AWD'].includes(config.drivetrain.layout)) {
    problems.push(`unknown drivetrain layout "${config.drivetrain.layout}"`);
  }
  if (config.drivetrain.frontSplit < 0 || config.drivetrain.frontSplit > 1) {
    problems.push('drivetrain.frontSplit must be within [0, 1]');
  }
  validateDifferential('drivetrain.frontDifferential', config.drivetrain.frontDifferential, problems);
  validateDifferential('drivetrain.rearDifferential', config.drivetrain.rearDifferential, problems);
  validateDifferential('drivetrain.centerDifferential', config.drivetrain.centerDifferential, problems);

  if ([brakes.maxTorqueFront, brakes.maxTorqueRear, brakes.handbrakeTorque].some((v) => v < 0)) {
    problems.push('brake torques must not be negative');
  }
  if (!(aero.dragCoefficient >= 0 && aero.frontalArea > 0)) problems.push('aero values are invalid');

  return problems;
}
