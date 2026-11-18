import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPoint, VehicleSnapshot, WheelSnapshot } from '../protocol';
import type { VehicleConfig } from './types';
import { Transmission } from './transmission';
import { Engine, engineNetTorque } from './engine';
import { advanceEngagement, clutchEngagementTarget, clutchTorque, launchCapacityLimit } from './clutch';
import { distributeAxleTorque } from './differential';
import { tireForces } from './tire';
import { antiRollForce, suspensionForce } from './suspension';
import { drivenWheelIndices, splitAxleTorque } from './drivetrain';
import { DEFAULT_SURFACE_ID, SURFACES, surfaceGrip, type SurfaceGrip, type SurfaceId } from '../surfaces';
import {
  add,
  clamp,
  cross,
  degToRad,
  dot,
  length,
  normalize,
  projectOnPlane,
  rotate,
  rotateAround,
  scale,
  sub,
  vec3,
  type Quat,
  type Vec3,
} from '../math3';

interface WheelRuntime {
  front: boolean;
  left: boolean;
  mount: Vec3;
  radius: number;
  width: number;
  inertia: number;
  springRate: number;
  bumpDamping: number;
  reboundDamping: number;
  driveTorque: number;
  brakeTorque: number;

  /** Rotational state (rad/s) and accumulated visual angle (rad). */
  omega: number;
  spin: number;

  contact: boolean;
  compression: number;
  previousCompression: number;
  load: number;
  slipRatio: number;
  slipAngle: number;
  contactPoint: Vec3;
  normal: Vec3;
  forward: Vec3;
  lateral: Vec3;
  longVel: number;

  /** Contact surface and its smoothed grip (blended to avoid force steps). */
  surface: SurfaceId;
  grip: SurfaceGrip;
}

const WHEEL_NAMES = ['front-left', 'front-right', 'rear-left', 'rear-right'];

/** Time constant for blending grip when a wheel crosses a surface boundary. */
const SURFACE_BLEND_SECONDS = 0.12;

/**
 * Vehicle simulation: a rigid chassis carried by four independently solved
 * suspension units.
 *
 * Each step:
 *  1. read the chassis state from Rapier,
 *  2. update the gearbox, then solve the clutch between the engine's own
 *     rotational state and the driven wheels,
 *  3. distribute clutch torque through the differentials to the wheels,
 *  4. raycast each suspension against the world (and read its surface),
 *  5. compute slip-based tire forces on that surface at each contact patch,
 *  6. apply those forces as impulses at the contact points,
 *  7. integrate wheel rotation from drive torque, brake torque and tire reaction.
 *
 * Weight transfer, body roll, pitch, wheelspin, lock-up, engine rev flare and
 * clutch slip all come out of that loop; nothing is animated.
 */
export class VehicleSim {
  readonly config: VehicleConfig;
  private readonly world: World;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly wheels: WheelRuntime[] = [];
  private readonly transmission: Transmission;
  private readonly engine: Engine;
  private readonly surfaceLookup: (colliderHandle: number) => SurfaceId;
  private spawn: SpawnPoint;

  private steerAngle = 0;
  private inputThrottle = 0;
  private inputBrake = 0;
  private inputHandbrake = 0;

  private clutchEngagement = 0;
  private clutchSlip = 0;
  private clutchTorqueValue = 0;

