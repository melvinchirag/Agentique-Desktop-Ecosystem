import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import type { CharacterCanvasComponent, CharacterCanvasProps } from '../../shell/contracts';
import { CharacterController } from './layer';

function Scene({ layout, hit, assetBase = './characters', onReady }: CharacterCanvasProps): null {
  const { scene, invalidate, set } = useThree();
  const layer = useMemo(() => new CharacterController(layout, hit, assetBase, invalidate), [hit, assetBase, invalidate]);
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    scene.add(layer.scene);
    set({ camera: layer.viewCamera });
    onReadyRef.current(layer);
    return () => { layer.dispose(); scene.remove(layer.scene); };
  }, [layer, scene, set]);
  useEffect(() => { layer.setLayout(layout); set({ camera: layer.viewCamera }); }, [layer, layout, set]);
  useFrame((_, dt) => layer.frame(Math.min(dt, 0.1)));
  return null;
}

export const CharacterCanvas: CharacterCanvasComponent = (props) => (
  <Canvas
    orthographic
    gl={{ alpha: true, antialias: false, powerPreference: 'low-power' }}
    dpr={1}
    frameloop="demand"
    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
  >
    <ambientLight intensity={1.8} />
    <directionalLight position={[200, 400, 500]} intensity={2} />
    <Scene {...props} />
  </Canvas>
);
