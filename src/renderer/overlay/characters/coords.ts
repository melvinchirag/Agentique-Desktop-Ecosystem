import { Box3, OrthographicCamera, Vector3 } from 'three';
import type { Point, Rect } from '../../../main/shell/contracts';

export function cameraFor(width: number, height: number): OrthographicCamera {
  const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 2000);
  camera.position.set(0, 0, 1000);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  return camera;
}

export function toWorld(point: Point, width: number, height: number): Vector3 {
  return new Vector3(point.x - width / 2, height / 2 - point.y, 0);
}

export function toOverlay(world: Vector3, camera: OrthographicCamera, width: number, height: number): Point {
  const projected = world.clone().project(camera);
  return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 };
}

export function projectBox(box: Box3, camera: OrthographicCamera, width: number, height: number): Rect {
  const min = { x: Infinity, y: Infinity };
  const max = { x: -Infinity, y: -Infinity };
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const p = toOverlay(new Vector3(x, y, z), camera, width, height);
    min.x = Math.min(min.x, p.x); min.y = Math.min(min.y, p.y);
    max.x = Math.max(max.x, p.x); max.y = Math.max(max.y, p.y);
  }
  return { x: min.x, y: min.y, width: max.x - min.x, height: max.y - min.y };
}
