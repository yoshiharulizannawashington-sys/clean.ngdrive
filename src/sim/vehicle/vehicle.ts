import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, RigidBody, World } from '@dimforge/rapier3d-compat';
import type { InputState, SpawnPoint, VehicleSnapshot, WheelSnapshot } from '../protocol';
import type { VehicleConfig } from './types';
import { Transmission, wheelRpmFromWheelOmega } from './transmission';
import { engineNetTorque } from './engine';
import { tireForces } from './tire';
import { antiRollForce, suspensionForce } from './suspension';
import { perWheelTorque, splitAxleTorque } from './drivetrain';
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
  smoothstep,
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
}

const WHEEL_NAMES = ['front-left', 'front-right', 'rear-left', 'rear-right'];

/**
 * Vehicle simulation: a rigid chassis carried by four independently solved
 * suspension units.
 *
 * Each step:
 *  1. read the chassis state from Rapier,
 *  2. derive engine rpm from the driven wheels through the gearbox,
 *  3. raycast each suspension against the world, spring/damper/anti-roll forces,
 *  4. compute slip-based tire forces at each contact patch,
 *  5. apply those forces as impulses at the contact points,
 *  6. integrate wheel rotation from drive torque, brake torque and tire reaction.
 *
 * Weight transfer, body roll, pitch, wheelspin and lock-up all come out of that
 * loop; nothing is animated.
 */
export class VehicleSim {
  readonly config: VehicleConfig;
  private readonly world: World;
  private readonly body: RigidBody;
  private readonly collider: Collider;
  private readonly wheels: WheelRuntime[] = [];
  private readonly transmission: Transmission;
  private spawn: SpawnPoint;

  private steerAngle = 0;
  private engineRpm: number;
  private inputThrottle = 0;
  private inputBrake = 0;
  private inputHandbrake = 0;

  constructor(world: World, config: VehicleConfig, spawn: SpawnPoint) {
    this.world = world;
    this.config = config;
    this.spawn = spawn;
    this.engineRpm = config.engine.idleRpm;
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
    this.engineRpm = this.config.engine.idleRpm;
    this.steerAngle = 0;
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

    // ---- engine rpm and gearbox ----------------------------------------
    // Engine speed is derived from *road* speed through the gearing, not from
    // raw wheel speed. Using wheel speed would let wheelspin feed back into the
    // rpm, the shift points and the torque, which makes the gearbox hunt and
    // destroys acceleration. Wheelspin flare is a Phase 2 engine-inertia model.
    const drivenRadius =
      config.drivetrain.layout === 'FWD' ? config.wheelFront.radius : config.wheelRear.radius;
    const roadWheelOmega = forwardSpeed / drivenRadius;
    const ratio = this.transmission.ratio;
    const coupledWheelRpm = Math.abs(
      wheelRpmFromWheelOmega(roadWheelOmega, ratio, config.transmission.finalDrive),
    );
    // Clutch lock: how strongly the engine is tied to the driven wheels.
    const clutchLock = smoothstep(0, 12, coupledWheelRpm);
    const freeRevRpm = config.engine.idleRpm + input.throttle * (config.engine.redlineRpm * 0.7 - config.engine.idleRpm);
    const rpmTarget = clamp(
      Math.max(config.engine.idleRpm, coupledWheelRpm, freeRevRpm * (1 - clutchLock)),
      config.engine.idleRpm,
      config.engine.redlineRpm + 150,
    );
    const rpmAlpha = 1 - Math.exp(-dt * (Math.abs(ratio) < 1e-6 ? 7 : 26));
    this.engineRpm += (rpmTarget - this.engineRpm) * rpmAlpha;

    const shift = this.transmission.update(dt, {
      rpm: this.engineRpm,
      throttle: input.throttle,
      speed: forwardSpeed,
      brake: input.brake,
      shiftUp: input.shiftUp,
      shiftDown: input.shiftDown,
    });

    const currentRatio = this.transmission.ratio;
    let axleTorque = 0;
    if (!shift.torqueCut && Math.abs(currentRatio) > 1e-6) {
      const netTorque = engineNetTorque(config.engine, this.engineRpm, input.throttle);
      // Partial *positive* torque transfer while the clutch slips, so the car
      // can launch from rest. Negative torque (engine braking, friction) only
      // reaches the wheels once the clutch is actually locked; otherwise a
      // parked car would be dragged backwards by idle drag through a slipping
      // clutch, which is not physical.
      // Engine braking only acts once the car is actually rolling; otherwise
      // idle drag through a slipping clutch makes a parked car creep.
      const rolling = Math.abs(forwardSpeed) > 0.3;
      const transfer = netTorque >= 0 ? 0.4 + 0.6 * clutchLock : rolling ? clutchLock : 0;
      axleTorque =
        netTorque * currentRatio * config.transmission.finalDrive * config.transmission.efficiency * transfer;
    }

    const axle = splitAxleTorque(config.drivetrain.layout, config.drivetrain.frontSplit, axleTorque);
    const frontDrive = perWheelTorque(axle.front);
    const rearDrive = perWheelTorque(axle.rear);
    this.wheels[0].driveTorque = frontDrive;
    this.wheels[1].driveTorque = frontDrive;
    this.wheels[2].driveTorque = rearDrive;
    this.wheels[3].driveTorque = rearDrive;

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
        const forces = tireForces(config.tire, {
          load,
          slipRatio: wheel.slipRatio,
          slipAngle: wheel.slipAngle,
          forwardSpeed: wheel.longVel,
        });
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
    }));

    return {
      position: [translation.x, translation.y, translation.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      linearVelocity: [linvel.x, linvel.y, linvel.z],
      wheels,
      rpm: this.engineRpm,
      gear: this.transmission.gear,
      speedKmh: signedSpeed * 3.6,
      throttle: this.inputThrottle,
      brake: this.inputBrake,
      handbrake: this.inputHandbrake,
      steerAngle: this.steerAngle,
    };
  }

  /** Wheel names, exposed for diagnostics and tests. */
  static wheelName(index: number): string {
    return WHEEL_NAMES[index] ?? `wheel-${index}`;
  }
}
