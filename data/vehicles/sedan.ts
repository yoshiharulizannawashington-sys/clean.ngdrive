import { resolveVehicle, type VehicleDefinition } from '../../src/sim/vehicle/definition';
import {
  AERO_SEDAN,
  BRAKES_SEDAN,
  CHASSIS_SEDAN,
  CLUTCH_SPORT,
  DIFF_CLUTCH_LSD,
  DIFF_OPEN,
  ENGINE_TURBO_2_0,
  SUSPENSION_SPORT,
  TIRE_PERFORMANCE,
  TRANSMISSION_AUTO_5,
  WHEELS_SEDAN,
} from '../components';

/**
 * Falcon S4 — front-engine, rear-wheel-drive sport sedan.
 *
 * All values are engineering estimates for an original vehicle, not copies of a
 * real car's data. Torque is in Nm, mass in kg, distances in metres.
 */
export const SEDAN_DEFINITION: VehicleDefinition = {
  id: 'falcon-s4',
  name: 'Falcon S4',
  manufacturer: 'Browser Drive',
  category: 'Sport sedan',
  years: '2026',
  summary: '2.0L turbocharged inline-four, rear-wheel drive, five-speed automatic, clutch-type LSD.',
  color: 0x9b1f24,

  chassis: CHASSIS_SEDAN,
  wheels: WHEELS_SEDAN,
  suspension: SUSPENSION_SPORT,
  tire: TIRE_PERFORMANCE,
  engine: ENGINE_TURBO_2_0,
  clutch: CLUTCH_SPORT,
  transmission: TRANSMISSION_AUTO_5,
  drivetrain: {
    layout: 'RWD',
    frontSplit: 0,
    frontDifferential: DIFF_OPEN,
    rearDifferential: DIFF_CLUTCH_LSD,
    centerDifferential: null,
  },
  brakes: BRAKES_SEDAN,
  aero: AERO_SEDAN,
};

export const SEDAN = resolveVehicle(SEDAN_DEFINITION);
