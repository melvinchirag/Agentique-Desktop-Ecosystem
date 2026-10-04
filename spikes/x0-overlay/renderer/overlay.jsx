import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas, useFrame } from '@react-three/fiber';

function Critter({ x, y, width, height, color }) {
  const cube = useRef();
  useFrame((_state, delta) => {
    if (cube.current) cube.current.rotation.y += delta * 0.8;
  });
  return (
    <mesh ref={cube} position={[x - width / 2, height / 2 - y, 0]}>
      <boxGeometry args={[90, 90, 90]} />
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

function App() {
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  const [config, setConfig] = useState(null);
  const [interactive, setInteractiveState] = useState(false);
  const [fps, setFps] = useState(0);
  const [color, setColor] = useState('#41c5e6');
  const [bubble, setBubble] = useState('Hi! Hover me');
  const [clicks, setClicks] = useState(0);
  const bubbleRef = useRef(null);
  const interactiveRef = useRef(false);
  const leaveTimer = useRef(null);
  const holding = useRef(false);
  const holdTimer = useRef(null);
  const recorder = useRef(null);
  const stream = useRef(null);
  const critterX = size.width * 0.38;
  const critterY = size.height - 45;

  useEffect(() => {
    window.x0.getConfig().then(setConfig);
    window.x0.onDiagnostics((data) => {
      setConfig(data);
      setInteractiveState(data.interactive);
    });
    window.x0.onHubText((text) => setBubble(text ? `Hub says: ${text}` : 'Hi! Hover me'));
    const resize = () => setSize({ width: innerWidth, height: innerHeight });
    addEventListener('resize', resize);
    return () => removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    let frames = 0;
    let previous = performance.now();
    let raf;
    const tick = (now) => {
      frames += 1;
      if (now - previous >= 1000) {
        const value = frames * 1000 / (now - previous);
        setFps(value);
        window.x0.fps(value);
        frames = 0;
        previous = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // These same local CSS-pixel rectangles are used by forwarded moves and polling.
  const shapes = () => {
    const result = [{ x: critterX - 71, y: size.height - 98, width: 142, height: 98 }];
    const rect = bubbleRef.current?.getBoundingClientRect();
    if (rect) result.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    return result;
  };
  const shapesRef = useRef(shapes);
  shapesRef.current = shapes;

  useEffect(() => {
    if (config?.pointerMode !== 'poll') return;
    const publish = () => window.x0.publishShapes(shapesRef.current());
    publish();
    const timer = setInterval(publish, 100);
    return () => clearInterval(timer);
  }, [config?.pointerMode]);

  useEffect(() => {
    if (config?.pointerMode !== 'forward') return;
    const move = (event) => {
      if (!interactiveRef.current) window.x0.forwardedMove();
      const inside = shapesRef.current().some((rect) =>
        event.clientX >= rect.x && event.clientX <= rect.x + rect.width &&
        event.clientY >= rect.y && event.clientY <= rect.y + rect.height);
      if (inside) {
        clearTimeout(leaveTimer.current);
        leaveTimer.current = null;
        if (!interactiveRef.current) {
          interactiveRef.current = true;
          window.x0.setInteractive(true);
        }
      } else if (interactiveRef.current && !leaveTimer.current) {
        leaveTimer.current = setTimeout(() => {
          interactiveRef.current = false;
          leaveTimer.current = null;
          window.x0.setInteractive(false);
        }, 60);
      }
    };
    addEventListener('mousemove', move);
    return () => {
      removeEventListener('mousemove', move);
      clearTimeout(leaveTimer.current);
    };
  }, [config?.pointerMode]);

  async function startRecording() {
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const recorderInstance = new MediaRecorder(media);
      recorder.current = recorderInstance;
      const parts = [];
      recorderInstance.ondataavailable = (event) => { if (event.data.size) parts.push(event.data); };
      recorderInstance.onstop = async () => {
        const blob = new Blob(parts, { type: recorderInstance.mimeType });
        const bytes = blob.size;
        const mime = blob.type || recorderInstance.mimeType || 'unknown';
        setBubble(`Recorded ${bytes} bytes, ${mime}`);
        window.x0.micResult(bytes, mime);
        media.getTracks().forEach((track) => track.stop());
        stream.current = null;
        recorder.current = null;
      };
      recorderInstance.start();
      if (!holding.current) stopRecording();
    } catch (error) {
      setBubble(`Mic error: ${error.message}`);
    }
  }

  function stopRecording() {
    const current = recorder.current;
    if (current && current.state !== 'inactive') current.stop();
  }

  function pointerDown(event) {
    event.currentTarget.setPointerCapture(event.pointerId);
    holding.current = true;
    holdTimer.current = setTimeout(startRecording, 250);
  }

  function pointerUp() {
    holding.current = false;
    clearTimeout(holdTimer.current);
    stopRecording();
  }

  function clickCritter() {
    const next = clicks + 1;
    setClicks(next);
    setColor(next % 2 ? '#ff8b5f' : '#41c5e6');
    setBubble(`Clicked! #${next}`);
    window.x0.critterClick();
  }

  const area = config?.workArea;
  const bounds = config?.bounds;
  const diagnosticText = config ? [
    `scaleFactor ${config.scaleFactor}`,
    `workArea ${area.x},${area.y},${area.width},${area.height}`,
    `bounds ${bounds.x},${bounds.y},${bounds.width},${bounds.height}`,
    `pointer ${config.pointerMode} · level ${config.level} · toolbar ${config.toolbar ? 'on' : 'off'}`,
    `FPS ${fps.toFixed(1)} · GPU ${config.gpuStatus}`,
    `interactive ${interactive ? 'on' : 'off'}`
  ].join('\n') : 'Loading diagnostics…';

  return <>
    <Canvas orthographic camera={{ position: [0, 0, 500], zoom: 1, near: 0.1, far: 1000 }}
      gl={{ alpha: true, premultipliedAlpha: true }}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'transparent' }}>
      <ambientLight intensity={1.4} />
      <directionalLight position={[100, 150, 250]} intensity={2} />
      <Critter x={critterX} y={critterY} width={size.width} height={size.height} color={color} />
    </Canvas>
    <div className="bubble" ref={bubbleRef} style={{ left: critterX }}>{bubble}</div>
    <div className="critter-hit" style={{ left: critterX }} onPointerDown={pointerDown}
      onPointerUp={pointerUp} onPointerCancel={pointerUp} onClick={clickCritter} />
    <div className="diagnostics">{diagnosticText}</div>
  </>;
}

createRoot(document.getElementById('root')).render(<App />);
