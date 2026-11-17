import { NEUTRAL_INPUT, type InputState } from '../sim/protocol';

export interface ActionState {
  reset: boolean;
  cycleCamera: boolean;
  toggleFreeCamera: boolean;
  pause: boolean;
}

export interface FreeCameraDelta {
  dx: number;
  dy: number;
  zoom: number;
}

const SHIFT_PULSE_SECONDS = 0.12;
const GAMEPAD_DEADZONE = 0.12;

function approach(current: number, target: number, dt: number, rate: number): number {
  const difference = target - current;
  const step = rate * dt;
  if (Math.abs(difference) <= step) return target;
  return current + Math.sign(difference) * step;
}

function applyDeadzone(value: number): number {
  if (Math.abs(value) < GAMEPAD_DEADZONE) return 0;
  const scaled = (Math.abs(value) - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
  return Math.sign(value) * scaled;
}

/**
 * Collects raw input from keyboard and gamepad and produces smoothed control
 * values. Analog values are smoothed here; the vehicle solver receives the
 * same interface regardless of device.
 */
export class InputManager {
  readonly state: InputState = { ...NEUTRAL_INPUT };

  private throttleTarget = 0;
  private brakeTarget = 0;
  private steerTarget = 0;

  private shiftUpTimer = 0;
  private shiftDownTimer = 0;

  private actions: ActionState = {
    reset: false,
    cycleCamera: false,
    toggleFreeCamera: false,
    pause: false,
  };

  private freeCamera: FreeCameraDelta = { dx: 0, dy: 0, zoom: 0 };
  private dragging = false;
  private lastPointerX = 0;
  private lastPointerY = 0;
  private gamepad: Gamepad | null = null;
  private previousPadShiftUp = false;
  private previousPadShiftDown = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('gamepadconnected', this.handleGamepadConnected);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('wheel', this.handleWheel, { passive: false });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('gamepadconnected', this.handleGamepadConnected);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('pointermove', this.handlePointerMove);
    window.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('wheel', this.handleWheel);
  }

  private handleGamepadConnected = (event: GamepadEvent): void => {
    this.gamepad = event.gamepad;
  };

  private handleBlur = (): void => {
    this.throttleTarget = 0;
    this.brakeTarget = 0;
    this.steerTarget = 0;
    this.dragging = false;
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'SELECT' || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
      return;
    }

    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.throttleTarget = 1;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.brakeTarget = 1;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.steerTarget = -1;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.steerTarget = 1;
        break;
      case 'Space':
        this.state.handbrake = 1;
        break;
      case 'KeyE':
        if (!event.repeat) this.shiftUpTimer = SHIFT_PULSE_SECONDS;
        break;
      case 'KeyQ':
        if (!event.repeat) this.shiftDownTimer = SHIFT_PULSE_SECONDS;
        break;
      case 'KeyR':
        if (!event.repeat) this.actions.reset = true;
        break;
      case 'KeyC':
        if (!event.repeat) this.actions.cycleCamera = true;
        break;
      case 'KeyF':
        if (!event.repeat) this.actions.toggleFreeCamera = true;
        break;
      case 'Escape':
      case 'KeyP':
        if (!event.repeat) this.actions.pause = true;
        break;
      default:
        return;
    }

    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) {
      event.preventDefault();
    }
  };

  private handleKeyUp = (event: KeyboardEvent): void => {
    switch (event.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.throttleTarget = 0;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.brakeTarget = 0;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        if (this.steerTarget < 0) this.steerTarget = 0;
        break;
      case 'KeyD':
      case 'ArrowRight':
        if (this.steerTarget > 0) this.steerTarget = 0;
        break;
      case 'Space':
        this.state.handbrake = 0;
        break;
      default:
        break;
    }
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.dragging = true;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
    this.canvas.setPointerCapture?.(event.pointerId);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.freeCamera.dx += event.clientX - this.lastPointerX;
    this.freeCamera.dy += event.clientY - this.lastPointerY;
    this.lastPointerX = event.clientX;
    this.lastPointerY = event.clientY;
  };

  private handlePointerUp = (): void => {
    this.dragging = false;
  };

  private handleWheel = (event: WheelEvent): void => {
    event.preventDefault();
    this.freeCamera.zoom += event.deltaY;
  };

  private pollGamepad(): void {
    if (typeof navigator.getGamepads !== 'function') return;
    const pads = navigator.getGamepads();
    const pad = this.gamepad ? pads.find((entry) => entry?.index === this.gamepad?.index) ?? null : pads.find((entry) => entry !== null) ?? null;
    this.gamepad = pad ?? this.gamepad;
    if (!pad) return;

    const steer = applyDeadzone(pad.axes[0] ?? 0);
    if (Math.abs(steer) > 0.01) this.steerTarget = steer;

    const throttle = pad.buttons[7]?.value ?? 0;
    const brake = pad.buttons[6]?.value ?? 0;
    if (throttle > 0.02) this.throttleTarget = throttle;
    if (brake > 0.02) this.brakeTarget = brake;

    if (pad.buttons[0]?.pressed) this.state.handbrake = 1;

    const shiftUp = pad.buttons[5]?.pressed ?? false;
    const shiftDown = pad.buttons[4]?.pressed ?? false;
    if (shiftUp && !this.previousPadShiftUp) this.shiftUpTimer = SHIFT_PULSE_SECONDS;
    if (shiftDown && !this.previousPadShiftDown) this.shiftDownTimer = SHIFT_PULSE_SECONDS;
    this.previousPadShiftUp = shiftUp;
    this.previousPadShiftDown = shiftDown;
  }

  /** Advance smoothing and edge timers. `dt` is in seconds. */
  update(dt: number): void {
    this.pollGamepad();

    this.state.throttle = approach(this.state.throttle, this.throttleTarget, dt, 5.5);
    this.state.brake = approach(this.state.brake, this.brakeTarget, dt, 6.5);

    const steerRate = Math.abs(this.steerTarget) > Math.abs(this.state.steer) ? 4.5 : 7;
    this.state.steer = approach(this.state.steer, this.steerTarget, dt, steerRate);

    this.shiftUpTimer = Math.max(0, this.shiftUpTimer - dt);
    this.shiftDownTimer = Math.max(0, this.shiftDownTimer - dt);
    this.state.shiftUp = this.shiftUpTimer > 0;
    this.state.shiftDown = this.shiftDownTimer > 0;
  }

  consumeActions(): ActionState {
    const actions = { ...this.actions };
    this.actions = { reset: false, cycleCamera: false, toggleFreeCamera: false, pause: false };
    return actions;
  }

  consumeFreeCamera(): FreeCameraDelta {
    const delta = { ...this.freeCamera };
    this.freeCamera = { dx: 0, dy: 0, zoom: 0 };
    return delta;
  }

  /** Clear analog and one-shot input, e.g. when pausing or leaving the session. */
  reset(): void {
    this.throttleTarget = 0;
    this.brakeTarget = 0;
    this.steerTarget = 0;
    this.state.throttle = 0;
    this.state.brake = 0;
    this.state.steer = 0;
    this.state.handbrake = 0;
    this.state.shiftUp = false;
    this.state.shiftDown = false;
    this.shiftUpTimer = 0;
    this.shiftDownTimer = 0;
  }
}
