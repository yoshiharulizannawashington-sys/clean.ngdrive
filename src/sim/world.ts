import RAPIER from '@dimforge/rapier3d-compat';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import { TEST_FACILITY } from '../../data/maps/test-facility';
import { DEFAULT_SURFACE_ID, isSurfaceId, type SurfaceId } from './surfaces';
import type { PropSnapshot } from './protocol';
import { quatFromEuler } from './math3';

/**
 * Static world plus light dynamic props, built from the shared facility data.
 *
 * Rapier is used exactly where it belongs: rigid-body collision, static world
 * geometry and props. It is *not* used as the vehicle model — the vehicle's
 * suspension, tires, engine and drivetrain are solved in this project.
 *
 * Every collider is tagged with a surface material at creation time. The tire
 * solver asks for the material under each contact patch through
 * `surfaceAt(colliderHandle)`, so the rendered surface and the physical surface
 * cannot drift apart.
 */
export interface SimWorld {
  world: World;
  step(dt: number): void;
  propSnapshots(): PropSnapshot[];
  bodyCount(): number;
  surfaceAt(colliderHandle: number): SurfaceId;
}

export interface TestWorldOptions {
  /** Force every collider onto one surface, for controlled physics tests. */
  surfaceOverride?: SurfaceId;
}

export function createTestWorld(options: TestWorldOptions = {}): SimWorld {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.numSolverIterations = 8;

  const facility = TEST_FACILITY;
  const surfaceByCollider = new Map<number, SurfaceId>();

  const addCollider = (desc: RAPIER.ColliderDesc, surface: SurfaceId): void => {
    const collider = world.createCollider(desc);
    surfaceByCollider.set(collider.handle, options.surfaceOverride ?? surface);
  };

  // Ground slab: top face at y = 0.
  addCollider(
    RAPIER.ColliderDesc.cuboid(facility.groundSize / 2, 0.5, facility.groundSize / 2)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.92)
      .setRestitution(0.02),
    DEFAULT_SURFACE_ID,
  );

  for (const box of facility.boxes) {
    const [sx, sy, sz] = box.size;
    const desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation(box.position[0], box.position[1], box.position[2])
      .setFriction(box.kind === 'ramp' ? 0.85 : 0.8)
      .setRestitution(0.05);
    if (box.rotation) {
      desc.setRotation(quatFromEuler(box.rotation[0], box.rotation[1], box.rotation[2]));
    }
    addCollider(desc, box.kind === 'ramp' ? 'concrete' : DEFAULT_SURFACE_ID);
  }

  // Surface patches: thin slabs whose top face sits 12 mm above the ground so a
  // downward suspension ray hits the patch, not the ground underneath it.
  for (const patch of facility.surfaces) {
    if (!isSurfaceId(patch.surface)) continue;
    addCollider(
      RAPIER.ColliderDesc.cuboid(patch.size[0] / 2, 0.006, patch.size[1] / 2)
        .setTranslation(patch.position[0], 0.006, patch.position[1])
        .setFriction(0.9)
        .setRestitution(0.01),
      patch.surface,
    );
  }

  const props: RigidBody[] = [];
  for (const cone of facility.cones) {
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(cone.position[0], cone.height / 2, cone.position[2])
        .setLinearDamping(0.15)
        .setAngularDamping(0.45)
        .setCcdEnabled(true),
    );
    const collider = world.createCollider(
      RAPIER.ColliderDesc.cone(cone.height / 2, cone.radius)
        .setMass(2.4)
        .setFriction(0.65)
        .setRestitution(0.08),
      body,
    );
    surfaceByCollider.set(collider.handle, 'concrete');
    props.push(body);
  }

  return {
    world,
    step(dt: number): void {
      world.timestep = dt;
      world.step();
    },
    propSnapshots(): PropSnapshot[] {
      return props.map((body) => {
        const t = body.translation();
        const r = body.rotation();
        return {
          position: [t.x, t.y, t.z],
          rotation: [r.x, r.y, r.z, r.w],
        };
      });
    },
    bodyCount(): number {
      return world.bodies.len();
    },
    surfaceAt(colliderHandle: number): SurfaceId {
      return surfaceByCollider.get(colliderHandle) ?? DEFAULT_SURFACE_ID;
    },
  };
}
