import type { BiomeEvent } from '../../../shared/events';
import type { AgentId } from '../../../shared/agents';

/** Sounds emitted for event transitions; every ID is present in resources/sfx/manifest.json. */
export function soundsForEvent(event: BiomeEvent): string[] {
  const id = event.agentId;
  switch (event.type) {
    case 'agent.presence':
      if (event.presence === 'sleeping') return id === 'chipmunk' ? ['chipmunk.snore'] : [];
      if (event.presence === 'docked') return ['system.dock-whoomp'];
      if (event.presence === 'active') return event.reason === 'startup'
        ? (id === 'chipmunk' ? ['chipmunk.chirp'] : id === 'butterfly' ? ['butterfly.flutter-sparkle'] : id === 'nightingale' ? ['nightingale.trill'] : [])
        : ['system.wake-chime'];
      return [];
    case 'agent.status':
      if (event.status === 'error' && id === 'chipmunk') return ['chipmunk.boing'];
      if (event.status === 'working') return id === 'beaver' ? ['beaver.wood-gnaw'] : id === 'workspace' ? ['workspace.blip'] : id === 'ants' ? ['ants.marching-patter'] : [];
      if (event.status === 'done') return id === 'beaver' ? ['beaver.tail-slap'] : id === 'workspace' ? ['workspace.stamp'] : id === 'chipmunk' ? ['chipmunk.happy-trill'] : id === 'eagle' ? ['eagle.screech'] : [];
      if (event.status === 'away' && id === 'eagle') return ['eagle.wing-flaps'];
      if (event.status === 'idle' && id === 'eagle') return ['eagle.screech'];
      return [];
    case 'agent.mood': return id === 'chipmunk' && event.mood === 'scared' ? ['chipmunk.squeak'] : id === 'chipmunk' && event.mood === 'happy' ? ['chipmunk.happy-trill'] : [];
    case 'agent.handoff': return event.via === 'ants' ? ['ants.skitter'] : ['system.scroll-pass'];
    case 'agent.return': return id === 'eagle' ? ['eagle.whoosh'] : [];
    case 'nudge.fire': return ['chipmunk.knock-knock'];
    case 'tool.request': return event.risk === 'read' ? [] : ['wolf.sniff'];
    case 'wolf.verdict': return event.verdict === 'deny' ? ['wolf.growl'] : event.verdict === 'ask' ? ['wolf.paw-thump'] : [];
    case 'wolf.alert': return ['wolf.howl'];
    case 'approval.request': return ['system.approval-ding'];
    case 'artifact': return event.kind === 'file_note' && id === 'beaver' ? ['beaver.paper-rustle', 'system.pop'] : ['system.pop'];
    case 'tool.result': return id === 'beaver' && !event.ok ? ['beaver.reverse-whoosh'] : [];
    default: return [];
  }
}

export function pokeSound(id: AgentId): string { return `${id}.poke`; }
