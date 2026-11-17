import * as THREE from 'three';
import type { VehicleConfig } from '../sim/vehicle/types';
import type { InterpolatedFrame } from '../app/snapshot-buffer';

interface WheelView {
  pivot: THREE.Group;
  spin: THREE.Group;
  arm: THREE.Mesh;
  localX: number;
  localZ: number;
}

function extrudeProfile(profile: THREE.Shape, width: number, bevel = 0.05): THREE.BufferGeometry {
  const geometry = new THREE.ExtrudeGeometry(profile, {
    depth: Math.max(0.05, width - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 12,
  });
  // The profile is authored in (z, y); extrude it across X and centre it.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate((width - bevel * 2) / 2, 0, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Procedural sedan. Original geometry generated in code, so there are no
 * third-party asset licences involved.
 *
 * The visual model is driven entirely by worker state: chassis transform,
 * per-wheel steering, wheel rotation, suspension compression and brake lights.
 */
export class VehicleView {
  readonly root = new THREE.Group();

  private readonly config: VehicleConfig;
  private readonly wheels: WheelView[] = [];
  private readonly brakeMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly bodyGroup = new THREE.Group();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);

  constructor(config: VehicleConfig) {
    this.config = config;
    this.root.add(this.bodyGroup);
    this.buildMaterials();
    this.buildBody();
    this.buildInterior();
    this.buildWheels();
  }

  private bodyMaterial!: THREE.MeshStandardMaterial;
  private glassMaterial!: THREE.MeshStandardMaterial;
  private trimMaterial!: THREE.MeshStandardMaterial;
  private chromeMaterial!: THREE.MeshStandardMaterial;
  private rubberMaterial!: THREE.MeshStandardMaterial;
  private rimMaterial!: THREE.MeshStandardMaterial;
  private headlightMaterial!: THREE.MeshStandardMaterial;
  private interiorMaterial!: THREE.MeshStandardMaterial;

  private buildMaterials(): void {
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: this.config.color,
      metalness: 0.6,
      roughness: 0.28,
    });
    this.glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x101c25,
      metalness: 0.15,
      roughness: 0.06,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });
    this.trimMaterial = new THREE.MeshStandardMaterial({ color: 0x15181b, metalness: 0.35, roughness: 0.62 });
    this.chromeMaterial = new THREE.MeshStandardMaterial({ color: 0xc9ced4, metalness: 1, roughness: 0.18 });
    this.rubberMaterial = new THREE.MeshStandardMaterial({ color: 0x0d0e10, metalness: 0.05, roughness: 0.95 });
    this.rimMaterial = new THREE.MeshStandardMaterial({ color: 0x9fa7af, metalness: 0.95, roughness: 0.26 });
    this.headlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xfff4dc,
      emissive: 0xfff1cf,
      emissiveIntensity: 1.5,
      roughness: 0.25,
    });
    this.interiorMaterial = new THREE.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.85 });
  }

  private addMesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    rotation?: [number, number, number],
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    if (rotation) mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildBody(): void {
    const { chassis } = this.config;
    const halfTrack = chassis.track / 2;

    // Lower body silhouette.
    const lower = new THREE.Shape();
    lower.moveTo(-2.24, -0.36);
    lower.lineTo(-2.31, -0.02);
    lower.quadraticCurveTo(-2.29, 0.2, -2.04, 0.26);
    lower.lineTo(-1.02, 0.31);
    lower.lineTo(0.5, 0.34);
    lower.quadraticCurveTo(1.45, 0.33, 1.95, 0.2);
    lower.quadraticCurveTo(2.17, 0.13, 2.16, -0.06);
    lower.quadraticCurveTo(2.14, -0.28, 1.94, -0.36);
    lower.lineTo(-2.24, -0.36);
    this.addMesh(this.bodyGroup, extrudeProfile(lower, 1.76), this.bodyMaterial, [0, 0, 0]);

    // Cabin / greenhouse.
    const cabin = new THREE.Shape();
    cabin.moveTo(-1.72, 0.24);
    cabin.lineTo(-1.16, 0.74);
    cabin.quadraticCurveTo(-0.9, 0.8, -0.55, 0.8);
    cabin.lineTo(0.22, 0.79);
    cabin.lineTo(0.86, 0.3);
    cabin.lineTo(-1.72, 0.24);
    this.addMesh(this.bodyGroup, extrudeProfile(cabin, 1.56, 0.04), this.bodyMaterial, [0, 0, 0]);

    // Glazing.
    this.addMesh(
      this.bodyGroup,
      new THREE.PlaneGeometry(1.4, 0.8),
      this.glassMaterial,
      [0, 0.545, 0.55],
      [-0.67, 0, 0],
    );
    this.addMesh(
      this.bodyGroup,
      new THREE.PlaneGeometry(1.3, 0.76),
      this.glassMaterial,
      [0, 0.49, -1.44],
      [-2.42, 0, 0],
    );

    const sideGlassShape = new THREE.Shape();
    sideGlassShape.moveTo(-1.58, 0.3);
    sideGlassShape.lineTo(-1.2, 0.71);
    sideGlassShape.lineTo(0.16, 0.73);
    sideGlassShape.lineTo(0.78, 0.32);
    sideGlassShape.lineTo(-1.58, 0.3);
    const sideGlassGeometry = new THREE.ShapeGeometry(sideGlassShape);
    sideGlassGeometry.rotateY(-Math.PI / 2);
    this.addMesh(this.bodyGroup, sideGlassGeometry, this.glassMaterial, [0.782, 0, 0]);
    this.addMesh(this.bodyGroup, sideGlassGeometry.clone(), this.glassMaterial, [-0.782, 0, 0]);

    // Pillars.
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.075, 0.52, 0.1), this.trimMaterial, [0.77, 0.5, -0.55]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.075, 0.52, 0.1), this.trimMaterial, [-0.77, 0.5, -0.55]);

    // Wheel arches.
    for (const side of [-1, 1]) {
      for (const axleZ of [chassis.frontAxleZ, chassis.rearAxleZ]) {
        const arch = new THREE.Mesh(
          new THREE.TorusGeometry(0.46, 0.045, 6, 16, Math.PI),
          this.bodyMaterial,
        );
        arch.position.set(side * 0.87, -0.23, axleZ);
        arch.rotation.y = Math.PI / 2;
        arch.castShadow = true;
        this.bodyGroup.add(arch);
      }
    }

    // Bumpers, skirts and underbody.
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(1.7, 0.2, 0.3), this.trimMaterial, [0, -0.22, 2.14]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(1.7, 0.2, 0.3), this.trimMaterial, [0, -0.22, -2.2]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.06, 0.11, 2.3), this.trimMaterial, [0.87, -0.36, 0]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.06, 0.11, 2.3), this.trimMaterial, [-0.87, -0.36, 0]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(1.5, 0.08, 3.7), this.trimMaterial, [0, -0.39, 0]);

    // Grille.
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(1.0, 0.17, 0.07), this.trimMaterial, [0, 0.0, 2.2]);
    for (let i = 0; i < 3; i += 1) {
      this.addMesh(
        this.bodyGroup,
        new THREE.BoxGeometry(0.94, 0.018, 0.02),
        this.chromeMaterial,
        [0, -0.05 + i * 0.05, 2.235],
      );
    }

    // Head- and tail-lights.
    for (const side of [-1, 1]) {
      this.addMesh(
        this.bodyGroup,
        new THREE.BoxGeometry(0.38, 0.11, 0.09),
        this.headlightMaterial,
        [side * 0.56, 0.12, 2.15],
        [0, side * 0.08, 0],
      );
      this.addMesh(
        this.bodyGroup,
        new THREE.BoxGeometry(0.16, 0.05, 0.06),
        new THREE.MeshStandardMaterial({ color: 0xffa23a, emissive: 0xff8a1a, emissiveIntensity: 0.6 }),
        [side * 0.78, 0.06, 2.11],
      );

      const brake = new THREE.MeshStandardMaterial({
        color: 0x4a0c0c,
        emissive: 0xff1d1d,
        emissiveIntensity: 0.35,
        roughness: 0.4,
      });
      this.brakeMaterials.push(brake);
      this.addMesh(
        this.bodyGroup,
        new THREE.BoxGeometry(0.4, 0.1, 0.07),
        brake,
        [side * 0.56, 0.11, -2.25],
      );
    }

    // Mirrors.
    for (const side of [-1, 1]) {
      this.addMesh(
        this.bodyGroup,
        new THREE.BoxGeometry(0.14, 0.09, 0.07),
        this.bodyMaterial,
        [side * 0.94, 0.42, 0.42],
      );
      this.addMesh(
        this.bodyGroup,
        new THREE.BoxGeometry(0.1, 0.03, 0.03),
        this.trimMaterial,
        [side * 0.86, 0.4, 0.42],
      );
    }

    // Door handles and exhausts.
    for (const side of [-1, 1]) {
      this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.02, 0.035, 0.16), this.chromeMaterial, [side * 0.885, 0.06, 0.05]);
      this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.02, 0.035, 0.16), this.chromeMaterial, [side * 0.885, 0.06, -0.95]);
    }
    for (const side of [-1, 1]) {
      const exhaust = new THREE.Mesh(
        new THREE.CylinderGeometry(0.055, 0.055, 0.18, 12),
        this.chromeMaterial,
      );
      exhaust.rotation.x = Math.PI / 2;
      exhaust.position.set(side * 0.55, -0.32, -2.28);
      this.bodyGroup.add(exhaust);
    }

    // Plates.
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.42, 0.11, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8e8e2 }), [0, -0.24, 2.29]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.42, 0.11, 0.02), new THREE.MeshStandardMaterial({ color: 0xe8e8e2 }), [0, -0.24, -2.35]);

    // The visual wheels sit slightly inside the body sides.
    void halfTrack;
  }

  private buildInterior(): void {
    // Dashboard.
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(1.42, 0.16, 0.42), this.interiorMaterial, [0, 0.3, 0.62]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.42, 0.12, 0.06), this.trimMaterial, [-0.34, 0.36, 0.7]);

    // Steering wheel and column (left-hand drive).
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.024, 8, 24), this.interiorMaterial);
    wheel.rotation.x = -1.15;
    wheel.position.set(-0.34, 0.36, 0.4);
    wheel.castShadow = true;
    this.bodyGroup.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), this.trimMaterial);
    hub.rotation.x = Math.PI / 2 - 1.15;
    hub.position.set(-0.34, 0.36, 0.4);
    this.bodyGroup.add(hub);

    // Seats.
    for (const x of [-0.34, 0.34]) {
      this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.46, 0.12, 0.48), this.interiorMaterial, [x, 0.24, -0.42]);
      this.addMesh(
        this.bodyGroup,
        new THREE.BoxGeometry(0.44, 0.5, 0.12),
        this.interiorMaterial,
        [x, 0.42, -0.66],
        [0.12, 0, 0],
      );
    }
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.9, 0.14, 0.4), this.interiorMaterial, [0, 0.24, -1.35]);
    this.addMesh(this.bodyGroup, new THREE.BoxGeometry(0.2, 0.18, 0.6), this.trimMaterial, [0, 0.28, -0.1]);
  }

  private buildWheels(): void {
    const { chassis, suspension } = this.config;
    const halfTrack = chassis.track / 2;
    const layout = [
      { x: -halfTrack, z: chassis.frontAxleZ, front: true, config: this.config.wheelFront },
      { x: halfTrack, z: chassis.frontAxleZ, front: true, config: this.config.wheelFront },
      { x: -halfTrack, z: chassis.rearAxleZ, front: false, config: this.config.wheelRear },
      { x: halfTrack, z: chassis.rearAxleZ, front: false, config: this.config.wheelRear },
    ];

    for (const entry of layout) {
      const pivot = new THREE.Group();
      pivot.position.set(entry.x, chassis.mountHeight - suspension.restLength, entry.z);

      const spin = new THREE.Group();
      const radius = entry.config.radius;
      const width = entry.config.width;

      const tireGeometry = new THREE.CylinderGeometry(radius, radius, width, 30);
      tireGeometry.rotateZ(Math.PI / 2);
      const tire = new THREE.Mesh(tireGeometry, this.rubberMaterial);
      tire.castShadow = true;
      spin.add(tire);

      const rimGeometry = new THREE.CylinderGeometry(radius * 0.64, radius * 0.64, width * 0.94, 24);
      rimGeometry.rotateZ(Math.PI / 2);
      const rim = new THREE.Mesh(rimGeometry, this.rimMaterial);
      rim.castShadow = true;
      spin.add(rim);

      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.54, radius * 0.54, 0.022, 20),
        new THREE.MeshStandardMaterial({ color: 0x3c4045, metalness: 0.9, roughness: 0.45 }),
      );
      disc.rotation.z = Math.PI / 2;
      disc.position.x = width * 0.1;
      spin.add(disc);

      for (let i = 0; i < 5; i += 1) {
        for (const face of [-1, 1]) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.045, radius * 1.18, 0.075), this.rimMaterial);
          spoke.rotation.x = (i / 5) * Math.PI * 2 + 0.3;
          spoke.position.x = face * width * 0.31;
          spin.add(spoke);
        }
      }

      const cap = new THREE.Mesh(
        new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, width * 1.02, 12),
        this.chromeMaterial,
      );
      cap.rotation.z = Math.PI / 2;
      spin.add(cap);

      pivot.add(spin);

      // Caliper stays fixed to the upright while the wheel spins.
      const caliper = new THREE.Mesh(
        new THREE.BoxGeometry(0.055, 0.17, 0.09),
        new THREE.MeshStandardMaterial({ color: 0xb4521c, metalness: 0.4, roughness: 0.5 }),
      );
      caliper.position.set(width * 0.18, radius * 0.52, 0);
      pivot.add(caliper);

      this.root.add(pivot);

      // Simple lower control arm between body mount and wheel centre.
      const armGeometry = new THREE.CylinderGeometry(0.032, 0.026, 1, 6);
      armGeometry.translate(0, 0.5, 0);
      const arm = new THREE.Mesh(armGeometry, this.trimMaterial);
      arm.castShadow = true;
      this.root.add(arm);

      this.wheels.push({ pivot, spin, arm, localX: entry.x, localZ: entry.z });
    }
  }

  update(frame: InterpolatedFrame): void {
    this.root.position.copy(frame.position);
    this.root.quaternion.copy(frame.quaternion);

    const mountY = this.config.chassis.mountHeight;
    const restLength = this.config.suspension.restLength;

    frame.wheels.forEach((wheel, index) => {
      const view = this.wheels[index];
      if (!view) return;

      const wheelY = mountY - (restLength - wheel.compression);
      view.pivot.position.set(view.localX, wheelY, view.localZ);
      view.pivot.rotation.y = wheel.steer;
      view.spin.rotation.x = -wheel.spin;

      // Arm from mount to the wheel centre.
      const start = new THREE.Vector3(view.localX, mountY, view.localZ);
      const end = new THREE.Vector3(view.localX, wheelY, view.localZ);
      const direction = end.clone().sub(start);
      const length = direction.length();
      view.arm.position.copy(start);
      if (length > 1e-4) {
        view.arm.quaternion.setFromUnitVectors(this.upAxis, direction.normalize());
        view.arm.scale.set(1, length, 1);
      }
    });

    const braking = frame.brake > 0.05;
    for (const material of this.brakeMaterials) {
      material.emissiveIntensity = braking ? 2.2 : 0.35;
    }
  }
}
