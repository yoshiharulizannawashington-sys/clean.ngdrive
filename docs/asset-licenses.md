# Asset and dependency licences

## Project assets

No third-party art, audio or model assets are included in this repository.

| Asset | Source | Licence |
| --- | --- | --- |
| Vehicle geometry and materials | Generated procedurally in `src/render/vehicle-view.ts` | Original work, project-owned |
| Facility geometry, markings, cones, trees, fence | Generated from `data/maps/test-facility.ts` | Original work, project-owned |
| Asphalt and hazard textures | Generated at runtime on `<canvas>` | Original work, project-owned |
| Sky gradient | Generated at runtime on `<canvas>` | Original work, project-owned |
| Engine/UI typography | System font stack | No bundled font files |

Any future asset must be added to this table with name, source URL, author, licence, attribution
requirement and modification permission before it is committed. "Downloadable" is not a licence.

## Dependencies

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| three | 0.187 | MIT | WebGL 2 rendering |
| @dimforge/rapier3d-compat | 0.21 | Apache-2.0 | Rigid-body world, collision, raycasts |
| vite | 8.x | MIT | Build and dev server |
| typescript | 7.x | Apache-2.0 | Compiler |
| vitest | 5.x | MIT | Test runner |
| @types/node, @types/three | latest | MIT | Type definitions |

Rapier's WASM is loaded from the package at runtime; no ByteDance or Dimforge assets are redistributed
separately beyond the npm dependency itself.

## Reference material

BeamNG.drive, JBeam and the BeamNG soft-body documentation are used as **conceptual references only**.
No BeamNG source code, data files, vehicle models, textures, sounds or branding are copied into this
project. The implementation is original.
