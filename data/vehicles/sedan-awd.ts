import { resolveVehicle, type VehicleDefinition } from '../../src/sim/vehicle/definition';
import {
  AERO_SEDAN,
  BRAKES_SEDAN,
  CHASSIS_SEDAN,
  CLUTCH_SPORT,
  DIFF_GEARED_LSD,
  DIFF_OPEN,
  ENGINE_TURBO_2_0,
  SUSPENSION_SPORT,
  TIRE_PERFORMANCE,
  TRANSMISSION_AUTO_5,
  WHEELS_SEDAN,
} from '../components';

/**
 * Falcon S4 AllTrac — the same chassis, engine, gearbox, clutch, suspension and
 * tires as the S4, with an all-wheel drivetrain. It exists to prove that the
 * definition resolver and the drivetrain (split, differentials) are genuinely
 * data-driven, and it is used by the AWD handling tests.
 */
export const SEDAN_AWD_DEFINITION: VehicleDefinition = {
  ...structuredClone({
    id: 'falcon-s4-alltrac',
    name: 'Falcon S4 AllTrac',
    manufacturer: 'Browser Drive',
    category: 'Sport sedan',
    years: '2026',
    summary: 'Falcon S4 with an all-wheel drivetrain, 40/60 torque split and a geared rear LSD.',
    color: 0x1f4f7a,
    chassis: CHASSIS_SEDAN,
    wheels: WHEELS_SEDAN,
    suspension: SUSPENSION_SPORT,
    tire: TIRE_PERFORMANCE,
    engine: ENGINE_TURBO_2_0,
    clutch: CLUTCH_SPORT,
    transmission: TRANSMISSION_AUTO_5,
    brakes: BRAKES_SEDAN,
    aero: AERO_SEDAN,
  }),
  drivetrain: {
    layout: 'AWD',
    frontSplit: 0.4,
    frontDifferential: DIFF_OPEN,
    rearDifferential: DIFF_GEARED_LSD,
    centerDifferential: { ...DIFF_GEARED_LSD, maxLockTorque: 1200 },
  },
};

export const SEDAN_AWD = resolveVehicle(SEDAN_AWD_DEFINITION);
