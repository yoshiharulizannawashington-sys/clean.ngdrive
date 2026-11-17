# Physics model (Milestone 0)

This describes exactly what the solver computes today. Nothing here is a placeholder animation; every
quantity below is integrated from simulation state.

## Chassis

A Rapier dynamic rigid body with a single cuboid collider. Mass and principal moments of inertia come
from the vehicle definition (1520 kg; pitch 2200, yaw 2750, roll 760 kg·m² for the sedan). CCD is
enabled. Gravity is −9.81 m/s².

Linear and angular motion are integrated by Rapier; the solver only applies impulses.

## Suspension

Each wheel has a mount point in chassis space. Every step, a ray of length `restLength + tireRadius` is
cast downward along the chassis up-axis, excluding the vehicle's own collider:

```
distance        = ray hit distance
compression     = restLength + radius − distance        (clamped ≥ 0)
compressionRate = (compression − previousCompression) / dt
force           = springRate · compression
                + (rate > 0 ? bumpDamping : reboundDamping) · rate
                + bumpStopRate · max(0, compression − maxCompression)
force           = clamp(force, 0, 150 kN)
```

The force acts along the surface normal at the contact point, so load transfer, roll and pitch are
emergent.

Anti-roll bars subtract the two compressions on an axle:

```
leftLoad  += antiRoll · (leftCompression − rightCompression)
rightLoad −= antiRoll · (leftCompression − rightCompression)
```

## Tires

Slip quantities come from the contact-patch velocity (including chassis rotation):

```
slipRatio = (ω·r − vLong) / max(|vLong|, 2)
slipAngle = atan2(vLat, max(|vLong|, 2))
```

Load-sensitive friction:

```
μ(Fz) = μ0 · (1 − loadSensitivity · (Fz/nominalLoad − 1)), clamped to [0.55μ0, 1.15μ0]
```

Forces use a Pacejka-style Magic Formula, `F = D·sin(C·atan(B·s − E·(B·s − atan(B·s))))`, with separate
longitudinal and lateral coefficients and `D = μ(Fz)·Fz`. Longitudinal and lateral demand are then scaled
together to stay inside the friction circle (combined slip), and rolling resistance is subtracted along
the direction of travel.

Forces are applied as impulses at the contact point, which is what produces pitch/roll moments.

## Wheels

Each wheel integrates its own angular velocity:

```
wheelTorque = driveTorque − Fx · radius
ω'          = ω + wheelTorque / I · dt
brakeStep   = brakeTorque / I · dt          (front and rear separate; handbrake adds rear torque)
ω'          = 0 if |ω'| ≤ brakeStep else ω' − sign(ω')·brakeStep
```

The brake step can hold a wheel still against the tire's reaction torque, so a locked wheel stays locked
instead of being spun back up. Airborne wheels keep spinning and slowly lose speed to bearing drag.
`ω` is clamped to ±520 rad/s.

## Engine

```
netTorque(rpm, throttle) = torqueCurve(rpm)·throttle
                         − frictionTorque
                         − engineBraking · (1 − throttle) · rpm/redline
```

Above `redline + 120 rpm` the limiter returns only friction (negative) torque. The curve is linearly
interpolated and clamped at its ends.

Engine speed is derived from **road speed** through the selected gear and final drive, blended toward a
free-rev target while the clutch is slipping (launch). Using road speed rather than wheel speed keeps
wheelspin from feeding back into the shift points (see `docs/architecture.md`).

## Transmission and drivetrain

Automatic mode: upshift above `upshiftRpm` with throttle applied, downshift below `downshiftRpm` or on
kickdown, reverse engaged by holding the brake at a standstill, each shift cutting torque for
`shiftTime`. Manual mode shifts only on `E`/`Q` and engages reverse the same way.

Axle split: FWD/RWD send everything to one axle; AWD uses `frontSplit`. Each driven wheel receives half
of its axle torque (open differential). Positive torque transfers through a slipping clutch at
`0.4 + 0.6·lock`; negative torque (engine braking) only transfers once the car is rolling and the clutch
is locked. That prevents a parked car from being dragged backwards by idle drag.

## Aerodynamics

```
drag      = ½·ρ·Cd·A·v²      opposite velocity
downforce = ½·ρ·Cl·A·v²      along −up, applied at the centre of mass
```

## Known simplifications

- Clutch engagement is a lock factor, not a slipping-friction model; engine speed has no independent
  inertia. This is the next physics task (Phase 2).
- Open differential only; no limited-slip or locking behaviour yet.
- Tire model has no relaxation length, temperature, wear, pressure or surface variation yet.
- No structural deformation: collisions are rigid-body contacts only, and the chassis collider is a box.
- Single contact point per tire; no separate rim/curb modelling.
