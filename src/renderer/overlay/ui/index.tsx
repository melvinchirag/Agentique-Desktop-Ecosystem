import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { AGENTS } from '../../../shared/config';
import type { AgentId } from '../../../shared/agents';
import type { Rect } from '../../../main/shell/contracts';
import type { BubbleKind, OverlayUi, OverlayUiComponent, OverlayUiProps, PendingApproval } from '../../shell/contracts';
import './overlay-ui.css';

type Bubble = { text: string; kind: BubbleKind; key: number };
type Effect = { key: number; label: string; kind: 'sparkle' | 'ok' | 'no' | 'flight' };
type Approval = PendingApproval & { nearAgent: AgentId; offset: { x: number; y: number } };
type Inspect = { agentId: AgentId; offset: { x: number; y: number } };

const BUBBLE_TTL: Record<BubbleKind, number | null> = { say: 4000, warning: 6000, status: null, waiting: null };
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(value, high));

function beside(anchor: Rect, width: number, height: number, layout: OverlayUiProps['layout'], offset: { x: number; y: number }) {
  const gap = 14;
  let x = anchor.x + anchor.width + gap;
  if (x + width > layout.width - 8) x = anchor.x - width - gap;
  return {
    x: clamp(x + offset.x, 8, Math.max(8, layout.width - width - 8)),
    y: clamp(anchor.y + (anchor.height - height) / 2 + offset.y, 8, Math.max(8, layout.height - height - 8)),
  };
}

