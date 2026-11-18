import * as THREE from 'three';
import { TEST_FACILITY, type FacilityBoxKind } from '../../data/maps/test-facility';
import { SURFACES } from '../sim/surfaces';
import type { QualitySettings } from '../app/settings';
import type { FrameProp } from '../app/snapshot-buffer';
import { mergeStaticGeometry, type GeometryInstance } from './geometry';

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
  texture.repeat.set(120, 120);
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
 * the physics colliders, and surface patches are coloured from the same material
 * definitions the tire solver reads.
 *
 * Static boxes and road markings are merged per material, and the cones are
 * drawn with instancing, which removes several hundred draw calls' worth of
 * per-object submission on weak GPUs.
 */
export class FacilityEnvironment {
  readonly group = new THREE.Group();

  private readonly coneBase: THREE.InstancedMesh;
  private readonly coneBody: THREE.InstancedMesh;
  private readonly coneBand: THREE.InstancedMesh;
  private readonly coneCount: number;
  private readonly coneLocalBase: THREE.Matrix4;
  private readonly coneLocalBand: THREE.Matrix4;
  private readonly treeInstances: THREE.InstancedMesh;
  private readonly treeCount: number;
  private readonly sunDisc: THREE.Mesh;
  private readonly materials: THREE.Material[] = [];
  private readonly coneMatrix = new THREE.Matrix4();
  private readonly propMatrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene, quality: QualitySettings, maxAnisotropy: number) {
    const anisotropy = Math.min(quality.anisotropy, maxAnisotropy);
    this.group.name = 'test-facility';
    scene.add(this.group);

    const facility = TEST_FACILITY;
    const asphalt = asphaltTexture(anisotropy);
    const asphaltMaterial = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.96, metalness: 0.02 });
    this.materials.push(asphaltMaterial);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(facility.groundSize, facility.groundSize), asphaltMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    this.buildSurfacePatches();

    this.buildMarkings();

    const hazard = hazardTexture();

    // Merge static boxes by material so each material is one draw call.
    const byMaterial = new Map<THREE.Material, GeometryInstance[]>();
    for (const box of facility.boxes) {
      const material = boxMaterial(box.kind, hazard);
      this.materials.push(material);
      const matrix = new THREE.Matrix4();
      const quaternion = new THREE.Quaternion();
      if (box.rotation) quaternion.setFromEuler(new THREE.Euler(box.rotation[0], box.rotation[1], box.rotation[2]));
      matrix.compose(
        new THREE.Vector3(box.position[0], box.position[1], box.position[2]),
        quaternion,
        new THREE.Vector3(1, 1, 1),
      );
      const entry = byMaterial.get(material) ?? [];
      entry.push({ geometry: new THREE.BoxGeometry(box.size[0], box.size[1], box.size[2]), matrix });
      byMaterial.set(material, entry);
    }

    // Buildings get a darker roof slab, merged separately.
    const roofInstances: GeometryInstance[] = [];
    for (const box of facility.boxes) {
      if (box.kind !== 'building') continue;
      const matrix = new THREE.Matrix4().makeTranslation(
        box.position[0],
        box.position[1] + box.size[1] / 2 + 0.16,
        box.position[2],
      );
      roofInstances.push({
        geometry: new THREE.BoxGeometry(box.size[0] * 1.04, 0.35, box.size[2] * 1.04),
        matrix,
      });
    }
    if (roofInstances.length > 0) {
      const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x4c5257, roughness: 0.85 });
      this.materials.push(roofMaterial);
      this.addMerged(roofInstances, roofMaterial);
    }

    for (const [material, instances] of byMaterial) {
      this.addMerged(instances, material);
    }

    // Cones: three instanced meshes for the eight-plus dynamic props.
    const sample = facility.cones[0];
    const baseGeometry = new THREE.BoxGeometry(sample.radius * 3.2, 0.06, sample.radius * 3.2);
    const bodyGeometry = new THREE.ConeGeometry(sample.radius, sample.height, 14);
    const bandGeometry = new THREE.CylinderGeometry(
      sample.radius * 0.66,
      sample.radius * 0.74,
      sample.height * 0.16,
      14,
    );
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x222426, roughness: 0.85 });
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff5a12, roughness: 0.7 });
    const bandMaterial = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 });
    this.materials.push(baseMaterial, bodyMaterial, bandMaterial);
    this.coneCount = facility.cones.length;

    this.coneBase = new THREE.InstancedMesh(baseGeometry, baseMaterial, this.coneCount);
    this.coneBody = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, this.coneCount);
    this.coneBand = new THREE.InstancedMesh(bandGeometry, bandMaterial, this.coneCount);
    for (const mesh of [this.coneBase, this.coneBody, this.coneBand]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
    this.coneLocalBase = new THREE.Matrix4().makeTranslation(0, -sample.height / 2 + 0.03, 0);
    this.coneLocalBand = new THREE.Matrix4().makeTranslation(0, sample.height * 0.06, 0);

    // Background trees.
    this.treeCount = Math.min(quality.treeCount, facility.trees.length);
    const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 5, 6);
    const foliageGeometry = new THREE.ConeGeometry(2.4, 7, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 0.95 });
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x2f5038, roughness: 0.95 });
    this.materials.push(trunkMaterial, foliageMaterial);
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
    this.updateProps([]);
  }

  private addMerged(instances: GeometryInstance[], material: THREE.Material): void {
    if (instances.length === 0) return;
    const merged = mergeStaticGeometry(instances);
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** Colour-coded surface sections: the physics reads the same definitions. */
  private buildSurfacePatches(): void {
    for (const patch of TEST_FACILITY.surfaces) {
      const surface = SURFACES[patch.surface];
      const material = new THREE.MeshStandardMaterial({
        color: surface.color,
        roughness: surface.id === 'ice' ? 0.16 : surface.id === 'asphalt-wet' ? 0.42 : 0.95,
        metalness: surface.id === 'ice' ? 0.15 : 0.02,
        transparent: false,
      });
      this.materials.push(material);
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(patch.size[0], patch.size[1]), material);
      mesh.rotation.x = -Math.PI / 2;
      // Slightly above the ground plane so it renders without z-fighting; the
      // collider sits at the same height so the tire raycast agrees.
      mesh.position.set(patch.position[0], 0.013, patch.position[1]);
      mesh.receiveShadow = true;
      this.group.add(mesh);
    }
  }

  private buildMarkings(): void {
    const facility = TEST_FACILITY;
    const white = new THREE.MeshStandardMaterial({ color: 0xdfe4e6, roughness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.75 });
    this.materials.push(white, accent);
    const whiteParts: GeometryInstance[] = [];
    const accentParts: GeometryInstance[] = [];
    const strip = facility.accelerationStrip;
    const flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    const plane = (width: number, depth: number, x: number, y: number, z: number, target: GeometryInstance[]): void => {
      target.push({
        geometry: new THREE.PlaneGeometry(width, depth),
        matrix: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), flat, new THREE.Vector3(1, 1, 1)),
      });
    };

    const runLength = strip.toZ - strip.fromZ;
    for (const side of [-1, 1]) {
      plane(0.16, runLength, strip.x + side * (strip.width / 2), 0.015, strip.fromZ + runLength / 2, whiteParts);
    }

    const dashCount = Math.floor(runLength / 5);
    for (let i = 0; i < dashCount; i += 1) {
      plane(0.14, 2.4, strip.x, 0.015, strip.fromZ + 2 + i * 5, whiteParts);
    }

    plane(strip.width, 0.55, strip.x, 0.016, strip.fromZ, whiteParts);

    for (const z of facility.brakingZoneZ) {
      plane(strip.width, 0.42, strip.x, 0.016, z, accentParts);
    }

    // Skid pad: segmented ring merged as one geometry.
    const ringSegments = 96;
    const innerRadius = facility.skidPad.radius - 0.14;
    const outerRadius = facility.skidPad.radius + 0.14;
    for (let i = 0; i < ringSegments; i += 1) {
      const a0 = (i / ringSegments) * Math.PI * 2;
      const a1 = ((i + 1) / ringSegments) * Math.PI * 2;
      const geometry = new THREE.BufferGeometry();
      const mid = (a0 + a1) / 2;
      const positions = new Float32Array([
        Math.cos(a0) * innerRadius, 0, Math.sin(a0) * innerRadius,
        Math.cos(a1) * innerRadius, 0, Math.sin(a1) * innerRadius,
        Math.cos(a1) * outerRadius, 0, Math.sin(a1) * outerRadius,
        Math.cos(a0) * innerRadius, 0, Math.sin(a0) * innerRadius,
        Math.cos(a1) * outerRadius, 0, Math.sin(a1) * outerRadius,
        Math.cos(a0) * outerRadius, 0, Math.sin(a0) * outerRadius,
      ]);
      geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geometry.computeVertexNormals();
      whiteParts.push({
        geometry,
        matrix: new THREE.Matrix4().makeTranslation(
          facility.skidPad.x + Math.cos(mid) * 0,
          0.015,
          facility.skidPad.z,
        ),
      });
    }

    // Spawn pad outline.
    const padSize = 6.4;
    for (const [x, z, w, d] of [
      [0, -padSize / 2, padSize, 0.14],
      [0, padSize / 2, padSize, 0.14],
      [-padSize / 2, 0, 0.14, padSize],
      [padSize / 2, 0, 0.14, padSize],
    ] as const) {
      plane(w, d, x, 0.016, facility.spawn.position[2] + z, accentParts);
    }

    // Split-friction lane divider.
    plane(
      0.18,
      facility.splitFrictionLane.length,
      facility.splitFrictionLane.centerX,
      0.02,
      facility.splitFrictionLane.z,
      whiteParts,
    );

    this.addMerged([...whiteParts], white);
    this.addMerged([...accentParts], accent);
    whiteParts.forEach((part) => part.geometry.dispose());
    accentParts.forEach((part) => part.geometry.dispose());
  }

  private buildFence(halfSize: number): void {
    const postGeometry = new THREE.BoxGeometry(0.16, 3, 0.16);
    const postMaterial = new THREE.MeshStandardMaterial({ color: 0x5c646b, roughness: 0.8, metalness: 0.3 });
    this.materials.push(postMaterial);
    const posts = new THREE.InstancedMesh(postGeometry, postMaterial, 120);
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

    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x6a737a, roughness: 0.7, metalness: 0.4 });
    this.materials.push(railMaterial);
    const rails: GeometryInstance[] = [];
    for (const side of [-1, 1]) {
      rails.push({
        geometry: new THREE.BoxGeometry(0.06, 0.08, halfSize * 2),
        matrix: new THREE.Matrix4().makeTranslation(side * halfSize, 2.6, 0),
      });
      rails.push({
        geometry: new THREE.BoxGeometry(0.06, 0.08, halfSize * 2),
        matrix: new THREE.Matrix4()
          .makeRotationY(Math.PI / 2)
          .setPosition(0, 2.6, side * halfSize),
      });
    }
    const mergedRails = mergeStaticGeometry(rails);
    rails.forEach((rail) => rail.geometry.dispose());
    this.group.add(new THREE.Mesh(mergedRails, railMaterial));
  }

  private buildSunDisc(): THREE.Mesh {
    const material = new THREE.MeshBasicMaterial({ color: 0xfff6df, fog: false });
    this.materials.push(material);
    const disc = new THREE.Mesh(new THREE.SphereGeometry(14, 16, 16), material);
    disc.position.set(340, 420, 210);
    this.group.add(disc);
    return disc;
  }

  /** Apply prop transforms from the latest simulated frame. */
  updateProps(props: FrameProp[]): void {
    for (let i = 0; i < this.coneCount; i += 1) {
      const prop = props[i];
      if (prop) {
        this.propMatrix.compose(prop.position, prop.quaternion, new THREE.Vector3(1, 1, 1));
      } else {
        const cone = TEST_FACILITY.cones[i];
        this.propMatrix.makeTranslation(cone.position[0], cone.height / 2, cone.position[2]);
      }
      this.coneMatrix.multiplyMatrices(this.propMatrix, this.coneLocalBase);
      this.coneBase.setMatrixAt(i, this.coneMatrix);
      this.coneBody.setMatrixAt(i, this.propMatrix);
      this.coneMatrix.multiplyMatrices(this.propMatrix, this.coneLocalBand);
      this.coneBand.setMatrixAt(i, this.coneMatrix);
    }
    this.coneBase.instanceMatrix.needsUpdate = true;
    this.coneBody.instanceMatrix.needsUpdate = true;
    this.coneBand.instanceMatrix.needsUpdate = true;
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
    this.materials.forEach((material) => material.dispose());
  }
}
