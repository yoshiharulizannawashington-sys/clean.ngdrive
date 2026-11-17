# Architecture

## Goals

1. Physics must be authoritative, fixed-step and independent of rendering.
2. Adding a vehicle or a map must be data work, not engine surgery.
3. Rendering quality may drop on weak hardware; simulation fidelity must not.
4. Systems communicate through a small, validated protocol.

## Process model

**Main thread** — UI, input, camera, rendering, audio (later), settings, persistence.

**Simulation worker** (`src/sim/physics-worker.ts`) — owns the world, the clock and the vehicle solver.

The worker:

1. waits for `init` (vehicle definition + spawn),
2. initialises Rapier WASM,
3. builds the facility from `data/maps/test-facility.ts`,
4. creates the vehicle,
5. drives a loop: `clock.advance(dtMs)` → N fixed steps → publish a snapshot at 60 Hz.

The worker's loop uses `setTimeout(…, 4)` and an accumulator (`SimulationClock`). Step size is exactly
`1/120 s`. A frame that falls behind runs up to 8 catch-up steps; beyond that the backlog is dropped and
recorded (`droppedTime`) rather than letting the simulation spiral.

### Interpolation

Snapshots are timestamped in **simulation** milliseconds. `SnapshotBuffer` keeps up to eight of them and
plays them back at wall-clock speed, interpolating position, orientation (`slerp`), wheel steering,
wheel spin and suspension travel between the two surrounding snapshots. Extrapolation past the newest
snapshot is not allowed, so a stalled worker freezes the picture instead of inventing motion.

## Message protocol (`src/sim/protocol.ts`)

Main → worker: `init`, `input`, `set-running`, `reset`, `set-rate`, `dispose`.
Worker → main: `ready`, `snapshot`, `error`, `fatal`.

Every message is validated (`isMainToSim` / `isSimToMain`) and inputs are clamped and checked for
finiteness before they reach the solver. Malformed messages are rejected with an `error` message; a
throwing simulation step becomes `fatal` and stops the loop rather than silently continuing.

`snapshot` carries vehicle state (chassis transform, wheel states, engine/gear/speed), dynamic prop
transforms and worker timings.

## Simulation layering

```
physics-worker   loop, messages, stats
  world.ts       Rapier world, static colliders, dynamic props
  vehicle/       solver
    suspension   spring/damper/bump-stop/anti-roll maths
    tire         Magic Formula + combined slip
    engine       torque curve, friction, engine braking, limiter
    transmission ratios, automatic/manual shift state machine
    drivetrain   layout and torque split
```

`src/sim` never imports Three.js. Rendering consumes snapshots and nothing else.

## Rendering

`EngineRenderer` owns the WebGL renderer, scene, sun/shadows and fog. `FacilityEnvironment` builds
geometry from the shared map data — the same boxes and cones that produce colliders. The procedural
vehicle builds its own meshes and is animated only from snapshot data.

Quality profiles change: pixel-ratio cap + render scale, shadows and shadow-map size, texture
anisotropy, and the count of instanced background trees. They never change the solver.

Adaptive resolution lowers the framebuffer scale in 0.15 steps when the measured frame time exceeds
30 ms, and restores it when frames are comfortably fast.

## State machines

Application: `loading → menu → playing ⇄ paused → menu`.

The simulation runs behind the menu so the menu's 3D backdrop is produced by the same worker that
drives the car. `Esc` pauses both the clock (worker) and the input stream; the HUD remains visible
with the last state.

## Errors and diagnostics

- `window.onerror` / `unhandledrejection` and worker `error` events feed a visible error banner.
- Startup failures (no WebGL 2, missing DOM) are reported on the loading screen.
- `window.browserDrive.getDiagnostics()` exposes state, worker readiness, speed, rpm, gear, wheel
  compression, simulation step time, body count and draw calls for automated verification.

## Settings and persistence

`src/save/store.ts` writes to IndexedDB (`browser-drive` / `kv`) with a localStorage fallback. Only the
graphics profile is persisted today; vehicle configurations and scenarios come with the garage phase.

## Key decisions

- **Rapier for rigid bodies only.** Its raycast-vehicle controller is not used: the solver needs custom
  suspension, tire and drivetrain behaviour that Rapier does not model.
- **Custom TypeScript solver first.** Simulation cost is ~0.1 ms/step on the verification VM, so moving
  to Rust/WASM is not justified yet. The solver is isolated so it can be ported behind the same interface
  if profiling ever demands it.
- **Engine speed from road speed.** Wheel-speed-derived rpm created a feedback loop with wheelspin that
  made the gearbox hunt and gutted acceleration. Road-speed rpm plus a launch allowance is stable and
  documented as a simplification until the Phase 2 engine-inertia/clutch model lands.
- **Brake torque removes angular velocity** and can hold a wheel against tire reaction torque; capping
  brake torque by `|ω|·I/dt` made locked wheels spin back up every step.
