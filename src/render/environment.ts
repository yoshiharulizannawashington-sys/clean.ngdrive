import * as THREE from 'three';
import { TEST_FACILITY, type FacilityBoxKind } from '../../data/maps/test-facility';
import type { QualitySettings } from '../app/settings';
import type { FrameProp } from '../app/snapshot-buffer';

function asphaltTexture(anisotropy: number): THREE.Texture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');

  if (context) {
    context.fillStyle = '#4a5057';
    context.fillRect(0, 0, size, size);
    const image = context.getImageData(0, 0, size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 30;
      image.data[i] = Math.max(0, Math.min(255, image.data[i] + noise));
      image.data[i + 1] = Math.max(0, Math.min(255, image.data[i + 1] + noise));
      image.data[i + 2] = Math.max(0, Math.min(255, image.data[i + 2] + noise));
    }
    context.putImageData(image, 0, 0);
    for (let i = 0; i < 40; i += 1) {
      context.fillStyle = `rgba(210,215,220,${0.02 + Math.random() * 0.035})`;
      const radius = 2 + Math.random() * 12;
      context.beginPath();
      context.arc(Math.random() * size, Math.random() * size, radius, 0, Math.PI * 2);
      context.fill();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(90, 90);
  texture.anisotropy = anisotropy;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function hazardTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = '#d8d8d6';
    context.fillRect(0, 0, 128, 128);
    context.strokeStyle = '#c02a1d';
    context.lineWidth = 22;
    for (let i = -128; i < 256; i += 56) {
      context.beginPath();
      context.moveTo(i, 0);
      context.lineTo(i + 128, 128);
      context.stroke();
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(6, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function boxMaterial(kind: FacilityBoxKind, hazard: THREE.Texture): THREE.MeshStandardMaterial {
  switch (kind) {
    case 'crash-wall':
      return new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.85, metalness: 0.02 });
    case 'barrier':
      return new THREE.MeshStandardMaterial({ color: 0xc3c6c4, roughness: 0.95 });
    case 'ramp':
      return new THREE.MeshStandardMaterial({ color: 0x6f757a, roughness: 0.6, metalness: 0.35 });
    case 'building':
      return new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: 0.8, metalness: 0.1 });
    case 'kerb':
    default:
      return new THREE.MeshStandardMaterial({ color: 0xd5d7d4, roughness: 0.9 });
  }
}

/**
 * Static facility geometry plus the dynamic props whose transforms arrive from
 * the simulation worker. Geometry is generated from the same data that builds
 * the physics colliders.
 */
export class FacilityEnvironment {
  readonly group = new THREE.Group();

