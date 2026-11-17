# Vehicle format

Vehicles are plain data (`src/sim/vehicle/types.ts`), validated at load time. The solver is generic: it
reads the definition and does not special-case any model. Adding a car means adding a data file, not
touching the physics.

```ts
export const MY_CAR: VehicleConfig = {
  id: 'my-car',
  name: 'Example GT',
  manufacturer: 'Browser Drive',
  category: 'Sports car',
  years: '2026',
  summary: 'Short description shown in the menu.',
  color: 0x2255aa,               // body paint

  chassis: {
    mass: 1400,                  // kg
    halfExtents: [0.85, 0.4, 2.1], // collision box half sizes (x, y, z)
    wheelbase: 2.65,
    track: 1.6,
    frontAxleZ: 1.32,            // +z is forward
    rearAxleZ: -1.33,
    mountHeight: -0.05,          // local y of suspension mounts
    inertia: { pitch: 2100, yaw: 2500, roll: 700 }, // kg·m²
  },

  wheelFront: { radius: 0.33, width: 0.24, inertia: 1.1 },
  wheelRear:  { radius: 0.34, width: 0.26, inertia: 1.2 },

  suspension: {
    restLength: 0.3,
    maxCompression: 0.22,
    bumpStopRate: 220000,        // N/m beyond max compression
    springRateFront: 34000,      // N/m
    springRateRear: 30000,
    bumpDampingFront: 4200,      // N·s/m (compression)
    bumpDampingRear: 3900,
    reboundDampingFront: 5200,   // N·s/m (extension)
    reboundDampingRear: 4900,
    antiRollFront: 12000,        // N/m of compression difference
    antiRollRear: 8000,
  },

  tire: {
    mu: 0.95,                    // nominal friction coefficient
    bLong: 10, cLong: 1.65, eLong: 0.95,
    bLat: 12, cLat: 1.35, eLat: 0.94,
    nominalLoad: 4000,           // N at which mu applies
    loadSensitivity: 0.12,       // grip loss per unit load above nominal
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
    torqueCurve: [               // strictly increasing rpm, Nm
      { rpm: 700, torque: 180 },
      { rpm: 4200, torque: 320 },
      { rpm: 6500, torque: 245 },
    ],
  },

  transmission: {
    type: 'automatic',           // or 'manual'
    gearRatios: [3.55, 2.1, 1.4, 1.0, 0.8],
    reverseRatio: 3.4,
    finalDrive: 3.73,
    efficiency: 0.92,
    shiftTime: 0.4,              // seconds of torque cut
    upshiftRpm: 6000,
    downshiftRpm: 1900,
    kickdownRpm: 3200,
  },

  drivetrain: { layout: 'RWD', frontSplit: 0 }, // FWD | RWD | AWD, frontSplit 0..1 for AWD
  brakes: { maxTorqueFront: 2400, maxTorqueRear: 1600, handbrakeTorque: 3200 },
  aero: { dragCoefficient: 0.31, frontalArea: 2.18, downforceCoefficient: 0.32 },
};
```

## Adding a vehicle

1. Create `data/vehicles/<id>.ts` exporting a `VehicleConfig`.
2. Keep the module's top-level validation (as in `sedan.ts`) so bad data fails at build/boot.
3. Reuse `VehicleView` for the procedural model, or add a model module and pass its dimensions.
4. Add tests that assert the definition validates and that its key figures are sane.

## Validation (`validateVehicleConfig`)

Rejects: missing id, non-positive mass/dimensions/spring rates/ratios, identical axle positions,
non-positive inertia, torque curves with fewer than two points or non-increasing rpm, redline ≤ idle,
empty or negative gear ratios, efficiency outside `(0, 1]`, unknown drivetrain layout, `frontSplit`
outside `[0, 1]`, negative brake torques, invalid aero values. The worker validates again on `init` and
refuses to start an invalid vehicle.

## Deliberate non-goals

The format does not encode structural nodes/beams or damage maps yet; those are Phase 3/4 additions and
will be a separate `structure` block rather than overloading the physics fields.
