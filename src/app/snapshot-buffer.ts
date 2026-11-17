import { Quaternion, Vector3 } from 'three';
import type { SimSnapshot, SimStats } from '../sim/protocol';

export interface FrameWheel {
  steer: number;
  spin: number;
  compression: number;
  contact: boolean;
  load: number;
  slipRatio: number;
  slipAngle: number;
}

export interface FrameProp {
  position: Vector3;
  quaternion: Quaternion;
}

export interface InterpolatedFrame {
  position: Vector3;
  quaternion: Quaternion;
  wheels: FrameWheel[];
  props: FrameProp[];
  rpm: number;
  gear: number;
  speedKmh: number;
  throttle: number;
  brake: number;
  handbrake: number;
  steerAngle: number;
  /** Interpolated simulation time in ms. */
  time: number;
  stats: SimStats;
}

const MAX_SNAPSHOTS = 8;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Buffers worker snapshots and plays them back slightly behind real time,
 * interpolating between the two surrounding snapshots. This decouples render
 * frame rate from the fixed simulation rate without ever stepping physics on
 * the main thread.
 */
export class SnapshotBuffer {
  private snapshots: SimSnapshot[] = [];
  private playbackTime = 0;
  private initialized = false;
  private lastReceivedAt = 0;

  push(snapshot: SimSnapshot): void {
    this.snapshots.push(snapshot);
    if (this.snapshots.length > MAX_SNAPSHOTS) this.snapshots.shift();
    this.lastReceivedAt = performance.now();
    if (!this.initialized) {
      this.playbackTime = snapshot.time;
      this.initialized = true;
    }
  }

  /** Advance playback by a wall-clock delta in milliseconds. */
  advance(dtMs: number): void {
    if (!this.initialized || this.snapshots.length === 0) return;
    this.playbackTime += Math.max(0, dtMs);
    const newest = this.snapshots[this.snapshots.length - 1];
    const oldest = this.snapshots[0];
    if (this.playbackTime > newest.time) this.playbackTime = newest.time;
    if (this.playbackTime < oldest.time) this.playbackTime = oldest.time;
  }

  get length(): number {
    return this.snapshots.length;
  }

  get ageMs(): number {
    return this.lastReceivedAt === 0 ? 0 : performance.now() - this.lastReceivedAt;
  }

  get latest(): SimSnapshot | null {
    return this.snapshots.length === 0 ? null : this.snapshots[this.snapshots.length - 1];
  }

  get latestStats(): SimStats | null {
    return this.latest?.stats ?? null;
  }

  sample(): InterpolatedFrame | null {
    if (this.snapshots.length === 0) return null;

    let index = 0;
    for (let i = 0; i < this.snapshots.length - 1; i += 1) {
      index = i;
      if (this.snapshots[i + 1].time >= this.playbackTime) break;
    }

    const a = this.snapshots[index];
    const b = this.snapshots[Math.min(index + 1, this.snapshots.length - 1)];
    const span = b.time - a.time;
    const t = span > 1e-6 ? Math.min(1, Math.max(0, (this.playbackTime - a.time) / span)) : 1;

    return this.buildFrame(a, b, t);
  }

  private buildFrame(a: SimSnapshot, b: SimSnapshot, t: number): InterpolatedFrame {
    const position = new Vector3(
      lerp(a.vehicle.position[0], b.vehicle.position[0], t),
      lerp(a.vehicle.position[1], b.vehicle.position[1], t),
      lerp(a.vehicle.position[2], b.vehicle.position[2], t),
    );

    const quaternion = new Quaternion(
      a.vehicle.rotation[0],
      a.vehicle.rotation[1],
      a.vehicle.rotation[2],
      a.vehicle.rotation[3],
    ).slerp(
      new Quaternion(
        b.vehicle.rotation[0],
        b.vehicle.rotation[1],
        b.vehicle.rotation[2],
        b.vehicle.rotation[3],
      ),
      t,
    );

    const wheels = b.vehicle.wheels.map((wheel, i) => {
      const previous = a.vehicle.wheels[i] ?? wheel;
      return {
        steer: lerp(previous.steer, wheel.steer, t),
        spin: lerp(previous.spin, wheel.spin, t),
        compression: lerp(previous.compression, wheel.compression, t),
        contact: wheel.contact,
        load: lerp(previous.load, wheel.load, t),
        slipRatio: lerp(previous.slipRatio, wheel.slipRatio, t),
        slipAngle: lerp(previous.slipAngle, wheel.slipAngle, t),
      };
    });

    const props = b.props.map((prop, i) => {
      const previous = a.props[i] ?? prop;
      return {
        position: new Vector3(
          lerp(previous.position[0], prop.position[0], t),
          lerp(previous.position[1], prop.position[1], t),
          lerp(previous.position[2], prop.position[2], t),
        ),
        quaternion: new Quaternion(
          previous.rotation[0],
          previous.rotation[1],
          previous.rotation[2],
          previous.rotation[3],
        ).slerp(
          new Quaternion(prop.rotation[0], prop.rotation[1], prop.rotation[2], prop.rotation[3]),
          t,
        ),
      };
    });

    return {
      position,
      quaternion,
      wheels,
      props,
      rpm: lerp(a.vehicle.rpm, b.vehicle.rpm, t),
      gear: b.vehicle.gear,
      speedKmh: lerp(a.vehicle.speedKmh, b.vehicle.speedKmh, t),
      throttle: b.vehicle.throttle,
      brake: b.vehicle.brake,
      handbrake: b.vehicle.handbrake,
      steerAngle: lerp(a.vehicle.steerAngle, b.vehicle.steerAngle, t),
      time: lerp(a.time, b.time, t),
      stats: b.stats,
    };
  }
}
