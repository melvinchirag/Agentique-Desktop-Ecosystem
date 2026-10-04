import type { DisplayLayout } from '../../main/shell/contracts';
import type { ComputeLayout } from '../shell/contracts';

const clamp = (value: number, max: number): number => Math.min(Math.max(value, 0), max);

export const computeLayout: ComputeLayout = (display: DisplayLayout) => {
  const { workArea, hubBounds } = display;
  const width = workArea.width;
  const height = workArea.height;
  const hubX = clamp(hubBounds.x - workArea.x + hubBounds.width / 2, width);
  return {
    width,
    height,
    groundY: height - 4,
    spots: {
      ants: width * 0.06,
      beaver: width * 0.16,
      workspace: width * 0.26,
      chipmunk: width * 0.38,
      wolf: width * 0.5,
      eagle: width * 0.6,
      butterfly: width * 0.7,
      nightingale: width * 0.78,
    },
    colonyX: width * 0.06,
    centerX: width / 2,
    hubX,
    dockPoint: { x: hubX, y: clamp(hubBounds.y - workArea.y + 28, height) },
  };
};
