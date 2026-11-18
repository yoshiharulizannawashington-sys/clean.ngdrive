# Architecture

## Goals

1. Physics is authoritative, fixed-step and independent of rendering.
2. Adding a vehicle, surface or differential is data work, not engine surgery.
3. Rendering quality may drop on weak hardware; simulation fidelity must not.
4. Systems communicate through a small, validated protocol.

## Process model

**Main thread** — UI, input, camera, rendering, settings, persistence.

**Simulation worker** (`src/sim/physics-worker.ts`) — owns the world, the clock and the vehicle solver.

The worker initialises Rapier WASM, builds the facility from `data/maps/test-facility.ts`, creates the
vehicle, then loops: `clock.advance(dtMs)` → N fixed 1/120 s steps → publish a 60 Hz snapshot. A frame
that falls behind runs up to 8 catch-up steps; beyond that the backlog is dropped and reported.

Snapshots are timestamped in simulation milliseconds. `SnapshotBuffer` interpolates position,
orientation (`slerp`), steering, wheel spin and suspension travel between the two surrounding
snapshots and never extrapolates.

## Message protocol (`src/sim/protocol.ts`)

Main → worker: `init`, `input`, `set-running`, `reset`, `set-rate`, `dispose`.
Worker → main: `ready`, `snapshot`, `error`, `fatal`.

All messages are validated and inputs are clamped to finite ranges. A throwing step becomes `fatal` and
stops the loop rather than continuing with corrupted state.

## Simulation layering

```
physics-worker        loop, messages, stats
  world.ts            Rapier world, surface-tagged colliders, dynamic props
  surfaces.ts         surface material catalogue (grip, rolling resistance, colour)
  vehicle/
    vehicle.ts        solver: powertrain chain → raycasts → tires → wheel integration
    engine.ts         rotating engine: inertia, idle governor, limiter, stall, restart
    clutch.ts         capacity, slip torque, launch modulation, engagement
    differential.ts   open/viscous/LSD/locking torque distribution
    transmission.ts   gear selection, judder-free shift scheduling
    suspension.ts     spring/damper/bump-stop/anti-roll maths
    tire.ts           surface-aware Magic Formula + friction ellipse
    drivetrain.ts     layout and axle split
```

`src/sim` never imports Three.js. Rendering consumes snapshots and nothing else.

### The powertrain chain (order matters)

1. Read chassis state; update steering.
2. Compute the gearbox's view of speed (synchronous rpm, road rpm) and select a gear.
3. Compute shaft speed from the driven wheels: `wheelΩ · ratio · finalDrive` (multiplication, not
   division — the gearbox steps engine speed down to the wheels).
4. Update clutch engagement, cap capacity (launch + engine-torque-reactive limits), compute clutch
   torque, integrate the engine.
5. Send `T_clutch · ratio · finalDrive · efficiency` through the axle split and differentials.
6. Raycast the suspension, reading the collider's surface material for each wheel.
7. Compute surface-aware tire forces, apply impulses at the contact patches.
8. Integrate wheel rotation against drive torque, tire reaction and brakes.

This ordering is deliberate: the engine never sees wheel speed directly, only through the clutch, and
the differentials see wheel speeds from the previous step.

## Rendering

`EngineRenderer` owns the WebGL renderer, scene, sun/shadows and fog. `FacilityEnvironment` builds
geometry from the shared map data: static boxes merged per material, road markings merged into one
white and one accent mesh, cones drawn with three `InstancedMesh` layers, trees instanced, and surface
patches coloured from the same material definitions the physics uses.

`mergeStaticGeometry` (`src/render/geometry.ts`) bakes transforms into merged, non-indexed geometry.
The vehicle's ten spokes per wheel are merged into one mesh per wheel.

Quality profiles change pixel ratio/render scale, shadows, anisotropy and tree count only. Adaptive
resolution lowers the framebuffer scale on slow GPUs; physics is unaffected.

## Errors and diagnostics

`window.onerror`, `unhandledrejection` and worker errors feed a visible banner; startup failures are
reported on the loading screen. `window.browserDrive.getDiagnostics()` exposes state, worker
readiness, speed, rpm, gear, wheel compression, per-wheel surfaces, step time, body count and draw
calls for automated verification.

## Key decisions and fixes

- **Rapier for rigid bodies only.** Its raycast-vehicle controller is not used.
- **Custom TypeScript solver.** ~0.1 ms per step; a Rust/WASM port is not justified yet.
- **Engine speed from its own inertia.** An earlier version derived rpm from wheel speed, which
  created feedback that made the gearbox hunt and gutted acceleration. The engine now has state and is
  coupled only through the clutch.
- **Shaft speed multiplies by the gear ratio.** An early Milestone 1 build divided instead, so the
  clutch always believed the wheels were ~175× slower than they were; the engine bogged and the wheels
  spun without limit.
- **Smooth clutch curve instead of a hard clamp.** A capacity clamp chattered between ±capacity at
  120 Hz once the tires could not absorb the torque; the tanh slip curve is continuous and dissipative.
- **Reflected driveline inertia includes vehicle mass**, so a locked clutch behaves like a solid
  driveline rather than a soft spring.
- **Shift scheduling separates engine rpm from road rpm.** Wheelspin can raise engine rpm; the box
  refuses an upshift that would lug, needs a dwell before downshifting, and holds after a shift to
  avoid hunting.
- **Surfaces are collider tags**, not position checks, so the rendered patch and the tire's material
  cannot disagree.
