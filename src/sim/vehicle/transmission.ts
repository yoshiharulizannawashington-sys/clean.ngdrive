import type { TransmissionConfig } from './types';

/** Effective ratio for a gear: 0 = neutral, -1 = reverse, 1..n = forward. */
export function gearRatioFor(config: TransmissionConfig, gear: number): number {
  if (gear === 0) return 0;
  if (gear === -1) return -config.reverseRatio;
  const index = gear - 1;
  if (index < 0 || index >= config.gearRatios.length) return 0;
  return config.gearRatios[index];
}

export function wheelRpmFromWheelOmega(omega: number, ratio: number, finalDrive: number): number {
  return (omega * ratio * finalDrive * 60) / (Math.PI * 2);
}

export interface TransmissionInput {
  rpm: number;
  /** Engine speed the current gear would give at road speed (no wheelspin). */
  roadRpm?: number;
  throttle: number;
  /** Signed forward speed in m/s. */
  speed: number;
  brake: number;
  shiftUp: boolean;
  shiftDown: boolean;
}

export interface TransmissionUpdate {
  shifted: boolean;
  /** True while the drivetrain is disconnected for a gear change. */
  torqueCut: boolean;
}

/**
 * Gearbox state machine.
 *
 * Automatic mode selects gears from engine rpm and throttle, with a torque cut
 * during the shift. Manual mode shifts only on player input. In both cases
 * reverse is engaged by holding the brake from a standstill.
 *
 * Note: this is a ratio/shift model, not a full clutch and torque-converter
 * simulation. Clutch slip is handled approximately by the vehicle solver.
 */
export class Transmission {
  gear = 1;
  private timer = 0;
  /** Prevent an immediate shift back after a shift has just completed. */
  private holdTimer = 0;
  /** Time spent continuously below the downshift threshold. */
  private lowRpmTimer = 0;

  constructor(private readonly config: TransmissionConfig) {}

  get ratio(): number {
    return gearRatioFor(this.config, this.gear);
  }

  get gearCount(): number {
    return this.config.gearRatios.length;
  }

  get shifting(): boolean {
    return this.timer > 0;
  }

  reset(): void {
    this.gear = 1;
    this.timer = 0;
    this.holdTimer = 0;
    this.lowRpmTimer = 0;
  }

  private shiftTo(gear: number): boolean {
    if (gear === this.gear) return false;
    this.gear = gear;
    this.timer = Math.max(0.05, this.config.shiftTime);
    // Settle time so an automatic cannot bounce straight back to the old gear
    // (for example an immediate kickdown right after an upshift).
    this.holdTimer = this.timer + 0.8;
    this.lowRpmTimer = 0;
    return true;
  }

  update(dt: number, input: TransmissionInput): TransmissionUpdate {
    if (this.timer > 0) this.timer = Math.max(0, this.timer - dt);
    if (this.holdTimer > 0) this.holdTimer = Math.max(0, this.holdTimer - dt);
    if (input.rpm < this.config.downshiftRpm) this.lowRpmTimer += dt;
    else this.lowRpmTimer = 0;

    const { gear } = this;
    let shifted = false;

    if (this.config.type === 'manual') {
      if (input.shiftUp && gear >= 1 && gear < this.gearCount) shifted = this.shiftTo(gear + 1);
      else if (input.shiftDown && gear > 1) shifted = this.shiftTo(gear - 1);
      else if (gear > 0 && Math.abs(input.speed) < 0.4 && input.brake > 0.5 && input.throttle < 0.1) {
        shifted = this.shiftTo(-1);
      } else if (gear === -1 && input.throttle > 0.15 && input.speed > -0.6) {
        shifted = this.shiftTo(1);
      }
    } else if (!this.shifting) {
      if (gear > 0 && Math.abs(input.speed) < 0.5 && input.brake > 0.25 && input.throttle < 0.1) {
        shifted = this.shiftTo(-1);
      } else if (gear === -1 && input.throttle > 0.15 && input.speed > -0.6) {
        shifted = this.shiftTo(1);
      } else if (gear === -1 && Math.abs(input.speed) < 0.3 && input.brake < 0.1 && input.throttle < 0.05) {
        shifted = this.shiftTo(1);
      } else if (gear > 0) {
        // Refuse an upshift that would leave the next gear lugging below its
        // downshift point; wheelspin can otherwise raise engine rpm while the
        // car is still too slow for the next gear.
        const currentRatio = gearRatioFor(this.config, gear);
        const nextRatio = gearRatioFor(this.config, gear + 1);
        const roadRpm = input.roadRpm ?? input.rpm;
        const nextRoadRpm = currentRatio > 0 ? (roadRpm * nextRatio) / currentRatio : 0;
        const nextGearViable = nextRoadRpm >= this.config.downshiftRpm * 1.15;

        if (
          input.rpm > this.config.upshiftRpm &&
          input.throttle > 0.02 &&
          gear < this.gearCount &&
          nextGearViable
        ) {
          shifted = this.shiftTo(gear + 1);
        } else if (gear > 1 && (this.holdTimer <= 0 || input.roadRpm === undefined)) {
          // Downshifts need a dwell at road speed (prevents hunting around a
          // shift point) and an explicit kickdown. Sequential upshifts above
          // are not held back: only reversing direction is.
          const dwellOk = input.roadRpm === undefined || this.lowRpmTimer > 0.5;
          const kickdown =
            input.throttle > 0.95 &&
            input.rpm < this.config.kickdownRpm * 0.8 &&
            this.config.upshiftRpm - input.rpm > 2200;
          if (this.lowRpmTimer > 0 && dwellOk && (kickdown || input.rpm < this.config.downshiftRpm)) {
            shifted = this.shiftTo(gear - 1);
          } else if (kickdown) {
            shifted = this.shiftTo(gear - 1);
          }
        }
      }
    }

    return { shifted, torqueCut: this.shifting || this.gear === 0 };
  }
}
