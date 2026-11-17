import RAPIER from '@dimforge/rapier3d-compat';
import type { RigidBody, World } from '@dimforge/rapier3d-compat';
import { TEST_FACILITY } from '../../data/maps/test-facility';
import type { PropSnapshot } from './protocol';
import { quatFromEuler } from './math3';

/**
 * Static world plus light dynamic props, built from the shared facility data.
 *
 * Rapier is used exactly where it belongs: rigid-body collision, static world
 * geometry and props. It is *not* used as the vehicle model — the vehicle's
 * suspension, tires, engine and drivetrain are solved in this project.
 */
export interface SimWorld {
  world: World;
  step(dt: number): void;
  propSnapshots(): PropSnapshot[];
  bodyCount(): number;
}

export function createTestWorld(): SimWorld {
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = 1 / 120;
  world.numSolverIterations = 8;

  const facility = TEST_FACILITY;

  // Ground slab: top face at y = 0.
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(facility.groundSize / 2, 0.5, facility.groundSize / 2)
      .setTranslation(0, -0.5, 0)
      .setFriction(0.92)
      .setRestitution(0.02),
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
    world.createCollider(desc);
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
    world.createCollider(
      RAPIER.ColliderDesc.cone(cone.height / 2, cone.radius)
        .setMass(2.4)
        .setFriction(0.65)
        .setRestitution(0.08),
      body,
    );
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
  };
}