  private readonly coneGroups: THREE.Group[] = [];
  private readonly treeInstances: THREE.InstancedMesh;
  private readonly treeCount: number;
  private readonly sunDisc: THREE.Mesh;
  private readonly stone: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, quality: QualitySettings, maxAnisotropy: number) {
    const anisotropy = Math.min(quality.anisotropy, maxAnisotropy);
    this.group.name = 'test-facility';
    scene.add(this.group);

    const facility = TEST_FACILITY;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(facility.groundSize, facility.groundSize),
      new THREE.MeshStandardMaterial({ map: asphaltTexture(anisotropy), roughness: 0.96, metalness: 0.02 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    this.buildMarkings();

    const hazard = hazardTexture();
    for (const box of facility.boxes) {
      const material = boxMaterial(box.kind, hazard);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(box.size[0], box.size[1], box.size[2]), material);
      mesh.position.set(box.position[0], box.position[1], box.position[2]);
      if (box.rotation) mesh.rotation.set(box.rotation[0], box.rotation[1], box.rotation[2]);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }

    // Buildings get a darker roof slab for a bit of depth.
    for (const box of facility.boxes) {
      if (box.kind !== 'building') continue;
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(box.size[0] * 1.04, 0.35, box.size[2] * 1.04),
        new THREE.MeshStandardMaterial({ color: 0x4c5257, roughness: 0.85 }),
      );
      roof.position.set(box.position[0], box.position[1] + box.size[1] / 2 + 0.16, box.position[2]);
      roof.castShadow = true;
      this.group.add(roof);
    }

    // Cones: real dynamic bodies, so their transforms come from the worker.
    this.stone = new THREE.MeshStandardMaterial({ color: 0x9a9d9b, roughness: 0.9 });
    for (const cone of facility.cones) {
      const group = new THREE.Group();
      const base = new THREE.Mesh(
        new THREE.BoxGeometry(cone.radius * 3.2, 0.06, cone.radius * 3.2),
        new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.85 }),
      );
      base.position.y = -cone.height / 2 + 0.03;
      const body = new THREE.Mesh(
        new THREE.ConeGeometry(cone.radius, cone.height, 14),
        new THREE.MeshStandardMaterial({ color: 0xff5a12, roughness: 0.7 }),
      );
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(cone.radius * 0.66, cone.radius * 0.74, cone.height * 0.16, 14),
        new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }),
      );
      band.position.y = cone.height * 0.06;
      for (const mesh of [base, body, band]) {
        mesh.castShadow = true;
        group.add(mesh);
      }
      group.position.set(cone.position[0], cone.height / 2, cone.position[2]);
      this.group.add(group);
      this.coneGroups.push(group);
    }

    // Background trees.
    this.treeCount = Math.min(quality.treeCount, facility.trees.length);
    const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 5, 6);
    const foliageGeometry = new THREE.ConeGeometry(2.4, 7, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95 });
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2f5038, roughness: 0.95 });
    const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, facility.trees.length);
    this.treeInstances = new THREE.InstancedMesh(foliageGeometry, foliageMaterial, facility.trees.length);
    trunks.castShadow = true;
    this.treeInstances.castShadow = true;
    const matrix = new THREE.Matrix4();
    facility.trees.forEach((tree, index) => {
      const scale = tree.scale;
      matrix.compose(
        new THREE.Vector3(tree.position[0], 2.4 * scale, tree.position[2]),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      );
      trunks.setMatrixAt(index, matrix);
      matrix.compose(
        new THREE.Vector3(tree.position[0], 6.4 * scale, tree.position[2]),
        new THREE.Quaternion(),
        new THREE.Vector3(scale, scale, scale),
      );
      this.treeInstances.setMatrixAt(index, matrix);
    });
    trunks.count = this.treeCount;
    this.treeInstances.count = this.treeCount;
    this.group.add(trunks, this.treeInstances);

    this.buildFence(facility.groundSize / 2 - 12);
    this.sunDisc = this.buildSunDisc();
  }

  private buildMarkings(): void {
    const facility = TEST_FACILITY;
    const white = new THREE.MeshStandardMaterial({ color: 0xdfe4e6, roughness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.75 });
    const strip = facility.accelerationStrip;
    const group = new THREE.Group();

    const runLength = strip.toZ - strip.fromZ;
    for (const side of [-1, 1]) {
      const line = new THREE.Mesh(new THREE.PlaneGeometry(0.16, runLength), white);
      line.rotation.x = -Math.PI / 2;
      line.position.set(strip.x + side * (strip.width / 2), 0.015, strip.fromZ + runLength / 2);
      group.add(line);
    }

    const dashGeometry = new THREE.PlaneGeometry(0.14, 2.4);
    const dashCount = Math.floor(runLength / 5);
    const dashes = new THREE.InstancedMesh(dashGeometry, white, dashCount);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < dashCount; i += 1) {
      matrix.compose(
        new THREE.Vector3(strip.x, 0.015, strip.fromZ + 2 + i * 5),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
        new THREE.Vector3(1, 1, 1),
      );
      dashes.setMatrixAt(i, matrix);
    }
    group.add(dashes);

    const startLine = new THREE.Mesh(new THREE.PlaneGeometry(strip.width, 0.55), white);
    startLine.rotation.x = -Math.PI / 2;
    startLine.position.set(strip.x, 0.016, strip.fromZ);
    group.add(startLine);

    for (const z of facility.brakingZoneZ) {
      const stripe = new THREE.Mesh(new THREE.PlaneGeometry(strip.width, 0.42), accent);
      stripe.rotation.x = -Math.PI / 2;
      stripe.position.set(strip.x, 0.016, z);
      group.add(stripe);
    }

    const skid = new THREE.Mesh(
      new THREE.RingGeometry(facility.skidPad.radius - 0.14, facility.skidPad.radius + 0.14, 96),
      white,
    );
    skid.rotation.x = -Math.PI / 2;
    skid.position.set(facility.skidPad.x, 0.015, facility.skidPad.z);
    group.add(skid);

    // Spawn pad outline.
    const padSize = 6.4;
    for (const [x, z, w, d] of [
      [0, -padSize / 2, padSize, 0.14],
      [0, padSize / 2, padSize, 0.14],
      [-padSize / 2, 0, 0.14, padSize],
      [padSize / 2, 0, 0.14, padSize],
    ] as const) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(w, d), accent);
      edge.rotation.x = -Math.PI / 2;
      edge.position.set(x, 0.016, facility.spawn.position[2] + z);
      group.add(edge);
    }

    for (const child of group.children) {
      child.receiveShadow = true;
    }
    this.group.add(group);
  }

  private buildFence(halfSize: number): void {
    const postGeometry = new THREE.BoxGeometry(0.16, 3, 0.16);
    const posts = new THREE.InstancedMesh(
      postGeometry,
      new THREE.MeshStandardMaterial({ color: 0x5c646b, roughness: 0.8, metalness: 0.3 }),
      120,
    );
    const matrix = new THREE.Matrix4();
    let index = 0;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 30; i += 1) {
        const offset = -halfSize + (i / 29) * halfSize * 2;
        matrix.setPosition(side * halfSize, 1.5, offset);
        posts.setMatrixAt(index, matrix);
        index += 1;
        matrix.setPosition(offset, 1.5, side * halfSize);
        posts.setMatrixAt(index, matrix);
        index += 1;
      }
    }
    posts.count = index;
    this.group.add(posts);

    for (const side of [-1, 1]) {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.08, halfSize * 2),
        new THREE.MeshStandardMaterial({ color: 0x6a737a, roughness: 0.7, metalness: 0.4 }),
      );
      rail.position.set(side * halfSize, 2.6, 0);
      const crossRail = rail.clone();
      crossRail.rotation.y = Math.PI / 2;
      crossRail.position.set(0, 2.6, side * halfSize);
      this.group.add(rail, crossRail);
    }
  }

  private buildSunDisc(): THREE.Mesh {
    const disc = new THREE.Mesh(
      new THREE.SphereGeometry(14, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xfff6df, fog: false }),
    );
    disc.position.set(340, 420, 210);
    this.group.add(disc);
    return disc;
  }

  /** Apply prop transforms from the latest simulated frame. */
  updateProps(props: FrameProp[]): void {
    for (let i = 0; i < this.coneGroups.length && i < props.length; i += 1) {
      const group = this.coneGroups[i];
      group.position.copy(props[i].position);
      group.quaternion.copy(props[i].quaternion);
    }
  }

  setQuality(quality: QualitySettings): void {
    this.treeInstances.count = Math.min(quality.treeCount, this.treeCount);
  }

  update(dt: number): void {
    // Subtle sun drift keeps the scene from feeling frozen.
    this.sunDisc.position.x = 340 + Math.sin(dt * 0.01) * 2;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        const material = object.material;
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
        else material.dispose();
      }
    });
    this.stone.dispose();
  }
}
