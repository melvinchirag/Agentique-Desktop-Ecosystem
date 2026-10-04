/** Fixed speech and animation cues. No untrusted event text enters these lines. */
export interface WardenLine {
  text: string;
  bubble: string;
  priority: 'warden' | 'report';
  sfx?: string;
  clip: 'Sit' | 'Nod' | 'Block' | 'Growl' | 'Howl' | 'Greet';
}

export const WARDEN_LINES = {
  ask: { text: 'Need your OK on this one.', bubble: 'Your call 🐺', priority: 'warden', sfx: 'system.approval-ding', clip: 'Sit' },
  askBulk: { text: "That's a big batch. Your call.", bubble: 'Big batch?', priority: 'warden', sfx: 'system.approval-ding', clip: 'Sit' },
  approved: { text: 'Go ahead.', bubble: '✓', priority: 'report', clip: 'Nod' },
  declined: { text: 'Understood. Standing down.', bubble: 'Stopped', priority: 'report', clip: 'Nod' },
  timeout: { text: 'No answer, so no.', bubble: 'Timed out', priority: 'warden', clip: 'Nod' },
  denySend: { text: "I never send. It's in your drafts.", bubble: 'Not sent 🛑', priority: 'warden', sfx: 'wolf.growl', clip: 'Block' },
  denyShare: { text: 'Sharing and buying are your call, not mine.', bubble: 'Blocked 🛑', priority: 'warden', sfx: 'wolf.growl', clip: 'Block' },
  denyPath: { text: "That's outside your safe folders.", bubble: 'Off limits', priority: 'warden', sfx: 'wolf.growl', clip: 'Block' },
  denyProgram: { text: 'No programs. Not on my watch.', bubble: 'No .exe 🛑', priority: 'warden', sfx: 'wolf.growl', clip: 'Block' },
  denyLoop: { text: 'Stop. We already tried that.', bubble: 'Loop 🛑', priority: 'warden', sfx: 'wolf.growl', clip: 'Growl' },
  denyTool: { text: 'Not your tool. Blocked.', bubble: 'Blocked', priority: 'warden', clip: 'Growl' },
  denyLink: { text: "That link's not safe to open.", bubble: 'Bad link 🛑', priority: 'warden', sfx: 'wolf.growl', clip: 'Block' },
  denyAttachment: { text: "Can't attach that file.", bubble: 'No attach', priority: 'warden', clip: 'Growl' },
  denyError: { text: "Something's off. Blocking to be safe.", bubble: 'Blocked', priority: 'warden', clip: 'Growl' },
  injection: { text: "Trick spotted. I've got it.", bubble: 'Trick spotted 🐺', priority: 'warden', sfx: 'wolf.howl', clip: 'Howl' },
  greeting: { text: 'Warden on watch.', bubble: 'On watch', priority: 'report', clip: 'Greet' },
} as const satisfies Record<string, WardenLine>;

export type WardenLineId = keyof typeof WARDEN_LINES;

export type WardenLineTrigger =
  | { kind: 'decision'; verdict: 'allow' | 'ask' | 'deny'; rule: string; tool?: string; reason?: string; count?: number }
  | { kind: 'outcome'; approved: boolean; how?: 'user' | 'timeout' | 'cancelled' }
  | { kind: 'alert'; source: string; reason: string }
  | { kind: 'greeting' };

export interface SelectedWardenLine { id: WardenLineId; line: WardenLine }

const INJECTION_SOURCE = /^(?:email|file|doc|calendar|web|summary):/;
const SHARE_SEGMENT = /(?:^|_)(?:share|purchase|buy|pay|transfer|invite)(?:_|$)/i;

export function lineFor(trigger: WardenLineTrigger): SelectedWardenLine | undefined {
  let id: WardenLineId;
  if (trigger.kind === 'greeting') id = 'greeting';
  else if (trigger.kind === 'outcome') id = trigger.how === 'timeout' ? 'timeout' : trigger.approved ? 'approved' : 'declined';
  else if (trigger.kind === 'alert') {
    // W0 and W9 also emit alerts; their verdict already chose the proper block line.
    if (!INJECTION_SOURCE.test(trigger.source)) return undefined;
    id = 'injection';
  } else {
    if (trigger.verdict === 'allow') return undefined;
    if (trigger.verdict === 'ask') id = trigger.rule === 'W6' ? 'askBulk' : 'ask';
    else {
      switch (trigger.rule) {
        case 'W0': id = 'denyError'; break;
        case 'W1': id = (trigger.tool
          ? SHARE_SEGMENT.test(trigger.tool)
          : /\b(?:shar(?:e|ing)|buy|purchase|pay|transfer|invite)\b/i.test(trigger.reason ?? '')) ? 'denyShare' : 'denySend'; break;
        case 'W5': id = 'denyPath'; break;
        case 'W7': id = 'denyProgram'; break;
        case 'W9': id = 'denyLoop'; break;
        case 'W12': id = 'denyLink'; break;
        case 'W13': id = 'denyAttachment'; break;
        case 'W4': case 'W10': case 'W14': id = 'denyTool'; break;
        default: id = 'denyError';
      }
    }
  }
  const base = WARDEN_LINES[id];
  const line: WardenLine = id === 'askBulk' && trigger.kind === 'decision' && Number.isInteger(trigger.count) && (trigger.count ?? 0) > 0
    ? { ...base, bubble: `${trigger.count} files?` }
    : base;
  return { id, line };
}

/** One item per fixed voice line; variable bubbles are intentionally excluded. */
export function allWardenLines(): { id: WardenLineId; line: WardenLine }[] {
  return (Object.keys(WARDEN_LINES) as WardenLineId[]).map((id) => ({ id, line: WARDEN_LINES[id] }));
}
