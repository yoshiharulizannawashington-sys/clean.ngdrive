/**
 * Fixed-timestep simulation clock.
 *
 * The clock is driven by wall-clock frame deltas but always advances the
 * simulation in whole, identical steps. Render frame rate therefore cannot
 * change the physics timestep, and time does not drift: leftover time is kept
 * in the accumulator.
 */
export class SimulationClock {
  readonly step: number;
  readonly maxSubSteps: number;

  private accumulator = 0;
  private elapsedTime = 0;
  private stepCount = 0;
  private droppedTime = 0;

  constructor(hz = 120, maxSubSteps = 8) {
    if (hz <= 0) throw new Error('SimulationClock requires a positive rate');
    this.step = 1 / hz;
    this.maxSubSteps = Math.max(1, Math.floor(maxSubSteps));
  }

  /** Advance by a wall-clock delta in milliseconds and return whole steps due. */
  advance(deltaMs: number): number {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;

    this.accumulator += Math.min(deltaMs, 250) / 1000;

    let steps = 0;
    while (this.accumulator >= this.step - 1e-9 && steps < this.maxSubSteps) {
      this.accumulator -= this.step;
      this.elapsedTime += this.step;
      this.stepCount += 1;
      steps += 1;
    }

    // Still behind after the substep budget: the machine cannot keep up.
    // Drop the backlog instead of spiralling, and record it for diagnostics.
    if (this.accumulator >= this.step) {
      this.droppedTime += this.accumulator;
      this.accumulator = 0;
    }

    return steps;
  }

  get time(): number {
    return this.elapsedTime;
  }

  get steps(): number {
    return this.stepCount;
  }

  get dropped(): number {
    return this.droppedTime;
  }

  /** Fraction of a step already accumulated, for render interpolation. */
  get alpha(): number {
    return Math.min(1, this.accumulator / this.step);
  }

  reset(): void {
    this.accumulator = 0;
    this.elapsedTime = 0;
    this.stepCount = 0;
    this.droppedTime = 0;
  }
}
