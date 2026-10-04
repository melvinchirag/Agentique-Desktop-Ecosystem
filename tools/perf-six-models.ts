import { Box3, CapsuleGeometry, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Vector3 } from 'three';

// CPU-side animation/projection check for six dummy models. The transparent Electron
// compositor still needs a manual Task Manager check on the target machine.
const modelCount = 6;
const frames = 300;
const geometry = new CapsuleGeometry(18, 54, 4, 8);
const material = new MeshStandardMaterial({ color: '#7f9cb7' });
const scene = new Group();
const models = Array.from({ length: modelCount }, (_, index) => {
  const mesh = new Mesh(geometry, material);
  const root = new Group();
  root.position.x = index * 120;
  root.add(mesh);
  scene.add(root);
  return root;
});
const camera = new OrthographicCamera(-768, 768, 408, -408, 0.1, 2000);
camera.position.z = 1000;
camera.updateMatrixWorld();
const bounds = new Box3();
const projected = new Vector3();
const samples: number[] = [];
for (let frame = 0; frame < frames; frame++) {
  const start = performance.now();
  for (let i = 0; i < models.length; i++) {
    const root = models[i];
    root.position.y = Math.sin(frame * 0.2 + i) * 4;
    root.rotation.z = Math.sin(frame * 0.12 + i) * 0.1;
    root.updateMatrixWorld(true);
    bounds.setFromObject(root);
    bounds.min.clone().project(camera);
    projected.copy(bounds.max).project(camera);
  }
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const average = samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
const p95 = samples[Math.floor(samples.length * 0.95)];
console.log(`Six dummy animated models, ${frames} CPU update/projection frames`);
console.log(`Mean frame work: ${average.toFixed(2)} ms; p95: ${p95.toFixed(2)} ms; theoretical update FPS: ${Math.round(1000 / average)}`);
console.log('Display caps: 30 FPS moving (33.33 ms), 10 FPS idle (100 ms), 0 FPS all asleep; DPR 1.');
if (p95 > 33.33) process.exitCode = 1;
