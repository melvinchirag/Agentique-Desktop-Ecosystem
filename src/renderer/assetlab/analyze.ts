import * as THREE from 'three';

export interface BoundingBoxSize {
  width: number;
  height: number;
  depth: number;
}

export interface AnalysisResult {
  triangles: number;
  meshes: number;
  bones: number;
  clips: string[];
  morphTargets: string[];
  boundingBox: BoundingBoxSize;
}

/**
 * Computes the bounding box of an object safely, falling back to geometry
 * bounds if SkinnedMesh bone transforms cannot be computed.
 */
function computeBoundingBoxSafely(scene: THREE.Object3D): THREE.Box3 {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  try {
    box.setFromObject(scene);
    if (!box.isEmpty()) {
      return box;
    }
  } catch {
    // If standard setFromObject fails (e.g. unskinned/synthetic SkinnedMesh), fallback:
  }

  box.makeEmpty();
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      if (mesh.geometry) {
        if (!mesh.geometry.boundingBox) {
          mesh.geometry.computeBoundingBox();
        }
        if (mesh.geometry.boundingBox) {
          const geomBox = mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrixWorld);
          box.union(geomBox);
        }
      }
    }
  });

  return box;
}

/**
 * Analyzes a glTF scene and animation clips in a pure, headless manner.
 * Suitable for running in both Node.js test environments and browser renderers.
 */
export function analyzeGltf(
  scene: THREE.Object3D,
  animations: THREE.AnimationClip[] = []
): AnalysisResult {
  let triangles = 0;
  let meshes = 0;
  const boneSet = new Set<THREE.Bone>();
  const morphTargetSet = new Set<string>();

  scene.traverse((obj) => {
    // Check if node is a Mesh (SkinnedMesh also inherits from Mesh)
    if ((obj as THREE.Mesh).isMesh) {
      meshes++;
      const mesh = obj as THREE.Mesh;
      const geom = mesh.geometry;
      if (geom) {
        if (geom.index) {
          triangles += Math.floor(geom.index.count / 3);
        } else if (geom.attributes?.position) {
          triangles += Math.floor(geom.attributes.position.count / 3);
        }
      }

      if (mesh.morphTargetDictionary) {
        for (const name of Object.keys(mesh.morphTargetDictionary)) {
          morphTargetSet.add(name);
        }
      }
    }

    if ((obj as THREE.Bone).isBone) {
      boneSet.add(obj as THREE.Bone);
    }

    const skinned = obj as THREE.SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton?.bones) {
      for (const bone of skinned.skeleton.bones) {
        if (bone) {
          boneSet.add(bone);
        }
      }
    }
  });

  const clips = animations.map((clip) => clip.name);
  const morphTargets = Array.from(morphTargetSet).sort();

  const box = computeBoundingBoxSafely(scene);
  const size = new THREE.Vector3();
  if (box.isEmpty()) {
    return {
      triangles,
      meshes,
      bones: boneSet.size,
      clips,
      morphTargets,
      boundingBox: { width: 0, height: 0, depth: 0 }
    };
  }

  box.getSize(size);
  return {
    triangles,
    meshes,
    bones: boneSet.size,
    clips,
    morphTargets,
    boundingBox: {
      width: Number(size.x.toFixed(4)),
      height: Number(size.y.toFixed(4)),
      depth: Number(size.z.toFixed(4))
    }
  };
}
