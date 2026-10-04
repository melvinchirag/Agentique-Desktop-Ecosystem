import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

interface ModelViewerProps {
  scene: THREE.Group | THREE.Object3D;
  animations: THREE.AnimationClip[];
  activeClipName: string | null;
  loop: boolean;
  onBoundsCalculated?: (targetY: number, maxDim: number) => void;
}

function ModelViewer({
  scene,
  animations,
  activeClipName,
  loop,
  onBoundsCalculated
}: ModelViewerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    if (!scene) return;
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Center on x and z, and set base of model at ground (y = 0)
    if (groupRef.current) {
      groupRef.current.position.set(-center.x, -box.min.y, -center.z);
    }

    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    if (onBoundsCalculated) {
      onBoundsCalculated(size.y > 0 ? size.y / 2 : 0.5, maxDim);
    }

    const mixer = new THREE.AnimationMixer(scene);
    mixerRef.current = mixer;

    return () => {
      mixer.stopAllAction();
      mixerRef.current = null;
    };
  }, [scene, onBoundsCalculated]);

  useEffect(() => {
    const mixer = mixerRef.current;
    if (!mixer) return;

    mixer.stopAllAction();
    if (!activeClipName) return;

    const clip = animations.find((a) => a.name === activeClipName);
    if (!clip) return;

    const action = mixer.clipAction(clip);
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = true;
    action.reset().play();
  }, [activeClipName, loop, animations]);

  useFrame((_, delta) => {
    mixerRef.current?.update(delta);
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

export interface TurntableProps {
  scene: THREE.Group | THREE.Object3D | null;
  animations: THREE.AnimationClip[];
  activeClipName: string | null;
  loop: boolean;
  autoRotate: boolean;
}

export const Turntable: React.FC<TurntableProps> = ({
  scene,
  animations,
  activeClipName,
  loop,
  autoRotate
}) => {
  const [targetY, setTargetY] = useState(0.5);
  const [cameraDistance, setCameraDistance] = useState(2.5);

  const handleBounds = (centerY: number, maxDim: number) => {
    setTargetY(centerY);
    setCameraDistance(Math.max(1.2, maxDim * 2.2));
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#0f172a' }}>
      <Canvas
        dpr={1}
        camera={{ position: [0, targetY + cameraDistance * 0.4, cameraDistance], fov: 45 }}
        style={{ width: '100%', height: '100%' }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 10, 5]} intensity={1.2} />
        <directionalLight position={[-5, 5, -5]} intensity={0.4} />

        <gridHelper args={[10, 20, '#6366f1', '#334155']} position={[0, 0, 0]} />

        {scene && (
          <ModelViewer
            scene={scene}
            animations={animations}
            activeClipName={activeClipName}
            loop={loop}
            onBoundsCalculated={handleBounds}
          />
        )}

        <OrbitControls
          makeDefault
          autoRotate={autoRotate}
          autoRotateSpeed={1.5}
          target={[0, targetY, 0]}
        />
      </Canvas>
    </div>
  );
};
