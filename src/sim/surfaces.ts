/**
 * Surface materials.
 *
 * Every drivable surface exposes physical properties consumed by the tire
 * solver. Grip is a multiplier on the tire compound's friction coefficient, so
 * the Magic Formula still shapes the slip curve and the combined-slip ellipse
 * still couples longitudinal and lateral demand. Nothing here is a speed
 * multiplier or a scripted behaviour change.
 */

export type SurfaceId =
  | 'asphalt-dry'
  | 'asphalt-wet'
  | 'concrete'
  | 'gravel'
  | 'dirt'
  | 'mud'
  | 'grass'
  | 'sand'
  | 'snow'
  | 'ice';

export interface SurfaceDefinition {
  id: SurfaceId;
  name: string;
  /** Multiplier on the compound's longitudinal friction coefficient. */
  gripLong: number;
  /** Multiplier on the compound's lateral friction coefficient. */
  gripLat: number;
  /** Rolling-resistance coefficient applied to the wheel load. */
  rollingResistance: number;
  /** 0..1 roughness indicator (used for resistance now, road profile later). */
  roughness: number;
  /** Base colour used by the renderer so visuals match the physics surface. */
  color: number;
}

export const SURFACES: Record<SurfaceId, SurfaceDefinition> = {
  'asphalt-dry': {
    id: 'asphalt-dry',
    name: 'Dry asphalt',
    gripLong: 1,
    gripLat: 1,
    rollingResistance: 0.014,
    roughness: 0.15,
    color: 0x4a5057,
  },
  'asphalt-wet': {
    id: 'asphalt-wet',
    name: 'Wet asphalt',
    gripLong: 0.74,
    gripLat: 0.66,
    rollingResistance: 0.02,
    roughness: 0.1,
    color: 0x363c44,
  },
  concrete: {
    id: 'concrete',
    name: 'Concrete',
    gripLong: 0.96,
    gripLat: 0.93,
    rollingResistance: 0.016,
    roughness: 0.2,
    color: 0x8a8d8c,
  },
  gravel: {
    id: 'gravel',
    name: 'Gravel',
    gripLong: 0.62,
    gripLat: 0.56,
    rollingResistance: 0.05,
    roughness: 0.75,
    color: 0x9a9084,
  },
  dirt: {
    id: 'dirt',
    name: 'Dirt',
    gripLong: 0.53,
    gripLat: 0.49,
    rollingResistance: 0.06,
    roughness: 0.65,
    color: 0x6b5943,
  },
  mud: {
    id: 'mud',
    name: 'Mud',
    gripLong: 0.36,
    gripLat: 0.3,
    rollingResistance: 0.12,
    roughness: 0.9,
    color: 0x4a3a2b,
  },
  grass: {
    id: 'grass',
    name: 'Grass',
    gripLong: 0.46,
    gripLat: 0.42,
    rollingResistance: 0.07,
    roughness: 0.5,
    color: 0x3f5f34,
  },
  sand: {
    id: 'sand',
    name: 'Sand',
    gripLong: 0.42,
    gripLat: 0.36,
    rollingResistance: 0.14,
    roughness: 0.85,
    color: 0xc2b088,
  },
  snow: {
    id: 'snow',
    name: 'Snow',
    gripLong: 0.28,
    gripLat: 0.24,
    rollingResistance: 0.05,
    roughness: 0.4,
    color: 0xd9dee2,
  },
  ice: {
    id: 'ice',
    name: 'Ice',
    gripLong: 0.11,
    gripLat: 0.08,
    rollingResistance: 0.008,
    roughness: 0.05,
    color: 0x9fb6c4,
  },
};

export const DEFAULT_SURFACE_ID: SurfaceId = 'asphalt-dry';

export interface SurfaceGrip {
  gripLong: number;
  gripLat: number;
  rollingResistance: number;
}

export function surfaceGrip(surface: SurfaceDefinition): SurfaceGrip {
  return {
    gripLong: surface.gripLong,
    gripLat: surface.gripLat,
    rollingResistance: surface.rollingResistance,
  };
}

export function isSurfaceId(value: string): value is SurfaceId {
  return Object.prototype.hasOwnProperty.call(SURFACES, value);
}
