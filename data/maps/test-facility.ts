import type { SpawnPoint } from '../../src/sim/protocol';
import type { SurfaceId } from '../../src/sim/surfaces';

/**
 * Vehicle Test Facility — the first playable map.
 *
 * The same data builds the rendered geometry and the physics colliders, so the
 * world you see is exactly the world the solver collides with. Surface patches
 * are tagged with a material id; the simulation reads that material at the
 * contact patch instead of guessing from the car's position.
 */

export type FacilityBoxKind = 'barrier' | 'crash-wall' | 'ramp' | 'building' | 'kerb';

export interface FacilityBox {
  id: string;
  kind: FacilityBoxKind;
  /** Centre of the box. */
  position: [number, number, number];
  /** Full size on each axis. */
  size: [number, number, number];
  /** XYZ Euler rotation in radians. */
  rotation?: [number, number, number];
}

export interface FacilityCone {
  id: string;
  position: [number, number, number];
  height: number;
  radius: number;
}

export interface FacilityTree {
  position: [number, number, number];
  scale: number;
}

/** A flat drivable patch with a physical surface material. */
export interface FacilitySurfacePatch {
  id: string;
  surface: SurfaceId;
  /** Centre on the XZ plane. */
  position: [number, number];
  /** Full width (x) and depth (z). */
  size: [number, number];
}

export interface FacilityDefinition {
  id: string;
  name: string;
  description: string;
  groundSize: number;
  spawn: SpawnPoint;
  boxes: FacilityBox[];
  cones: FacilityCone[];
  trees: FacilityTree[];
  surfaces: FacilitySurfacePatch[];
  skidPad: { x: number; z: number; radius: number };
  accelerationStrip: { x: number; fromZ: number; toZ: number; width: number };
  brakingZoneZ: number[];
  splitFrictionLane: { centerX: number; z: number; halfWidth: number; length: number };
}

function buildBarriers(): FacilityBox[] {
  const boxes: FacilityBox[] = [];
  for (let i = 0; i < 10; i += 1) {
    const z = -26 + i * 12;
    for (const side of [-1, 1]) {
      boxes.push({
        id: `barrier-${side > 0 ? 'right' : 'left'}-${i}`,
        kind: 'barrier',
        position: [side * 13, 0.42, z],
        size: [0.46, 0.84, 2.6],
      });
    }
  }
  return boxes;
}

function buildTrees(): FacilityTree[] {
  const trees: FacilityTree[] = [];
  let seed = 20261117;
  const random = (): number => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  for (let i = 0; i < 64; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 130 + random() * 55;
    trees.push({
      position: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius],
      scale: 0.75 + random() * 0.65,
    });
  }
  return trees;
}

function buildSlalomCones(): FacilityCone[] {
  const cones: FacilityCone[] = [];
  for (let i = 0; i < 14; i += 1) {
    const x = -18 + (i % 2 === 0 ? -2.2 : 2.2);
    cones.push({
      id: `slalom-${i}`,
      position: [x, 0.34, -6 + i * 3.6],
      height: 0.68,
      radius: 0.26,
    });
  }
  return cones;
}

function buildArticulationBumps(): FacilityBox[] {
  // Low ridges laid across a lane: each wheel takes them at a different time.
  return Array.from({ length: 4 }, (_, i) => ({
    id: `articulation-${i}`,
    kind: 'kerb' as const,
    position: [-32, 0.05, 30 + i * 4] as [number, number, number],
    size: [7, 0.1, 1.1] as [number, number, number],
  }));
}

const spawn: SpawnPoint = { position: [0, 0.62, -18], yaw: 0 };

export const TEST_FACILITY: FacilityDefinition = {
  id: 'test-facility',
  name: 'Vehicle Test Facility',
  description:
    'Proving ground: acceleration strip, skid pad, slalom, surfaces, split-friction lane, articulation and a crash wall.',
  groundSize: 480,
  spawn,
  boxes: [
    ...buildBarriers(),
    ...buildArticulationBumps(),

    // Crash wall, straight ahead of the acceleration strip.
    { id: 'crash-wall', kind: 'crash-wall', position: [0, 1.25, 190], size: [26, 2.5, 1.2] },

    // Approach ramp beside the strip: raises toward +Z.
    { id: 'ramp', kind: 'ramp', position: [-20, 0.32, 46], size: [7, 0.4, 11], rotation: [-0.078, 0, 0] },
    // Low kerb edges of the skid pad entrance.
    { id: 'kerb-1', kind: 'kerb', position: [-44, 0.09, -14], size: [12, 0.18, 0.5] },
    { id: 'kerb-2', kind: 'kerb', position: [-44, 0.09, 22], size: [12, 0.18, 0.5] },

    // Service buildings.
    { id: 'hangar', kind: 'building', position: [76, 4.5, 36], size: [30, 9, 58] },
    { id: 'workshop', kind: 'building', position: [-82, 3.4, -34], size: [26, 6.8, 44] },
    { id: 'control-tower', kind: 'building', position: [43, 7, -44], size: [9, 14, 9] },
  ],
  cones: [
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `cone-${i}`,
      position: [7, 0.34, 2 + i * 6] as [number, number, number],
      height: 0.68,
      radius: 0.26,
    })),
    ...buildSlalomCones(),
  ],
  trees: buildTrees(),
  surfaces: [
    // West test field: loose and low-grip surfaces.
    { id: 'surface-gravel', surface: 'gravel', position: [-32, 72], size: [24, 26] },
    { id: 'surface-dirt', surface: 'dirt', position: [-32, 108], size: [24, 26] },
    { id: 'surface-mud', surface: 'mud', position: [-32, 144], size: [24, 26] },
    { id: 'surface-grass', surface: 'grass', position: [-64, 72], size: [24, 26] },
    { id: 'surface-sand', surface: 'sand', position: [-64, 108], size: [24, 26] },
    { id: 'surface-snow', surface: 'snow', position: [-64, 144], size: [24, 26] },

    // East test field: paved surfaces and the two extremes.
    { id: 'surface-wet', surface: 'asphalt-wet', position: [32, 72], size: [24, 26] },
    { id: 'surface-concrete', surface: 'concrete', position: [32, 108], size: [24, 26] },
    { id: 'surface-ice', surface: 'ice', position: [32, 144], size: [24, 26] },

    // Split-friction lane: dry asphalt on the left, ice on the right.
    { id: 'split-dry', surface: 'asphalt-dry', position: [26, 178], size: [12, 30] },
    { id: 'split-ice', surface: 'ice', position: [38, 178], size: [12, 30] },
  ],
  skidPad: { x: -46, z: 4, radius: 17 },
  accelerationStrip: { x: 0, fromZ: -22, toZ: 190, width: 8 },
  brakingZoneZ: [100, 110, 120, 130],
  splitFrictionLane: { centerX: 32, z: 178, halfWidth: 12, length: 30 },
};
