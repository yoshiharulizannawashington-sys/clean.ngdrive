import type { VehicleConfig } from '../../src/sim/vehicle/types';
import { validateVehicleConfig } from '../../src/sim/vehicle/types';

/**
 * Sedan archetype: front-engine, rear-wheel-drive sport sedan.
 *
 * All values are engineering estimates for an original vehicle, not copies of a
 * real car's data. Torque is in Nm, mass in kg, distances in metres.
 */
export const SEDAN: VehicleConfig = {
  id: 'falcon-s4',
  name: 'Falcon S4',
  manufacturer: 'Browser Drive',
  category: 'Sport sedan',
  years: '2026',
  summary: '2.0L turbocharged inline-four, rear-wheel drive, six-speed automatic.',
  color: 0x9b1f24,

  chassis: {
    mass: 1520,
    halfExtents: [0.86, 0.43, 2.2],
    wheelbase: 2.75,
    track: 1.58,
    frontAxleZ: 1.375,
    rearAxleZ: -1.375,
    mountHeight: -0.05,
    // Principal moments of inertia. Roll inertia is deliberately lower than a
    // uniform box: real vehicle mass is concentrated low in the chassis.
    inertia: { pitch: 2200, yaw: 2750, roll: 760 },
  },

  wheelFront: { radius: 0.34, width: 0.235, inertia: 1.15 },
  wheelRear: { radius: 0.34, width: 0.255, inertia: 1.25 },

  suspension: {
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
  },

  tire: {
    mu: 0.95,
    bLong: 10,
    cLong: 1.65,
    eLong: 0.95,
    bLat: 12,
    cLat: 1.35,
    eLat: 0.94,
    nominalLoad: 4000,
    loadSensitivity: 0.12,
    rollingResistance: 0.014,
  },

  engine: {
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
  },

  transmission: {
    type: 'automatic',
    gearRatios: [3.55, 2.1, 1.4, 1.0, 0.8],
    reverseRatio: 3.4,
    finalDrive: 3.73,
    efficiency: 0.92,
    shiftTime: 0.4,
    upshiftRpm: 6000,
    downshiftRpm: 1900,
    kickdownRpm: 3200,
  },

  drivetrain: { layout: 'RWD', frontSplit: 0 },

  brakes: { maxTorqueFront: 2400, maxTorqueRear: 1600, handbrakeTorque: 3200 },

  aero: { dragCoefficient: 0.31, frontalArea: 2.18, downforceCoefficient: 0.32 },
};

const problems = validateVehicleConfig(SEDAN);
if (problems.length > 0) {
  throw new Error(`Invalid vehicle definition "${SEDAN.id}": ${problems.join('; ')}`);
}
