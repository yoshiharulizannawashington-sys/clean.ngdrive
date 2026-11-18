import * as THREE from 'three';

export interface GeometryInstance {
  geometry: THREE.BufferGeometry;
  /** Optional world/local transform baked into the merged geometry. */
  matrix?: THREE.Matrix4;
}

/**
 * Merge several geometries with baked transforms into one non-indexed
 * BufferGeometry (position, normal, uv).
 *
 * Used to collapse static facility geometry and repeated wheel parts into a
 * single draw call each. The input geometries are left untouched.
 */
export function mergeStaticGeometry(instances: GeometryInstance[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  for (const { geometry, matrix } of instances) {
    const cloned = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    if (matrix) cloned.applyMatrix4(matrix);

    const position = cloned.getAttribute('position');
    const normal = cloned.getAttribute('normal');
    const uv = cloned.getAttribute('uv');

    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      if (normal) normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
      if (uv) uvs.push(uv.getX(i), uv.getY(i));
    }

    cloned.dispose();
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  } else {
    merged.computeVertexNormals();
  }
  if (uvs.length === (positions.length / 3) * 2) {
    merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  }
  merged.computeBoundingSphere();
  return merged;
}
