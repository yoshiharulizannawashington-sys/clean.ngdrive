# Physics model (Milestone 1)

Everything below is integrated by the solver at a fixed 120 Hz step; nothing is animated or scripted.

## Chassis

Rapier dynamic rigid body with a single cuboid collider. Mass and principal moments of inertia come
from the vehicle definition (1520 kg; pitch 2200, yaw 2750, roll 760 kg·m² for the Falcon S4). CCD
enabled, gravity −9.81 m/s².

## Engine rotational dynamics

The engine has its own angular velocity `ω_e` and inertia `I_e` (0.22 kg·m²):

```
T_combustion = torqueCurve(rpm) · throttle · limiterCut
T_friction   = −frictionTorque
T_pumping    = −engineBraking · (1 − throttle) · rpm / redline
T_idle       = clamp(Kp·(target − rpm) + ∫Ki·(target − rpm)dt, 0, maxTorque)   (throttle < 6%)
dω_e/dt      = (T_combustion + T_friction + T_pumping + T_idle − T_clutch) / I_e
```

- **Rev limiter** cuts fuel above `redlineRpm` and restores it 180 rpm below (hysteresis).
- **Stall**: below `stallRpm` for `stallTime` seconds, or when the driveline drives the engine to zero
  or negative speed, the engine stops (`running = false`). It then coasts down on friction.
- **Restart**: applying throttle while stopped engages the starter motor
  (`ω += starterTorque / I_e · dt`) until the engine catches above 55% of idle.
- **Idle governor** is torque-limited, so a real load can still stall the engine.

Engine speed is *never* derived from wheel speed.

## Clutch

Torque capacity is `maxTorque · engagement`, and the transmitted torque is

```
T_clutch = capacity · tanh((ω_e − ω_shaft) / slipScale)
```

which is smooth (no chatter), saturates at the friction limit under big slip and approximates a locked
clutch within `slipScale` rad/s. Slip dissipates energy.

Two limits keep it physical:

- **Launch modulation**: while slipping, capacity is capped by engine rpm and throttle
  (`launchCapacityLimit`) so a standing start cannot out-torque and stall the engine.
- **Torque-reactive limit**: while slipping, capacity is also capped at `1.15 · availableEngineTorque
  + 25 Nm`. Without this the flywheel's stored energy is dumped into the tires on a big slip,
  producing unphysical part-throttle wheelspin spikes.

Engagement is driven by engine rpm (launch) and road speed (lock), with separate engage/release time
constants; it is zero in neutral and during a shift. Shaft speed is the driven wheels' mean speed
multiplied by the selected ratio and final drive. Reflected inertia includes the vehicle mass through
the gearing, which is why the clutch behaves like a locked driveline at speed instead of a soft spring.

## Transmission

Automatic: upshift above `upshiftRpm` only if the next gear would not lug below 1.15× the downshift
speed; downshift requires a 0.5 s dwell and a hold timer prevents an immediate reversal. Kickdown needs
full throttle and a large rpm gap. Manual: shifts only on player input, reverse on the brake at a
standstill. Every shift opens the clutch and cuts engine torque for `shiftTime`.

## Differentials

```
T_left  = T_axle/2 + T_lock
T_right = T_axle/2 − T_lock
```

`T_lock` is the impulse that would equalise the two wheel speeds in this step, clamped to the
differential's capacity:

| Type | Capacity |
| --- | --- |
| open | 0 |
| viscous | `viscosity · Δω`, capped by `maxLockTorque` |
| clutch-type LSD | `preload + lockingStrength · |T_axle|` |
| geared LSD | `preload + (bias−1)/(bias+1) · |T_axle|` |
| locking | `maxLockTorque` (large) |

A centre coupling for AWD transfers torque toward the slower axle with the same formulation.

**Assumptions:** no housing inertia, no backlash, no preload asymmetry, and no temperature-dependent
locking. Locking is modelled through the capacity curve rather than a discrete mechanical lock.

## Tires and surfaces

Slip quantities come from contact-patch velocity, including chassis rotation:

```
slipRatio = (ω·r − vLong) / max(|vLong|, 2)
slipAngle = atan2(vLat, max(|vLong|, 2))
```

The surface under each wheel is read from the collider hit by the suspension ray. Every surface
supplies:

- `gripLong`, `gripLat` — multipliers on the compound's friction coefficient (so wet asphalt,
  gravel, snow and ice reduce available force without changing the shape of the slip curve);
- `rollingResistance` — a coefficient applied to the wheel load;
- `roughness` — currently contributes to resistance/visuals only (no stochastic road profile yet).

Grip is blended with a 0.12 s time constant when a wheel crosses a boundary so forces do not step.

Forces use the Magic Formula per axis, scaled by load-sensitive `μ(Fz)`, then limited by a friction
ellipse across the longitudinal and lateral axes (combined slip). Rolling resistance opposes motion at
the contact patch.

## Suspension, aero and wheels

Unchanged from Milestone 0: spring + bump/rebound damping + bump stop, anti-roll bars, aerodynamic
drag/downforce, and per-wheel rotational dynamics with lock-up and airborne spin-down.

## Known simplifications

- No structural deformation or damage (Phase 3/4).
- No ABS/ESP/traction control; braking is fixed torque per axle.
- Clutch has no thermal/wear model; gearbox has no inertia or backlash.
- Tire model has no relaxation length, temperature, pressure or wear.
- Surface roughness is not yet a stochastic road profile.
- The `slipScale` clutch curve is a numerical approximation of Coulomb friction, tuned for the 120 Hz
  step.
