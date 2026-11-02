import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentId } from '../../shared/agents';
import type { BiomeEvent } from '../../shared/events';
import type { DisplayLayout } from '../../main/shell/contracts';
import { createEventPlayer } from '../../main/fake/eventPlayer';
import { createMicRecorder, createPushToTalk, createSfxPlayer, createSpeechQueue } from '../audio';
import { applyAudioSettings } from '../audio/settings';
import { createHitRegistry } from '../shell/hitRegistry';
import { createHubStore } from '../shell/hubStore';
import type { CharacterLayer, OverlayUi } from '../shell/contracts';
import { CharacterCanvas } from './characters';
import { createAnimationDirector } from './director';
import { pokeSound } from './director/sounds';
import { computeLayout } from './layout';
import { OverlayUiLayer } from './ui';

const store = createHubStore();
const eventBuffer: BiomeEvent[] = [];
let dispatch: ((event: BiomeEvent) => void) | null = null;
window.ade.onEvent(event => { if (dispatch) dispatch(event); else eventBuffer.push(event); });

function OverlayApp({ display }: { display: DisplayLayout }) {
  const [currentDisplay, setDisplay] = useState(display);
  const [layer, setLayer] = useState<CharacterLayer | null>(null);
  const [ui, setUi] = useState<OverlayUi | null>(null);
  const layout = useMemo(() => computeLayout(currentDisplay), [currentDisplay]);
  const hit = useMemo(() => createHitRegistry({
    setInteractive: on => window.adeShell.setInteractive(on),
    publishHitShapes: rects => window.adeShell.publishHitShapes(rects),
  }), []);

  useEffect(() => window.adeShell.onLayoutChanged(setDisplay), []);
  useEffect(() => { layer?.setVisible(!currentDisplay.animalsHidden); }, [layer, currentDisplay.animalsHidden]);
  useEffect(() => { layer?.setLayout(layout); }, [layer, layout]);
  useEffect(() => {
    if (!layer || !ui) return;
    const speech = createSpeechQueue({ speak: window.ade.speak, setMouth: (id, open) => layer.setMouth(id, open) });
    const sfx = createSfxPlayer({ baseUrl: './sfx' });
    const mic = createMicRecorder();
    const talk = createPushToTalk({ mic, sendVoice: window.ade.sendVoice, focusChat: window.adeShell.hubFocusChat });
    const director = createAnimationDirector({ layer, speech, sfx, ui, getLayout: () => layout,
      createPlayer: () => createEventPlayer<BiomeEvent>(), getTaskEvents: window.ade.getTaskEvents });
    dispatch = event => { store.getState().applyEvent(event); director.handle(event); };
    eventBuffer.splice(0).forEach(event => dispatch?.(event));
    const offLayout = window.adeShell.onLayoutChanged(next => director.setLayout(computeLayout(next)));
    const offSettings = window.adeShell.onSettingsChanged(settings => {
      store.getState().setSettings(settings); applyAudioSettings(settings, speech, sfx);
    });
    const offInspect = window.adeShell.onInspectAgent(id => ui.openInspect(id));
    const offReplay = window.adeShell.onReplayTask(taskId => { void director.replay(taskId); });
    void window.ade.getSettings().then(settings => {
      store.getState().setSettings(settings); applyAudioSettings(settings, speech, sfx);
    });
    // Drag an animal along the ground; the spot is remembered on this computer (Tray > Reset animal spots undoes it).
    const SPOTS_KEY = 'ade-animal-spots';
    const readSpots = (): Partial<Record<AgentId, number>> => {
      try { return JSON.parse(localStorage.getItem(SPOTS_KEY) ?? '{}') ?? {}; } catch { return {}; }
    };
    const writeSpots = (spots: Partial<Record<AgentId, number>>) => {
      try { localStorage.setItem(SPOTS_KEY, JSON.stringify(spots)); } catch { /* spot lasts until restart */ }
    };
    for (const [id, x] of Object.entries(readSpots())) if (typeof x === 'number') director.setUserSpot?.(id as AgentId, x);
    const offReset = window.adeShell.onResetAnimalSpots?.(() => {
      for (const id of Object.keys(readSpots())) director.setUserSpot?.(id as AgentId, null);
      writeSpots({});
    }) ?? (() => {});

    const DRAG_PX = 8;
    let press: { id: AgentId; x: number; dx: number; dragging: boolean } | null = null;
    const point = (event: PointerEvent | MouseEvent) => ({ x: event.clientX, y: event.clientY });
    const move = (event: MouseEvent) => {
      hit.pointerMove(point(event));
      if (!press) return;
      if (!press.dragging && Math.abs(event.clientX - press.x) < DRAG_PX) return;
      if (!press.dragging) {
        if (!director.dragTo?.(press.id, event.clientX + press.dx)) { press = null; return; }
        press.dragging = true;
        if (press.id === 'chipmunk') talk.cancel?.();
      }
      director.dragTo?.(press.id, event.clientX + press.dx);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const shape = hit.hitTest(point(event));
      if (shape?.kind !== 'animal') return;
      const id = shape.id.slice('animal:'.length) as AgentId;
      sfx.play(pokeSound(id));
      hit.setCaptured(true);
      const feet = layer.position(id);
      press = { id, x: event.clientX, dx: feet ? feet.x - event.clientX : 0, dragging: false };
      if (id === 'chipmunk') talk.pointerDown();
    };
    const up = (event: PointerEvent) => {
      const done = press; press = null;
      hit.setCaptured(false);
      if (done?.dragging) {
        const x = layer.position(done.id)?.x ?? event.clientX + done.dx;
        director.setUserSpot?.(done.id, x);
        writeSpots({ ...readSpots(), [done.id]: Math.round(x) });
        return;
      }
      if (done?.id === 'chipmunk') talk.pointerUp();
      else if (done) ui.openInspect(done.id);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      dispatch = null; offLayout(); offSettings(); offInspect(); offReplay(); offReset();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      director.dispose(); speech.dispose(); sfx.dispose();
    };
  }, [layer, ui, hit]);
  useEffect(() => () => hit.dispose(), [hit]);
  return <>
    <CharacterCanvas layout={layout} hit={hit} onReady={setLayer} />
    <div style={{ position: 'fixed', inset: 0 }} />
    <OverlayUiLayer hit={hit} getRect={id => layer?.screenRect(id) ?? null} layout={layout}
      store={store} api={window.ade} shell={window.adeShell} onReady={setUi} />
  </>;
}

void window.adeShell.getLayout().then(display => {
  createRoot(document.getElementById('root')!).render(<OverlayApp display={display} />);
});
