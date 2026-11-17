import { describe, expect, it } from 'vitest';
import { SimulationClock } from '../src/sim/simulation-clock';

describe('simulation clock', () => {
  it('advances whole fixed steps', () => {
    const clock = new SimulationClock(120);
    expect(clock.advance(1000 / 60)).toBe(2);
    expect(clock.time).toBeCloseTo(2 / 120, 9);
  });

  it('keeps an exact step count over ten seconds of 60 fps frames', () => {
    const clock = new SimulationClock(120);
    for (let i = 0; i < 600; i += 1) clock.advance(1000 / 60);
    expect(clock.steps).toBe(1200);
    expect(clock.dropped).toBe(0);
    expect(clock.time).toBeCloseTo(10, 6);
  });

  it('does not drift with irregular frame times', () => {
    const clock = new SimulationClock(120);
    const deltas = [16.7, 8.3, 33.4, 12.1, 4.2, 21.7, 6.9];
    let elapsed = 0;
    let index = 0;
    while (elapsed < 9999.9) {
      const delta = deltas[index % deltas.length];
      clock.advance(delta);
      elapsed += delta;
      index += 1;
    }
    const expected = Math.floor((elapsed / 1000) * 120);
    expect(Math.abs(clock.steps - expected)).toBeLessThanOrEqual(1);
  });

  it('holds steady across render rates from 30 to 144 fps', () => {
    for (const fps of [30, 60, 90, 144]) {
      const clock = new SimulationClock(120);
      for (let i = 0; i < fps * 5; i += 1) clock.advance(1000 / fps);
      const expected = Math.floor(5 * 120);
      expect(Math.abs(clock.steps - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('drops a backlog instead of spiralling', () => {
    const clock = new SimulationClock(120, 8);
    const steps = clock.advance(5000);
    expect(steps).toBe(8);
    expect(clock.dropped).toBeGreaterThan(0);
  });

  it('ignores invalid deltas', () => {
    const clock = new SimulationClock(120);
    expect(clock.advance(Number.NaN)).toBe(0);
    expect(clock.advance(-12)).toBe(0);
    expect(clock.steps).toBe(0);
  });

  it('reports interpolation alpha within one step', () => {
    const clock = new SimulationClock(120);
    clock.advance(1000 / 120 / 2);
    expect(clock.alpha).toBeGreaterThan(0);
    expect(clock.alpha).toBeLessThanOrEqual(1);
  });
});
