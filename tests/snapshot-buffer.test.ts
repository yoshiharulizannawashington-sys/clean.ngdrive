import { describe, expect, it } from 'vitest';
import { SnapshotBuffer } from '../src/app/snapshot-buffer';
import type { SimSnapshot } from '../src/sim/protocol';

function makeSnapshot(time: number, x: number): SimSnapshot {
  return {
    seq: Math.round(time),
    time,
    vehicle: {
      position: [x, 1, 0],
      rotation: [0, 0, 0, 1],
      linearVelocity: [0, 0, 0],
      wheels: Array.from({ length: 4 }, () => ({
        steer: 0,
        spin: 0,
        compression: 0.1,
        contact: true,
        load: 1000,
        slipRatio: 0,
        slipAngle: 0,
        surface: 'asphalt-dry' as const,
        grip: 1,
      })),
      rpm: 1000,
      gear: 1,
      speedKmh: x,
      throttle: 0,
      brake: 0,
      handbrake: 0,
      steerAngle: 0,
      engineRunning: true,
      clutchEngagement: 1,
      clutchSlip: 0,
    },
    props: [],
    stats: {
      stepMs: 0.1,
      averageStepMs: 0.1,
      maxStepMs: 0.2,
      simTime: time / 1000,
      steps: 1,
      droppedTime: 0,
      bodies: 6,
    },
  };
}

describe('snapshot buffer', () => {
  it('interpolates between two snapshots', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(makeSnapshot(0, 0));
    buffer.push(makeSnapshot(1000 / 60, 10));
    buffer.advance(1000 / 120);
    const frame = buffer.sample();
    expect(frame).not.toBeNull();
    expect(frame!.position.x).toBeGreaterThan(3);
    expect(frame!.position.x).toBeLessThan(7);
  });

  it('never plays past the newest snapshot', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(makeSnapshot(0, 0));
    buffer.push(makeSnapshot(16, 10));
    buffer.advance(2000);
    const frame = buffer.sample();
    expect(frame!.position.x).toBeCloseTo(10, 5);
  });

  it('exposes the latest statistics', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(makeSnapshot(0, 0));
    buffer.push(makeSnapshot(16, 10));
    expect(buffer.latestStats?.bodies).toBe(6);
    expect(buffer.latest?.seq).toBe(16);
  });

  it('keeps interpolation stable while the buffer fills', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(makeSnapshot(0, 0));
    expect(buffer.sample()!.position.x).toBeCloseTo(0, 5);
    buffer.push(makeSnapshot(16, 8));
    buffer.advance(8);
    const frame = buffer.sample()!;
    expect(frame.position.x).toBeGreaterThan(2);
    expect(frame.position.x).toBeLessThan(6);
  });

  it('bounds buffered snapshots', () => {
    const buffer = new SnapshotBuffer();
    for (let i = 0; i < 40; i += 1) buffer.push(makeSnapshot(i * 16, i));
    expect(buffer.length).toBeLessThanOrEqual(8);
  });
});
