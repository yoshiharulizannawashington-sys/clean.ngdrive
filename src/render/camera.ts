import * as THREE from 'three';
import type { InterpolatedFrame } from '../app/snapshot-buffer';
import type { FreeCameraDelta } from '../input/input';

export type CameraMode = 'chase' | 'close' | 'hood' | 'cockpit' | 'free';

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Chase',
  close: 'Close chase',
  hood: 'Hood',
  cockpit: 'Cockpit',
  free: 'Free',
};

const CYCLE: CameraMode[] = ['chase', 'close', 'hood', 'cockpit'];
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/**
 * Camera rig. Chase and close-chase cameras follow vehicle yaw only (so a
 * rollover does not spin the horizon), while hood and cockpit cameras follow the
 * full chassis orientation.
 */
export class CameraRig {
  mode: CameraMode = 'chase';

  private initialized = false;
  private readonly lookTarget = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private orbitYaw = 0.6;
  private orbitPitch = 0.34;
  private orbitDistance = 8.5;
  private menuAngle = 0;
  private currentFov = 62;

  constructor(private readonly camera: THREE.PerspectiveCamera) {}

  cycle(): CameraMode {
    const index = CYCLE.indexOf(this.mode);
    const next = CYCLE[(index < 0 ? 0 : index + 1) % CYCLE.length];
    this.mode = next;
    this.initialized = false;
    return next;
  }

  toggleFree(): CameraMode {
    this.mode = this.mode === 'free' ? 'chase' : 'free';
    this.initialized = false;
    return this.mode;
  }

  snap(): void {
    this.initialized = false;
  }

  update(dt: number, frame: InterpolatedFrame | null, menuOrbit: boolean, freeInput: FreeCameraDelta): void {
    if (!frame) return;

    if (menuOrbit) {
      this.menuAngle += dt * 0.14;
      this.desired.set(
        frame.position.x + Math.sin(this.menuAngle) * 8.6,
        frame.position.y + 2.5,
        frame.position.z + Math.cos(this.menuAngle) * 8.6,
      );
      this.camera.position.lerp(this.desired, this.initialized ? 1 - Math.exp(-dt * 4) : 1);
      this.lookTarget.copy(frame.position).add(new THREE.Vector3(0, 0.65, 0));
      this.camera.lookAt(this.lookTarget);
      this.initialized = true;
      this.setFov(58, dt, true);
      return;
    }

    if (this.mode === 'free') {
      this.orbitYaw -= freeInput.dx * 0.006;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + freeInput.dy * 0.004, -0.12, 1.35);
      this.orbitDistance = THREE.MathUtils.clamp(this.orbitDistance * (1 + freeInput.zoom * 0.0012), 2.5, 60);

      this.desired
        .copy(frame.position)
        .add(
          new THREE.Vector3(
            Math.sin(this.orbitYaw) * Math.cos(this.orbitPitch) * this.orbitDistance,
            Math.sin(this.orbitPitch) * this.orbitDistance + 0.8,
            Math.cos(this.orbitYaw) * Math.cos(this.orbitPitch) * this.orbitDistance,
          ),
        );
      this.camera.position.lerp(this.desired, this.initialized ? 1 - Math.exp(-dt * 14) : 1);
      this.lookTarget.copy(frame.position).add(new THREE.Vector3(0, 0.8, 0));
      this.camera.lookAt(this.lookTarget);
      this.initialized = true;
      this.setFov(62, dt, true);
      return;
    }

    if (this.mode === 'chase' || this.mode === 'close') {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(frame.quaternion);
      const yaw = Math.atan2(forward.x, forward.z);
      const offset =
        this.mode === 'chase' ? new THREE.Vector3(0, 2.25, -6.4) : new THREE.Vector3(0, 1.62, -4.35);
      offset.applyAxisAngle(WORLD_UP, yaw);

      this.desired.copy(frame.position).add(offset);
      this.camera.position.lerp(this.desired, this.initialized ? 1 - Math.exp(-dt * 6.5) : 1);

      const look = frame.position.clone().add(new THREE.Vector3(0, 0.85, 0));
      look.add(forward.multiplyScalar(1.4));
      this.lookTarget.lerp(look, this.initialized ? 1 - Math.exp(-dt * 9) : 1);
      this.camera.lookAt(this.lookTarget);

      const speedFactor = Math.min(1, Math.abs(frame.speedKmh) / 190);
      this.setFov((this.mode === 'chase' ? 62 : 68) + speedFactor * 7, dt, this.initialized);
      this.initialized = true;
      return;
    }

    // Interior and hood cameras are rigidly attached to the chassis.
    const local =
      this.mode === 'cockpit' ? new THREE.Vector3(0.34, 0.3, 0.12) : new THREE.Vector3(0, 0.52, 1.7);
    this.desired.copy(local).applyQuaternion(frame.quaternion).add(frame.position);
    this.camera.position.copy(this.desired);

    const lookLocal =
      this.mode === 'cockpit' ? new THREE.Vector3(0.34, 0.28, 12) : new THREE.Vector3(0, 0.42, 14);
    this.lookTarget.copy(lookLocal).applyQuaternion(frame.quaternion).add(frame.position);
    this.camera.lookAt(this.lookTarget);
    this.setFov(this.mode === 'cockpit' ? 72 : 66, dt, true);
    this.initialized = true;
  }

  private setFov(target: number, dt: number, smooth: boolean): void {
    this.currentFov = smooth ? THREE.MathUtils.lerp(this.currentFov, target, 1 - Math.exp(-dt * 4)) : target;
    if (Math.abs(this.camera.fov - this.currentFov) > 0.01) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }
  }
}
