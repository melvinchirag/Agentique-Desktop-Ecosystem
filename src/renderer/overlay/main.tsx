import { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { AgentId } from '../../shared/agents';
import type { BiomeEvent } from '../../shared/events';
import type { DisplayLayout } from '../../main/shell/contracts';
import { createEventPlayer } from '../../main/fake/eventPlayer';
import { createMicRecorder, createPushToTalk, createSfxPlayer, createSpeechQueue } from '../audio';
import { createHitRegistry } from '../shell/hitRegistry';
import { createHubStore } from '../shell/hubStore';
import type { CharacterLayer, OverlayUi } from '../shell/contracts';
import { CharacterCanvas } from './characters';
import { createAnimationDirector } from './director';
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
      store.getState().setSettings(settings); speech.setVoiceEnabled(settings.voiceEnabled);
    });
    const offInspect = window.adeShell.onInspectAgent(id => ui.openInspect(id));
    const offReplay = window.adeShell.onReplayTask(taskId => { void director.replay(taskId); });
    void window.ade.getSettings().then(settings => {
      store.getState().setSettings(settings); speech.setVoiceEnabled(settings.voiceEnabled);
    });
    const point = (event: PointerEvent | MouseEvent) => ({ x: event.clientX, y: event.clientY });
    const move = (event: MouseEvent) => hit.pointerMove(point(event));
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const shape = hit.hitTest(point(event));
      if (shape?.kind !== 'animal') return;
      const id = shape.id.slice('animal:'.length) as AgentId;
      hit.setCaptured(true);
      if (id === 'chipmunk') talk.pointerDown();
      else ui.openInspect(id);
    };
    const up = () => { talk.pointerUp(); hit.setCaptured(false); };
    window.addEventListener('mousemove', move);
    window.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      dispatch = null; offLayout(); offSettings(); offInspect(); offReplay();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      director.dispose(); speech.dispose();
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
