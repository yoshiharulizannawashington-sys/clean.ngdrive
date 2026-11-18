import type { VehicleConfig, WheelConfig } from './types';
import { validateVehicleConfig } from './types';

/**
 * Vehicle definition (authoring format).
 *
 * A definition keeps the wheel set grouped (`wheels.front` / `wheels.rear`), so
 * chassis, suspension, tires and wheels can be described as separate components.
 * `resolveVehicle` produces the flat `VehicleConfig` the solver consumes, after
 * validating it and cloning it so runtime state can never write back into shared
 * component objects.
 */
export type VehicleDefinition = Omit<VehicleConfig, 'wheelFront' | 'wheelRear'> & {
  wheels: { front: WheelConfig; rear: WheelConfig };
};

export class VehicleDefinitionError extends Error {
  constructor(
    readonly vehicleId: string,
    readonly problems: string[],
  ) {
    super(`Invalid vehicle "${vehicleId}": ${problems.join('; ')}`);
    this.name = 'VehicleDefinitionError';
  }
}

/**
 * Validate and flatten a definition. Throws `VehicleDefinitionError` with every
 * problem listed, so a broken vehicle fails at load time with an actionable
 * message instead of producing mysterious handling.
 */
export function resolveVehicle(definition: VehicleDefinition): VehicleConfig {
  const clone = structuredClone(definition);
  const { wheels, ...rest } = clone;
  const config: VehicleConfig = {
    ...rest,
    wheelFront: wheels.front,
    wheelRear: wheels.rear,
  };

  const problems = validateVehicleConfig(config);
  if (problems.length > 0) throw new VehicleDefinitionError(definition.id, problems);

  return config;
}

/** Non-throwing variant, used by authoring tools and tests. */
export function checkVehicleDefinition(definition: VehicleDefinition): string[] {
  const { wheels, ...rest } = structuredClone(definition);
  return validateVehicleConfig({ ...rest, wheelFront: wheels.front, wheelRear: wheels.rear });
}