  constructor(
    world: World,
    config: VehicleConfig,
    spawn: SpawnPoint,
    surfaceLookup?: (colliderHandle: number) => SurfaceId,
  ) {
    this.world = world;
    this.config = config;
    this.spawn = spawn;
    this.surfaceLookup = surfaceLookup ?? (() => DEFAULT_SURFACE_ID);
    this.engine = new Engine(config.engine);
    this.transmission = new Transmission(config.transmission);

    const [hx, hy, hz] = config.chassis.halfExtents;
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(spawn.position[0], spawn.position[1], spawn.position[2])
        .setRotation({ x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) })
        .setLinearDamping(0.02)
        .setAngularDamping(0.25)
        .setCcdEnabled(true),
    );

    this.collider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setMassProperties(
          config.chassis.mass,
          { x: 0, y: 0, z: 0 },
          {
            x: config.chassis.inertia.pitch,
            y: config.chassis.inertia.yaw,
            z: config.chassis.inertia.roll,
          },
          { x: 0, y: 0, z: 0, w: 1 },
        )
        .setFriction(0.55)
        .setRestitution(0.04),
      this.body,
    );

    this.buildWheels();
    this.applySpawnVelocity(spawn);
  }

  /** Start the car already rolling (scenario and regression support). */
  private applySpawnVelocity(spawn: SpawnPoint): void {
    if (!spawn.velocity) return;
    const [vx, vy, vz] = spawn.velocity;
    this.body.setLinvel({ x: vx, y: vy, z: vz }, true);
    const forwardX = Math.sin(spawn.yaw);
    const forwardZ = Math.cos(spawn.yaw);
    const longitudinal = vx * forwardX + vz * forwardZ;
    for (const wheel of this.wheels) {
      wheel.omega = longitudinal / Math.max(wheel.radius, 1e-3);
    }
  }

  private buildWheels(): void {
    const { chassis, suspension } = this.config;
    const halfTrack = chassis.track / 2;
    const layout: Array<{ front: boolean; left: boolean; x: number; z: number }> = [
      { front: true, left: true, x: -halfTrack, z: chassis.frontAxleZ },
      { front: true, left: false, x: halfTrack, z: chassis.frontAxleZ },
      { front: false, left: true, x: -halfTrack, z: chassis.rearAxleZ },
      { front: false, left: false, x: halfTrack, z: chassis.rearAxleZ },
    ];

    const road = SURFACES[DEFAULT_SURFACE_ID];

    layout.forEach((entry) => {
      const wheelConfig = entry.front ? this.config.wheelFront : this.config.wheelRear;
      this.wheels.push({
        front: entry.front,
        left: entry.left,
        mount: vec3(entry.x, chassis.mountHeight, entry.z),
        radius: wheelConfig.radius,
        width: wheelConfig.width,
        inertia: wheelConfig.inertia,
        springRate: entry.front ? suspension.springRateFront : suspension.springRateRear,
        bumpDamping: entry.front ? suspension.bumpDampingFront : suspension.bumpDampingRear,
        reboundDamping: entry.front ? suspension.reboundDampingFront : suspension.reboundDampingRear,
        driveTorque: 0,
        brakeTorque: 0,
        omega: 0,
        spin: 0,
        contact: false,
        compression: 0,
        previousCompression: 0,
        load: 0,
        slipRatio: 0,
        slipAngle: 0,
        contactPoint: vec3(),
        normal: vec3(0, 1, 0),
        forward: vec3(0, 0, 1),
        lateral: vec3(1, 0, 0),
        longVel: 0,
        surface: DEFAULT_SURFACE_ID,
        grip: surfaceGrip(road),
      });
    });
  }

  reset(spawn: SpawnPoint = this.spawn): void {
    this.spawn = spawn;
    this.body.setTranslation(
      { x: spawn.position[0], y: spawn.position[1], z: spawn.position[2] },
      true,
    );
    this.body.setRotation({ x: 0, y: Math.sin(spawn.yaw / 2), z: 0, w: Math.cos(spawn.yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.transmission.reset();
    this.engine.reset();
    this.steerAngle = 0;
    this.clutchEngagement = 0;
    this.clutchSlip = 0;
    for (const wheel of this.wheels) {
      wheel.omega = 0;
      wheel.spin = 0;
      wheel.contact = false;
      wheel.compression = 0;
      wheel.previousCompression = 0;
      wheel.load = 0;
      wheel.slipRatio = 0;
      wheel.slipAngle = 0;
      wheel.driveTorque = 0;
      wheel.brakeTorque = 0;
    }
    this.applySpawnVelocity(spawn);
  }

  /** Diagnostics used by tests and the HUD. */
  get engineRpm(): number {
    return this.engine.rpm;
  }

  get engineRunning(): boolean {
    return this.engine.isRunning;
  }

  get clutchState(): { engagement: number; slip: number; torque: number } {
    return { engagement: this.clutchEngagement, slip: this.clutchSlip, torque: this.clutchTorqueValue };
  }

  step(dt: number, input: InputState): void {
    const { config } = this;
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const quaternion: Quat = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
    const position: Vec3 = { x: translation.x, y: translation.y, z: translation.z };
    const linvel = this.body.linvel();
    const angvel = this.body.angvel();
    const velocity: Vec3 = { x: linvel.x, y: linvel.y, z: linvel.z };
    const angularVelocity: Vec3 = { x: angvel.x, y: angvel.y, z: angvel.z };

    const forward = rotate(quaternion, vec3(0, 0, 1));
    const up = rotate(quaternion, vec3(0, 1, 0));
    const forwardSpeed = dot(velocity, forward);

    this.inputThrottle = input.throttle;
    this.inputBrake = input.brake;
    this.inputHandbrake = input.handbrake;

    // ---- steering -------------------------------------------------------
    // Speed-sensitive lock: full lock at rest, progressively less at speed.
    const maxSteerAngle = degToRad(34) / (1 + Math.abs(forwardSpeed) * 0.05);
    const steerTarget = clamp(input.steer, -1, 1) * maxSteerAngle;
    const steerAlpha = 1 - Math.exp(-dt * 9);
    this.steerAngle += (steerTarget - this.steerAngle) * steerAlpha;

    // ---- gearbox --------------------------------------------------------
    const driven = drivenWheelIndices(config.drivetrain.layout);
    const finalDrive = config.transmission.finalDrive;

    // Shift decisions use the speed the engine would turn at if the clutch
    // were locked. While the clutch is slipping (launch, wheelspin, a shift in
    // progress) the free-revving engine speed is not representative and makes
    // an automatic box hunt between gears.
    const previousRatio = this.transmission.ratio;
    const previousInGear = Math.abs(previousRatio) > 1e-6;
    let shiftShaftOmega = 0;
    if (previousInGear) {
      let sum = 0;
      for (const index of driven) sum += this.wheels[index].omega;
      shiftShaftOmega = (sum / driven.length) * previousRatio * finalDrive;
    }
    const synchronousRpm = (Math.abs(shiftShaftOmega) * 30) / Math.PI;
    const clutchLocked = this.clutchEngagement > 0.5 && Math.abs(this.clutchSlip) < 40;
    const shiftRpm = clutchLocked
      ? this.engine.rpm
      : Math.max(synchronousRpm, config.engine.idleRpm);
    // Road speed expressed as an engine speed in the current gear: no wheelspin.
    const drivenRadiusForRpm =
      config.drivetrain.layout === 'FWD' ? config.wheelFront.radius : config.wheelRear.radius;
    const roadRpm =
      (Math.abs(forwardSpeed) / Math.max(drivenRadiusForRpm, 1e-3)) *
      Math.abs(previousRatio) *
      finalDrive *
      (30 / Math.PI);

    const shift = this.transmission.update(dt, {
      rpm: shiftRpm,
      roadRpm,
      throttle: input.throttle,
      speed: forwardSpeed,
      brake: input.brake,
      shiftUp: input.shiftUp,
      shiftDown: input.shiftDown,
    });

    const ratio = this.transmission.ratio;
    const inGear = Math.abs(ratio) > 1e-6;

    // ---- engine, clutch and driveline -----------------------------------
    // Shaft speed is the driven wheels' mean angular velocity referred through
    // the gearbox (gearing multiplies engine speed down to the wheels, so the
    // shaft turns faster than the wheels by ratio * finalDrive). The engine has
    // its own omega; the clutch torque couples the two.
    let shaftOmega = 0;
    if (inGear) {
      let wheelOmegaSum = 0;
      for (const index of driven) wheelOmegaSum += this.wheels[index].omega;
      shaftOmega = (wheelOmegaSum / driven.length) * ratio * finalDrive;
    }

    const engagementTarget = clutchEngagementTarget(
      config.clutch,
      this.engine.rpm,
      Math.abs(forwardSpeed),
      inGear,
      shift.torqueCut,
    );
    this.clutchEngagement = advanceEngagement(
      this.clutchEngagement,
      engagementTarget,
      config.clutch.engageTime,
      config.clutch.releaseTime,
      dt,
    );

    let drivenInertia = 0;
    const drivenRadius = config.drivetrain.layout === 'FWD' ? config.wheelFront.radius : config.wheelRear.radius;
    for (const index of driven) drivenInertia += this.wheels[index].inertia;
    const gearReflection = Math.pow(Math.max(Math.abs(ratio) * finalDrive, 0.5), 2);
    // Inertia seen at the clutch includes the wheels *and the vehicle mass*: a
    // locked driveline has to accelerate the whole car through the gearing.
    const vehicleInertiaReflected = (config.chassis.mass * drivenRadius * drivenRadius) / gearReflection;
    const reflectedInertia =
      drivenInertia / gearReflection + vehicleInertiaReflected + config.clutch.inertia;

    this.clutchSlip = this.engine.angularVelocity - shaftOmega;
    // A clutch cannot transmit more torque than the engine produces without
    // dragging the engine down. Applying full friction capacity during a big
    // slip lets the flywheel dump its stored energy into the tires, which
    // produces wheelspin spikes on a part-throttle launch. Limiting the
    // slipping capacity to the engine's available torque keeps the launch
    // physical; once the clutch is nearly locked, full capacity is available
    // so engine braking works.
    const engineAvailable = Math.max(
      0,
      engineNetTorque(config.engine, this.engine.rpm, shift.torqueCut ? 0 : input.throttle),
    );
    const slipping = Math.abs(this.clutchSlip) > 20;
    const torqueReactiveLimit = slipping
      ? Math.min(config.clutch.maxTorque, engineAvailable * 1.15 + 25)
      : config.clutch.maxTorque;
    const capacityLimit = Math.min(
      launchCapacityLimit(
        config.clutch,
        this.engine.rpm,
        config.engine.idleRpm,
        input.throttle,
        inGear && Math.abs(forwardSpeed) > config.clutch.lockSpeed,
      ),
      torqueReactiveLimit,
    );
    void reflectedInertia;
    const coupling = clutchTorque(
      config.clutch,
      this.clutchEngagement,
      this.engine.angularVelocity,
      shaftOmega,
      capacityLimit,
    );
    // The clutch drags the engine; positive coupling accelerates the driveline.
    // A shift interrupts torque: the engine is off throttle while it happens.
    this.clutchTorqueValue = coupling;
    const engineThrottle = shift.torqueCut ? 0 : input.throttle;
    this.engine.update(dt, engineThrottle, coupling);

    const axleTorque = inGear
      ? coupling * ratio * finalDrive * config.transmission.efficiency
      : 0;

    const axle = splitAxleTorque(config.drivetrain.layout, config.drivetrain.frontSplit, axleTorque);
    let frontTorque = axle.front;
    let rearTorque = axle.rear;

    // Centre coupling for AWD: transfer torque toward the slower axle.
    if (
      config.drivetrain.layout === 'AWD' &&
      config.drivetrain.centerDifferential &&
      Math.abs(axleTorque) > 1e-6
    ) {
      const frontMean = (this.wheels[0].omega + this.wheels[1].omega) / 2;
      const rearMean = (this.wheels[2].omega + this.wheels[3].omega) / 2;
      const center = distributeAxleTorque(
        config.drivetrain.centerDifferential,
        axleTorque,
        frontMean,
        rearMean,
        (this.wheels[0].inertia + this.wheels[2].inertia) / 2,
        dt,
      );
      frontTorque = center.left;
      rearTorque = center.right;
    }

    const front = distributeAxleTorque(
      config.drivetrain.frontDifferential,
      frontTorque,
      this.wheels[0].omega,
      this.wheels[1].omega,
      (this.wheels[0].inertia + this.wheels[1].inertia) / 2,
      dt,
    );
    const rear = distributeAxleTorque(
      config.drivetrain.rearDifferential,
      rearTorque,
      this.wheels[2].omega,
      this.wheels[3].omega,
      (this.wheels[2].inertia + this.wheels[3].inertia) / 2,
      dt,
    );

    this.wheels[0].driveTorque = front.left;
    this.wheels[1].driveTorque = front.right;
    this.wheels[2].driveTorque = rear.left;
    this.wheels[3].driveTorque = rear.right;

    const brakeFront = config.brakes.maxTorqueFront * input.brake;
    const brakeRear = config.brakes.maxTorqueRear * input.brake + config.brakes.handbrakeTorque * input.handbrake;
    this.wheels[0].brakeTorque = brakeFront;
    this.wheels[1].brakeTorque = brakeFront;
    this.wheels[2].brakeTorque = brakeRear;
    this.wheels[3].brakeTorque = brakeRear;

    // ---- suspension raycasts -------------------------------------------
    const down = scale(up, -1);
    const suspensionConfig = config.suspension;
    const loads = [0, 0, 0, 0];
    const surfaceBlend = 1 - Math.exp(-dt / SURFACE_BLEND_SECONDS);

    for (let i = 0; i < this.wheels.length; i += 1) {
      const wheel = this.wheels[i];
      const mountWorld = add(position, rotate(quaternion, wheel.mount));
      const rayLength = suspensionConfig.restLength + wheel.radius;
      const hit = this.world.castRayAndGetNormal(
        new RAPIER.Ray(mountWorld, down),
        rayLength,
        true,
        undefined,
        undefined,
        this.collider,
        this.body,
      );

      if (!hit) {
        wheel.contact = false;
        wheel.compression = 0;
        wheel.load = 0;
        wheel.slipRatio = 0;
        wheel.slipAngle = 0;
        continue;
      }

      // Which material is under this wheel? Rapier colliders are tagged at build
      // time; an untagged collider falls back to dry asphalt.
      const hitCollider = (hit as unknown as { collider?: Collider }).collider;
      const surfaceId = hitCollider ? this.surfaceLookup(hitCollider.handle) : DEFAULT_SURFACE_ID;
      const definition = SURFACES[surfaceId] ?? SURFACES[DEFAULT_SURFACE_ID];
      wheel.surface = definition.id;
      const targetGrip = surfaceGrip(definition);
      // Blend grip across boundaries instead of stepping the force . This is a
      // documented approximation of a contact patch that spans two surfaces.
      wheel.grip = {
        gripLong: wheel.grip.gripLong + (targetGrip.gripLong - wheel.grip.gripLong) * surfaceBlend,
        gripLat: wheel.grip.gripLat + (targetGrip.gripLat - wheel.grip.gripLat) * surfaceBlend,
        rollingResistance:
          wheel.grip.rollingResistance +
          (targetGrip.rollingResistance - wheel.grip.rollingResistance) * surfaceBlend,
      };

      const distance = Math.max(wheel.radius * 0.6, hit.timeOfImpact);
      wheel.contact = true;
      wheel.compression = clamp(
        suspensionConfig.restLength + wheel.radius - distance,
        0,
        suspensionConfig.maxCompression + 0.18,
      );
      wheel.contactPoint = add(mountWorld, scale(down, distance));
      wheel.normal = normalize({ x: hit.normal.x, y: hit.normal.y, z: hit.normal.z });

      // Wheel heading: body forward rotated by steering, flattened onto the road.
      const steerAngle = wheel.front ? this.steerAngle : 0;
      let wheelForward = normalize(projectOnPlane(rotateAround(forward, up, steerAngle), wheel.normal));
      if (length(wheelForward) < 0.5) {
        wheelForward = normalize(projectOnPlane(forward, wheel.normal));
      }
      wheel.forward = wheelForward;
      wheel.lateral = normalize(cross(wheel.normal, wheelForward));

      const rvec = sub(wheel.contactPoint, position);
      const pointVelocity = add(velocity, cross(angularVelocity, rvec));
      wheel.longVel = dot(pointVelocity, wheel.forward);
      const lateralVel = dot(pointVelocity, wheel.lateral);

      // Low-speed denominators are clamped to keep the slip model stable at rest.
      const speedDenominator = Math.max(Math.abs(wheel.longVel), 2);
      wheel.slipRatio = (wheel.omega * wheel.radius - wheel.longVel) / speedDenominator;
      wheel.slipAngle = Math.atan2(lateralVel, speedDenominator);

      const compressionRate = (wheel.compression - wheel.previousCompression) / dt;
      loads[i] = suspensionForce(
        suspensionConfig,
        wheel.springRate,
        wheel.bumpDamping,
        wheel.reboundDamping,
        wheel.compression,
        compressionRate,
      );
    }

    // Anti-roll bars couple the two wheels on an axle.
    const frontDelta = antiRollForce(
      suspensionConfig.antiRollFront,
      this.wheels[0].contact ? this.wheels[0].compression : 0,
      this.wheels[1].contact ? this.wheels[1].compression : 0,
    );
    loads[0] += frontDelta;
    loads[1] -= frontDelta;

    const rearDelta = antiRollForce(
      suspensionConfig.antiRollRear,
      this.wheels[2].contact ? this.wheels[2].compression : 0,
      this.wheels[3].contact ? this.wheels[3].compression : 0,
    );
    loads[2] += rearDelta;
    loads[3] -= rearDelta;

    // ---- tire forces, body impulses and wheel rotation -----------------
    for (let i = 0; i < this.wheels.length; i += 1) {
      const wheel = this.wheels[i];
      const load = wheel.contact ? Math.max(0, loads[i]) : 0;
      wheel.load = load;

      let longitudinal = 0;
      let lateral = 0;

      if (wheel.contact && load > 1) {
        const forces = tireForces(
          config.tire,
          {
            load,
            slipRatio: wheel.slipRatio,
            slipAngle: wheel.slipAngle,
            forwardSpeed: wheel.longVel,
          },
          wheel.grip,
        );
        longitudinal = forces.longitudinal;
        lateral = forces.lateral;

        const contactForce = add(
          add(scale(wheel.normal, load), scale(wheel.forward, longitudinal)),
          scale(wheel.lateral, lateral),
        );
        this.body.applyImpulseAtPoint(scale(contactForce, dt), wheel.contactPoint, true);
      }

      // Wheel rotational dynamics: drive torque and tire reaction first.
      const wheelTorque = wheel.driveTorque - (wheel.contact ? longitudinal * wheel.radius : 0);
      let nextOmega = wheel.omega + (wheelTorque / wheel.inertia) * dt;

      // Brakes remove angular velocity, and can hold a wheel still against the
      // tire's reaction torque (which otherwise spins a locked wheel back up,
      // making the brakes grab and release every step).
      const brakeStep = (wheel.brakeTorque / wheel.inertia) * dt;
      if (brakeStep > 0) {
        nextOmega = Math.abs(nextOmega) <= brakeStep ? 0 : nextOmega - Math.sign(nextOmega) * brakeStep;
      }
      wheel.omega = nextOmega;

      if (!wheel.contact) {
        // Airborne wheels keep spinning, slowly losing speed to bearing drag.
        wheel.omega *= Math.max(0, 1 - dt * 0.6);
      }
      wheel.omega = clamp(wheel.omega, -520, 520);
      wheel.spin += wheel.omega * dt;
      wheel.previousCompression = wheel.compression;
    }

    // ---- aerodynamics ---------------------------------------------------
    const speed = length(velocity);
    if (speed > 0.5) {
      const q = 0.5 * 1.225 * speed * speed;
      const drag = q * config.aero.dragCoefficient * config.aero.frontalArea;
      this.body.applyImpulse(scale(velocity, (-drag * dt) / speed), true);
      const downforce = q * config.aero.downforceCoefficient * config.aero.frontalArea;
      this.body.applyImpulse(scale(up, -downforce * dt), true);
    }
  }

  snapshot(): VehicleSnapshot {
    const translation = this.body.translation();
    const rotation = this.body.rotation();
    const linvel = this.body.linvel();
    const quaternion: Quat = { x: rotation.x, y: rotation.y, z: rotation.z, w: rotation.w };
    const forward = rotate(quaternion, vec3(0, 0, 1));
    const velocity: Vec3 = { x: linvel.x, y: linvel.y, z: linvel.z };
    const signedSpeed = dot(velocity, forward);

    const wheels: WheelSnapshot[] = this.wheels.map((wheel) => ({
      steer: wheel.front ? this.steerAngle : 0,
      spin: wheel.spin,
      compression: wheel.compression,
      contact: wheel.contact,
      load: wheel.load,
      slipRatio: wheel.slipRatio,
      slipAngle: wheel.slipAngle,
      surface: wheel.surface,
      grip: wheel.grip.gripLong,
    }));

    return {
      position: [translation.x, translation.y, translation.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      linearVelocity: [linvel.x, linvel.y, linvel.z],
      wheels,
      rpm: this.engine.rpm,
      gear: this.transmission.gear,
      speedKmh: signedSpeed * 3.6,
      throttle: this.inputThrottle,
      brake: this.inputBrake,
      handbrake: this.inputHandbrake,
      steerAngle: this.steerAngle,
      engineRunning: this.engine.isRunning,
      clutchEngagement: this.clutchEngagement,
      clutchSlip: this.clutchSlip,
    };
  }

  /** Wheel names, exposed for diagnostics and tests. */
  static wheelName(index: number): string {
    return WHEEL_NAMES[index] ?? `wheel-${index}`;
  }
}
