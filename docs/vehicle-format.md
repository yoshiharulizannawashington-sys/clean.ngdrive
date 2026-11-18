# Vehicle format

Vehicles are assembled from reusable components (`data/components/index.ts`) and resolved by
`resolveVehicle()` into the flat `VehicleConfig` the solver consumes
(`src/sim/vehicle/definition.ts`). The resolver validates, clones and flattens, so two vehicles can
share an engine or gearbox without sharing mutable runtime state.

```ts
export const MY_CAR: VehicleDefinition = {
  id: 'my-car',
  name: 'Example GT',
  manufacturer: 'Browser Drive',
  category: 'Sports car',
  years: '2026',
  summary: 'Short description shown in the menu.',
  color: 0x2255aa,

  chassis: CHASSIS_SEDAN,
  wheels: WHEELS_SEDAN,          // { front: WheelConfig; rear: WheelConfig }
  suspension: SUSPENSION_SPORT,
  tire: TIRE_PERFORMANCE,
  engine: ENGINE_TURBO_2_0,
  clutch: CLUTCH_SPORT,
  transmission: TRANSMISSION_AUTO_5,
  brakes: BRAKES_SEDAN,
  aero: AERO_SEDAN,

  drivetrain: {
    layout: 'RWD',               // FWD | RWD | AWD
    frontSplit: 0,               // AWD only
    frontDifferential: DIFF_OPEN,
    rearDifferential: DIFF_CLUTCH_LSD,
    centerDifferential: null,    // AWD centre coupling, or null
  },
};
```

## Components

| Component | Type | Notes |
| --- | --- | --- |
| `CHASSIS_SEDAN` | `ChassisConfig` | mass, collision box, axles, inertia |
| `WHEELS_SEDAN` | `{ front, rear }: WheelConfig` | radius, width, wheel inertia |
| `SUSPENSION_SPORT` | `SuspensionConfig` | springs, dampers, bump stops, anti-roll |
| `TIRE_PERFORMANCE` | `TireConfig` | compound friction and Magic Formula shape |
| `ENGINE_TURBO_2_0` | `EngineConfig` | torque curve, inertia, idle governor, stall |
| `CLUTCH_SPORT` | `ClutchConfig` | capacity, slip curve, launch rpm, lock speed |
| `TRANSMISSION_AUTO_5` / `TRANSMISSION_MANUAL_6` | `TransmissionConfig` | ratios, shift points, shift time |
| `DIFF_OPEN`, `DIFF_VISCOUS`, `DIFF_CLUTCH_LSD`, `DIFF_GEARED_LSD`, `DIFF_LOCKER` | `DifferentialConfig` | preload, bias, locking strength, viscosity, max transfer |
| `BRAKES_SEDAN` | `BrakeConfig` | axle brake torque, handbrake torque |
| `AERO_SEDAN` | `AeroConfig` | drag, frontal area, downforce |

## New Milestone 1 fields

### Engine

```ts
{
  idleRpm, redlineRpm, stallRpm, starterTorque, frictionTorque, engineBraking,
  inertia,                     // kg m^2, crankshaft + flywheel
  torqueCurve: [{ rpm, torque }],
  idleControl: {
    targetRpm,                 // governor set point
    proportional,              // Nm per rpm of error
    integral,                  // Nm per (rpm * s) of accumulated error
    maxTorque,                 // governor authority (a real load can still stall it)
  },
  stallTime,                   // seconds below stallRpm before it dies
}
```

### Clutch

```ts
{
  maxTorque,                   // friction capacity when fully engaged
  inertia,                     // clutch disc + input shaft
  engageTime, releaseTime,     // seconds
  launchRpm,                   // engine speed at which a launch clutch closes
  lockSpeed,                   // road speed (m/s) at which it locks regardless of rpm
  creepEngagement,             // engagement at rest with throttle closed (0 = no creep)
  slipScale,                   // rad/s at which the tanh curve reaches ~76% capacity
}
```

### Differential

```ts
{
  type: 'open' | 'viscous' | 'clutch-lsd' | 'geared-lsd' | 'locking',
  preload,                     // Nm available without input torque
  torqueBias,                  // >= 1, static bias ratio
  lockingStrength,             // fraction of input torque transferable
  viscosity,                   // Nm per rad/s (viscous type)
  maxLockTorque,               // hard cap
}
```

## Adding a vehicle

1. Compose a `VehicleDefinition` in `data/vehicles/<id>.ts`, reusing components where possible.
2. Export the resolved config: `export const MY_CAR = resolveVehicle(MY_CAR_DEFINITION);`
3. Use it in the app (or tests). `resolveVehicle` throws `VehicleDefinitionError` listing every
   problem; `checkVehicleDefinition` returns the problems without throwing.

## Validation

`validateVehicleConfig` rejects missing ids, non-positive mass/dimensions/inertia/spring rates,
identical axle positions, non-increasing torque curves, redline ≤ idle, stall rpm outside (0, idle),
non-positive engine or clutch inertia, invalid engage/release times, `launchRpm` ≤ idle, creep outside
[0, 1], empty or negative gear ratios, efficiency outside (0, 1], unknown drivetrain layouts,
`frontSplit` outside [0, 1], unknown differential types, differential values below zero, bias below 1,
non-locking differentials without a positive `maxLockTorque`, negative brake torques and invalid aero
values.

The worker validates again on `init` and refuses to start an invalid vehicle.

## Deliberate non-goals

The format does not encode structural nodes/beams or damage maps yet. Those arrive in Phase 3/4 as a
separate `structure` block rather than overloading the handling fields.
