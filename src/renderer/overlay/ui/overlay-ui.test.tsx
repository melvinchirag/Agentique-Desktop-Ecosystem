// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HitRegistry, OverlayUi } from '../../shell/contracts';
import type { Rect } from '../../../main/shell/contracts';
import { createHubStore } from '../../shell/hubStore';
import { demoSeedState } from '../../shell/seed';
import { OverlayUiLayer } from './index';

const rect: Rect = { x: 240, y: 340, width: 90, height: 100 };
let pendingFrames = new Map<number, FrameRequestCallback>();
let frameId = 0;
function stepFrame() {
  const callbacks = [...pendingFrames.values()]; pendingFrames.clear();
  act(() => callbacks.forEach(callback => callback(performance.now())));
}

function setup(options: { anchor?: Rect | null } = {}) {
  let ui!: OverlayUi;
  const hit = {
    set: vi.fn(), remove: vi.fn(), shapes: vi.fn(() => []), hitTest: vi.fn(() => null),
    pointerMove: vi.fn(), setCaptured: vi.fn(), dispose: vi.fn(),
  } as unknown as HitRegistry;
  const api = { resolveApproval: vi.fn(async () => {}), wakeAgent: vi.fn(async () => {}), sleepAgent: vi.fn(async () => {}) };
  const shell = { openHubTab: vi.fn() };
  const store = createHubStore(demoSeedState());
  const view = render(<OverlayUiLayer hit={hit} getRect={() => options.anchor === undefined ? rect : options.anchor} layout={{ width: 900, height: 600, groundY: 596, spots: {} as never, colonyX: 54, centerX: 450, hubX: 790, dockPoint: { x: 790, y: 90 } }} store={store} api={api} shell={shell} onReady={layer => { ui = layer; }} />);
  return { ...view, get ui() { return ui; }, hit, api, shell, store };
}

beforeEach(() => {
  pendingFrames = new Map(); frameId = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++frameId; pendingFrames.set(id, callback); return id; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => pendingFrames.delete(id));
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('OverlayUiLayer', () => {
  it('shows a bubble, registers its hit rect, and removes it and its shape at ttl expiry', () => {
    const app = setup();
    act(() => app.ui.showBubble('eagle', 'Searching nearby', 'say'));
    expect(screen.getByText('Searching nearby')).toBeTruthy();
    stepFrame();
    expect(app.hit.set).toHaveBeenCalledWith('bubble:eagle', 'bubble', expect.objectContaining({ width: expect.any(Number) }));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.queryByText('Searching nearby')).toBeNull();
    expect(app.hit.remove).toHaveBeenCalledWith('bubble:eagle');
  });

  it('resolves approvals and disables both actions while the request is pending', async () => {
    let finish!: () => void;
    const app = setup(); app.api.resolveApproval.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
    act(() => app.ui.showApproval({ callId: 'approve-1', title: 'Move files', preview: 'From inbox to archive', nearAgent: 'wolf' }));
    stepFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    expect(app.api.resolveApproval).toHaveBeenCalledWith('approve-1', true);
    expect(screen.getByRole('button', { name: 'Allow' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Deny' }).hasAttribute('disabled')).toBe(true);
    await act(async () => finish());
    expect(screen.queryByLabelText('Warden approval')).toBeNull();
    act(() => app.ui.showApproval({ callId: 'approve-2', title: 'Delete draft', preview: 'One draft', nearAgent: 'beaver' }));
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(app.api.resolveApproval).toHaveBeenCalledWith('approve-2', false);
  });

  it('ignores Chip inspect; reads current row, wakes only sleeping/docked agents, and opens memories', () => {
    const app = setup();
    act(() => app.ui.openInspect('chipmunk'));
    expect(screen.queryByLabelText('Chip details')).toBeNull();
    act(() => app.ui.openInspect('ants'));
    expect(screen.getByText('sleeping · idle')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wake' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Wake' }));
    expect(app.api.wakeAgent).toHaveBeenCalledWith('ants');
    fireEvent.click(screen.getByRole('button', { name: 'What I remember' }));
    expect(app.shell.openHubTab).toHaveBeenCalledWith('memories', 'ants');
    fireEvent.click(screen.getByRole('button', { name: 'Send to Hub' }));
    expect(app.api.sleepAgent).toHaveBeenCalledWith('ants');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByLabelText('Swarm details')).toBeNull();
    expect(app.hit.remove).toHaveBeenCalledWith('card:inspect');
    act(() => app.ui.openInspect('eagle'));
    expect(screen.queryByRole('button', { name: 'Wake' })).toBeNull();
  });

  it('registers the replay banner and clears every hit shape when pieces close', () => {
    const app = setup();
    act(() => { app.ui.showBubble('eagle', 'Ready'); app.ui.openInspect('ants'); app.ui.setReplayBanner(true); });
    stepFrame();
    expect(app.hit.set).toHaveBeenCalledWith('banner:replay', 'banner', expect.any(Object));
    act(() => { app.ui.clearBubble('eagle'); app.ui.closeInspect(); app.ui.setReplayBanner(false); });
    expect(app.hit.remove).toHaveBeenCalledWith('bubble:eagle');
    expect(app.hit.remove).toHaveBeenCalledWith('card:inspect');
    expect(app.hit.remove).toHaveBeenCalledWith('banner:replay');
    expect(screen.queryByText('REPLAY 2×')).toBeNull();
  });

  it('does not start an animation frame loop while idle and cancels it after the last item closes', () => {
    const app = setup();
    expect(pendingFrames.size).toBe(0);
    act(() => app.ui.showBubble('eagle', 'Working'));
    expect(pendingFrames.size).toBe(1);
    stepFrame();
    expect(pendingFrames.size).toBe(1);
    act(() => app.ui.clearBubble('eagle'));
    expect(pendingFrames.size).toBe(0);
  });
});