export const OverlayUiLayer: OverlayUiComponent = (props) => {
  const [bubbles, setBubbles] = useState<Partial<Record<AgentId, Bubble>>>({});
  const [effects, setEffects] = useState<Partial<Record<AgentId, Effect>>>({});
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const [flights, setFlights] = useState<Array<{ key: number; agentId: AgentId; label: string; started: number }>>([]);
  const [replay, setReplay] = useState(false);
  const [dragging, setDragging] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const nextKey = useRef(0);
  const propsRef = useRef(props);
  propsRef.current = props;
  const uiRef = useRef<OverlayUi | null>(null);
  const ready = useRef(false);

  const clearTimer = useCallback((key: string) => {
    const timer = timers.current.get(key);
    if (timer) clearTimeout(timer);
    timers.current.delete(key);
  }, []);
  const armTimer = useCallback((key: string, run: () => void, duration: number) => {
    clearTimer(key);
    timers.current.set(key, setTimeout(() => { timers.current.delete(key); run(); }, duration));
  }, [clearTimer]);

  if (!uiRef.current) {
    uiRef.current = {
      showBubble(agentId, text, kind = 'say', ttlMs) {
        const key = ++nextKey.current;
        setBubbles(previous => ({ ...previous, [agentId]: { text, kind, key } }));
        const ttl = ttlMs ?? (kind === 'say' ? sayBubbleTtl(text) : BUBBLE_TTL[kind]);
        if (ttl !== null) armTimer(`bubble:${agentId}`, () => setBubbles(previous => {
          if (previous[agentId]?.key !== key) return previous;
          const next = { ...previous }; delete next[agentId]; return next;
        }), ttl);
        else clearTimer(`bubble:${agentId}`);
      },
      clearBubble(agentId) { clearTimer(`bubble:${agentId}`); setBubbles(previous => { const next = { ...previous }; delete next[agentId]; return next; }); },
      sparkle(agentId) { const key = ++nextKey.current; setEffects(previous => ({ ...previous, [agentId]: { key, label: '💭', kind: 'sparkle' } })); armTimer(`effect:${agentId}`, () => setEffects(previous => previous[agentId]?.key === key ? without(previous, agentId) : previous), 1200); },
      puff(agentId, ok) { const key = ++nextKey.current; setEffects(previous => ({ ...previous, [agentId]: { key, label: ok ? '✓' : '✗', kind: ok ? 'ok' : 'no' } })); armTimer(`effect:${agentId}`, () => setEffects(previous => previous[agentId]?.key === key ? without(previous, agentId) : previous), 800); },
      showApproval(a) { setApprovals(previous => previous.some(item => item.callId === a.callId) ? previous : [...previous, { ...a, title: a.title, preview: a.preview, agentId: a.nearAgent, ts: Date.now(), offset: { x: 0, y: previous.length * 18 } }]); },
      closeApproval(callId) { setApprovals(previous => previous.filter(item => item.callId !== callId)); },
      openInspect(agentId) { if (agentId !== 'chipmunk') setInspect({ agentId, offset: { x: 0, y: 0 } }); },
      closeInspect() { setInspect(null); },
      flyToHub(agentId, label) { const key = ++nextKey.current; setFlights(previous => [...previous, { key, agentId, label, started: Date.now() }]); armTimer(`flight:${key}`, () => setFlights(previous => previous.filter(flight => flight.key !== key)), 800); },
      setReplayBanner(on) { setReplay(on); },
    };
  }

  useEffect(() => { if (!ready.current) { ready.current = true; props.onReady(uiRef.current!); } }, []);
  useEffect(() => () => { for (const timer of timers.current.values()) clearTimeout(timer); timers.current.clear(); props.hit.remove('banner:replay'); }, []);

  const hasAnchored = Object.keys(bubbles).length + Object.keys(effects).length + approvals.length + (inspect ? 1 : 0) + flights.length > 0;
  const hasVisibleAnchor = hasAnchored && [...Object.keys(bubbles), ...Object.keys(effects), ...approvals.map(a => a.nearAgent), ...(inspect ? [inspect.agentId] : []), ...flights.map(f => f.agentId)].some(id => props.getRect(id as AgentId));

  useEffect(() => {
    let frame = 0;
    let lastUpdate = -Infinity;
    let running = true;
    const update = () => {
      if (!running) return;
      const now = performance.now();
      if (now - lastUpdate < (flights.length ? 1000 / 30 : 1000 / 10)) {
        frame = requestAnimationFrame(update);
        return;
      }
      lastUpdate = now;
      const current = propsRef.current;
      const putAnchor = (key: string, id: AgentId, width: number, height: number, mode: 'bubble' | 'effect' | 'card', offset = { x: 0, y: 0 }) => {
        const anchor = current.getRect(id);
        const element = elements.current.get(key);
        if (!anchor) { if (element) element.style.visibility = 'hidden'; current.hit.remove(key); return; }
        let x: number; let y: number;
        if (mode === 'bubble') { x = clamp(anchor.x + anchor.width / 2 - width / 2, 8, current.layout.width - width - 8); y = clamp(anchor.y - height - 12, 8, current.layout.height - height - 8); }
        else if (mode === 'effect') { x = anchor.x + anchor.width / 2 - width / 2; y = anchor.y - height - 8; }
        else ({ x, y } = beside(anchor, width, height, current.layout, offset));
        if (element) {
          element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
          element.style.visibility = 'visible';
          const rect = element.getBoundingClientRect();
          current.hit.set(key, mode === 'bubble' ? 'bubble' : 'card', { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        }
      };
      for (const [id, bubble] of Object.entries(bubbles)) if (bubble) putAnchor(`bubble:${id}`, id as AgentId, 224, bubble.kind === 'status' ? 42 : 24 + 18 * Math.max(2, wrapBubble(bubble.text, bubble.kind).split('\n').length), 'bubble');
      for (const [id, effect] of Object.entries(effects)) if (effect) putAnchor(`effect:${id}`, id as AgentId, 44, 44, 'effect');
      approvals.forEach(approval => putAnchor(`card:approval:${approval.callId}`, approval.nearAgent, 284, 210, 'card', approval.offset));
      if (inspect) putAnchor('card:inspect', inspect.agentId, 284, 270, 'card', inspect.offset);
      for (const flight of flights) {
        const anchor = current.getRect(flight.agentId);
        const key = `flight:${flight.key}`;
        if (!anchor) { const element = elements.current.get(key); if (element) element.style.visibility = 'hidden'; continue; }
        const t = Math.min(1, (Date.now() - flight.started) / 800);
        const x = anchor.x + (current.layout.dockPoint.x - anchor.x) * t;
        const y = anchor.y + (current.layout.dockPoint.y - anchor.y) * t;
        const element = elements.current.get(key);
        if (element) { element.style.transform = `translate3d(${x}px, ${y}px, 0)`; element.style.visibility = 'visible'; }
      }
      const banner = elements.current.get('banner:replay');
      if (replay && banner) { const rect = banner.getBoundingClientRect(); current.hit.set('banner:replay', 'banner', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }); }
      frame = requestAnimationFrame(update);
    };
    if (hasVisibleAnchor || replay) frame = requestAnimationFrame(update);
    return () => { running = false; if (frame) cancelAnimationFrame(frame); };
  }, [bubbles, effects, approvals, inspect, flights, replay, hasVisibleAnchor, props.hit, props.getRect, props.layout]);

  useEffect(() => {
    if (replay) return;
    props.hit.remove('banner:replay');
  }, [replay, props.hit]);

  const register = (key: string) => (element: HTMLElement | null) => {
    if (element) elements.current.set(key, element); else { elements.current.delete(key); props.hit.remove(key); }
  };
  const locationStyle = (key: string): CSSProperties => {
    let point: { x: number; y: number; visible: boolean } | undefined;
    {
      const bubble = key.startsWith('bubble:') ? bubbles[key.slice(7) as AgentId] : undefined;
      const effect = key.startsWith('effect:') ? effects[key.slice(7) as AgentId] : undefined;
      const approvalId = key.startsWith('card:approval:') ? key.slice('card:approval:'.length) : '';
      const approval = approvals.find(item => item.callId === approvalId);
      const cardAgent = approval?.nearAgent ?? (key === 'card:inspect' ? inspect?.agentId : undefined);
      const flightId = key.startsWith('flight:') ? Number(key.slice(7)) : 0;
      const flight = flights.find(item => item.key === flightId);
      const anchor = bubble || effect || cardAgent || flight ? props.getRect((bubble ? key.slice(7) : effect ? key.slice(7) : cardAgent ?? flight?.agentId ?? '') as AgentId) : null;
      if (anchor) {
        if (bubble) {
          const height = bubble.kind === 'status' ? 42 : 58;
          point = { x: clamp(anchor.x + anchor.width / 2 - 112, 8, props.layout.width - 232), y: clamp(anchor.y - height - 12, 8, props.layout.height - height - 8), visible: true };
        } else if (effect) point = { x: anchor.x + anchor.width / 2 - 22, y: anchor.y - 52, visible: true };
        else if (flight) point = { x: anchor.x, y: anchor.y, visible: true };
        else point = { ...beside(anchor, 284, approval ? 210 : 270, props.layout, approval?.offset ?? inspect?.offset ?? { x: 0, y: 0 }), visible: true };
      } else if (bubble || effect || cardAgent || flight) point = { x: 0, y: 0, visible: false };
    }
    return { transform: point ? `translate3d(${point.x}px, ${point.y}px, 0)` : 'translate3d(-10000px, -10000px, 0)', visibility: point?.visible ? 'visible' : 'hidden' };
  };
  const beginDrag = (key: string, initialOffset: { x: number; y: number }, setOffset: (point: { x: number; y: number }) => void) => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    // Pointer capture would retarget the click away from header buttons (×), so they never fire.
    if ((event.target as HTMLElement).closest('button')) return;
    const target = event.currentTarget;
    const startX = event.clientX; const startY = event.clientY;
    const original = target.getBoundingClientRect();
    target.setPointerCapture?.(event.pointerId);
    props.hit.setCaptured(true); setDragging(true);
    const move = (moveEvent: PointerEvent) => {
      const width = target.offsetWidth || original.width; const height = target.offsetHeight || original.height;
      const x = clamp(original.x + moveEvent.clientX - startX, 0, props.layout.width - width);
      const y = clamp(original.y + moveEvent.clientY - startY, 0, props.layout.height - height);
      setOffset({ x: initialOffset.x + x - original.x, y: initialOffset.y + y - original.y });
      target.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      const rect = target.getBoundingClientRect(); props.hit.set(key, 'card', { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    };
    const finish = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish); props.hit.setCaptured(false); setDragging(false); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', finish, { once: true }); window.addEventListener('pointercancel', finish, { once: true });
  };

  const approve = async (callId: string, allowed: boolean) => { await props.api.resolveApproval(callId, allowed); setApprovals(previous => previous.filter(item => item.callId !== callId)); };
  return <div ref={root} className="overlay-ui" aria-live="polite" data-dragging={dragging || undefined}>
    {Object.entries(bubbles).map(([id, bubble]) => bubble && <div key={id} ref={register(`bubble:${id}`)} className={`overlay-bubble bubble-${bubble.kind}`} style={{ ...locationStyle(`bubble:${id}`), borderTopColor: AGENTS[id as AgentId].color }} data-agent={id}>
      {bubble.kind === 'waiting' ? <span className="waiting-dots" aria-label="waiting">…</span> : <span>{wrapBubble(bubble.text, bubble.kind)}</span>}
    </div>)}
    {Object.entries(effects).map(([id, effect]) => effect && <div key={id} className={`overlay-effect effect-${effect.kind}`} style={locationStyle(`effect:${id}`)} aria-label={effect.kind === 'sparkle' ? 'Recall' : effect.label}>{effect.label}</div>)}
    {approvals.map(approval => <ApprovalCard key={approval.callId} approval={approval} style={locationStyle(`card:approval:${approval.callId}`)} register={register(`card:approval:${approval.callId}`)} onDrag={beginDrag(`card:approval:${approval.callId}`, approval.offset, offset => setApprovals(previous => previous.map(item => item.callId === approval.callId ? { ...item, offset } : item)))} onResolve={approve} />)}
    {inspect && <InspectCard key={inspect.agentId} agentId={inspect.agentId} store={props.store} api={props.api} shell={props.shell} style={locationStyle('card:inspect')} register={register('card:inspect')} onClose={() => { setInspect(null); props.hit.remove('card:inspect'); }} onDrag={beginDrag('card:inspect', inspect.offset, offset => setInspect(previous => previous ? { ...previous, offset } : previous))} />}
    {flights.map(flight => <div key={flight.key} className="overlay-flight" style={locationStyle(`flight:${flight.key}`)}>{flight.label}</div>)}
    {replay && <div ref={register('banner:replay')} className="overlay-replay" style={{ left: '50%', transform: 'translateX(-50%)' }}>REPLAY 2×</div>}
  </div>;
};

function without<T>(record: Partial<Record<AgentId, T>>, id: AgentId): Partial<Record<AgentId, T>> { const next = { ...record }; delete next[id]; return next; }

/** A spoken line is shown in full (up to 6 lines); status and warning bubbles stay at 2 short lines. */
export function wrapBubble(text: string, kind: BubbleKind = 'say'): string {
  const maxLines = kind === 'say' ? 6 : 2;
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let cut = false;
  for (const word of words) {
    const last = lines.length - 1;
    if (last >= 0 && lines[last].length + word.length + 1 <= 24) lines[last] += ` ${word}`;
    else if (lines.length < maxLines) lines.push(word.slice(0, 24));
    else { cut = true; break; }
  }
  if (cut && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, 22)}…`;
  return lines.join('\n');
}

/** Long enough to read: about 60 ms a character, between 4 and 12 seconds. */
export const sayBubbleTtl = (text: string) => clamp(2500 + 60 * text.length, 4000, 12000);

function ApprovalCard({ approval, style, register, onDrag, onResolve }: { approval: Approval; style: CSSProperties; register: (element: HTMLElement | null) => void; onDrag: (event: ReactPointerEvent<HTMLElement>) => void; onResolve: (callId: string, allowed: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const act = async (allowed: boolean) => { if (busy) return; setBusy(true); try { await onResolve(approval.callId, allowed); } catch { setBusy(false); } };
  return <section ref={register} className="overlay-card approval-card" style={style} aria-label="Warden approval">
    <header className="card-header" onPointerDown={onDrag}><span className="warden-dot" /> Warden</header>
    <h2>{approval.title}</h2><div className="approval-preview">{approval.preview}</div>
    <div className="card-actions"><button className="allow-button" disabled={busy} onClick={() => void act(true)}>Allow</button><button className="deny-button" disabled={busy} onClick={() => void act(false)}>Deny</button></div>
  </section>;
}

function InspectCard({ agentId, store, api, shell, style, register, onClose, onDrag }: { agentId: AgentId; store: OverlayUiProps['store']; api: OverlayUiProps['api']; shell: OverlayUiProps['shell']; style: CSSProperties; register: (element: HTMLElement | null) => void; onClose: () => void; onDrag: (event: ReactPointerEvent<HTMLElement>) => void }) {
  const row = store(state => state.agents[agentId]);
  const profile = AGENTS[agentId];
  const wakeable = row.presence === 'sleeping' || row.presence === 'docked';
  return <section ref={register} className="overlay-card inspect-card" style={style} aria-label={`${profile.displayName} details`}>
    <header className="card-header" onPointerDown={onDrag}><span className="agent-dot" style={{ background: profile.color }} /> <strong>{profile.displayName}</strong><button className="icon-close" aria-label="Close" onClick={onClose}>×</button></header>
    <p className="agent-role">{profile.role}</p><div className="presence-line">{row.presence.replace('_', ' ')} · {row.status}</div>
    <p className="job-line">{row.job?.title ?? 'No current job'}{row.queued ? ` · ${row.queued} queued` : ''}</p>
    <div className="card-actions inspect-actions">
      {wakeable && <button onClick={() => void api.wakeAgent(agentId)}>Wake</button>}
      <button onClick={() => void api.sleepAgent(agentId)}>Send to Hub</button>
      <button onClick={() => shell.openHubTab('memories', agentId)}>What I remember</button>
    </div>
  </section>;
}

export default OverlayUiLayer;
