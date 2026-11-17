import { describe, expect, it } from 'vitest';
import { isMainToSim, isSimToMain, sanitizeInput } from '../src/sim/protocol';

describe('protocol validation', () => {
  it('accepts known main-to-sim messages', () => {
    expect(isMainToSim({ type: 'reset' })).toBe(true);
    expect(isMainToSim({ type: 'set-running', running: false })).toBe(true);
    expect(isMainToSim({ type: 'input', input: {} })).toBe(true);
  });

  it('rejects malformed messages', () => {
    expect(isMainToSim(null)).toBe(false);
    expect(isMainToSim('input')).toBe(false);
    expect(isMainToSim({ type: 'steal-state' })).toBe(false);
    expect(isMainToSim({})).toBe(false);
  });

  it('accepts known sim-to-main messages', () => {
    expect(isSimToMain({ type: 'ready' })).toBe(true);
    expect(isSimToMain({ type: 'fatal', message: 'boom' })).toBe(true);
    expect(isSimToMain({ type: 'snapshot', snapshot: {} })).toBe(true);
  });
});

describe('input sanitising', () => {
  it('clamps values into range', () => {
    const input = sanitizeInput({ throttle: 5, brake: -3, steer: 12, handbrake: -1 });
    expect(input.throttle).toBe(1);
    expect(input.brake).toBe(0);
    expect(input.steer).toBe(1);
    expect(input.handbrake).toBe(0);
  });

  it('allows full left steering', () => {
    expect(sanitizeInput({ steer: -1 }).steer).toBe(-1);
  });

  it('replaces non-finite values with neutral', () => {
    const input = sanitizeInput({ throttle: Number.NaN, brake: Number.POSITIVE_INFINITY, steer: Number.NEGATIVE_INFINITY });
    expect(input.throttle).toBe(0);
    expect(input.brake).toBe(0);
    expect(input.steer).toBe(0);
  });

  it('only forwards real booleans as shift commands', () => {
    expect(sanitizeInput({ shiftUp: true, shiftDown: false }).shiftUp).toBe(true);
    // @ts-expect-error deliberately malformed input
    expect(sanitizeInput({ shiftUp: 'yes' }).shiftUp).toBe(false);
  });

  it('returns neutral input for missing data', () => {
    expect(sanitizeInput(undefined)).toEqual({
      throttle: 0,
      brake: 0,
      steer: 0,
      handbrake: 0,
      shiftUp: false,
      shiftDown: false,
    });
  });
});
