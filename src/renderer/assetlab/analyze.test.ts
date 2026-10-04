import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { analyzeGltf } from './analyze';

describe('analyzeGltf', () => {
  it('correctly calculates counts and bounding box for a scene with a mesh, skinned mesh, morph targets, and clips', () => {
    const scene = new THREE.Scene();

    // 1. Regular mesh with a box geometry (12 triangles, indexed)
    const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
    const mesh = new THREE.Mesh(boxGeometry);
    mesh.morphTargetDictionary = {
      MouthOpen: 0,
      Blink: 1
    };
    mesh.position.set(0, 1, 0);
    scene.add(mesh);

    // 2. Skinned mesh with two bones and a plane geometry (2 triangles)
    const planeGeometry = new THREE.PlaneGeometry(1, 1);
    // SkinnedMesh needs skinIndex and skinWeight
    const vertexCount = planeGeometry.attributes.position.count;
    const skinIndices = new Float32Array(vertexCount * 4);
    const skinWeights = new Float32Array(vertexCount * 4);
    for (let i = 0; i < vertexCount; i++) {
      skinIndices[i * 4] = 0;
      skinWeights[i * 4] = 1.0;
    }
    planeGeometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4));
    planeGeometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4));

    const bone1 = new THREE.Bone();
    const bone2 = new THREE.Bone();
    bone1.add(bone2);
    const skeleton = new THREE.Skeleton([bone1, bone2]);
    const skinnedMesh = new THREE.SkinnedMesh(planeGeometry);
    skinnedMesh.bind(skeleton);
    scene.add(skinnedMesh);
    scene.add(bone1);

    // 3. Animation clip list
    const clips = [
      new THREE.AnimationClip('Idle', 2.0, []),
      new THREE.AnimationClip('Walk', 1.0, []),
      new THREE.AnimationClip('Talk', 1.5, [])
    ];

    const result = analyzeGltf(scene, clips);

    // BoxGeometry has 12 triangles, PlaneGeometry has 2 triangles -> total 14
    expect(result.triangles).toBe(14);
    expect(result.meshes).toBe(2);
    expect(result.bones).toBe(2);
    expect(result.clips).toEqual(['Idle', 'Walk', 'Talk']);
    expect(result.morphTargets).toEqual(['Blink', 'MouthOpen']);
    expect(result.boundingBox.width).toBeGreaterThanOrEqual(2);
    expect(result.boundingBox.height).toBeGreaterThanOrEqual(2);
    expect(result.boundingBox.depth).toBeGreaterThanOrEqual(2);
  });

  it('handles empty scene and no animations gracefully', () => {
    const emptyScene = new THREE.Scene();
    const result = analyzeGltf(emptyScene);

    expect(result.triangles).toBe(0);
    expect(result.meshes).toBe(0);
    expect(result.bones).toBe(0);
    expect(result.clips).toEqual([]);
    expect(result.morphTargets).toEqual([]);
    expect(result.boundingBox).toEqual({ width: 0, height: 0, depth: 0 });
  });
});
