/**
 * Chip's terminal harness (Chip spec §6, §17 step 13).
 *   npx tsx scripts/chip-cli.ts [--live] [--demo]
 * Offline (default): fake Backboard brain + fake animals on a FakeClock. No key needed.
 * --live: real Backboard for Chip's brain (needs the S1 client), fake animals, real clock.
 * --demo: demo timers (30 s / 60 s / 20 s).
 * Commands: /ff 10m  /nudge  /jobs  /presence  /scenario C7  /quit
 */
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createInterface } from 'node:readline';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { AgentId } from '../src/shared/agents';
import { AGENTS } from '../src/shared/config';
import type { BiomeEvent } from '../src/shared/events';
import { nameOf } from '../src/main/agents/chipmunk/names';
import { FakeClock, flushPromises, RealClock } from '../src/main/runtime/clock';
import type { LlmClient, LlmResponse, SendParams, SpecialistId } from '../src/main/runtime/types';
import {
  completed, FakeCalendar, FakeLlm, type FakeLlmStep, FakeSpecialists, fakeResult, requiresAction, toolCall,
} from '../src/main/testing';
import { buildOfflineChip, type OfflineChip } from '../src/main/testing/offlineChip';
import { DEMO_TIMERS, makeTestSettings } from '../src/main/testing/settings';

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const LIVE_MODEL = { llm_provider: 'google', model_name: 'gemini-2.5-flash' } as const;

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const DEMO = args.has('--demo');
const VERIFY_LIVE = args.has('--verify-live');

// ── Colors + event lines ──────────────────────────────────

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;
const paint = (code: string, s: string): string => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s);
const dim = (s: string): string => paint('2', s);

const COLORS: Partial<Record<BiomeEvent['type'], string>> = {
  'user.message': '1;37', 'user.mood': '35', 'agent.status': '90', 'agent.mood': '35', 'agent.handoff': '36', 'agent.return': '36',
  'agent.say': '32', 'agent.presence': '34', 'job.update': '33', 'agent.recall': '95', 'nudge.fire': '1;33',
  'wolf.verdict': '31', 'wolf.alert': '1;31', 'approval.request': '1;31', 'approval.resolve': '31',
};

const q = (s: string): string => `"${s}"`;

/** One line per event. Privacy: titles, counts and short text only; never tool args or artifact data. */
function detail(e: BiomeEvent): string {
  switch (e.type) {
    case 'user.message': return q(e.text);
    case 'user.mood': return `${e.mood} ${e.intensity}${e.reason ? ` (${e.reason})` : ''}`;
    case 'agent.status': return `${e.status}${e.detail ? ` ${q(e.detail)}` : ''}`;
    case 'agent.mood': return `${e.mood} ${e.intensity} ← ${e.cause}`;
    case 'agent.handoff': return `→ ${e.to} ${q(e.task)}${e.via ? ` via ${e.via} 🐜` : ''}`;
    case 'agent.return': return `→ ${e.to} ${e.ok ? 'ok' : 'FAILED'} ${q(e.summary)}`;
    case 'agent.say': return `${q(e.text)}  [${e.bubble}] (${e.priority})`;
    case 'agent.presence': return `${e.presence} (${e.reason})`;
    case 'job.update': return `→ ${e.to} ${e.state}${e.position !== undefined ? ` #${e.position}` : ''} ${q(e.title)}`;
    case 'agent.recall': return `${e.memories.length} memories`;
    case 'nudge.fire': return `${e.kind} ${q(e.about)}`;
    case 'tool.request': return `${e.tool} (${e.risk})`;
    case 'wolf.verdict': return `${e.verdict} ${e.rule}`;
    case 'wolf.alert': return `${e.source}: ${e.reason}`;
    case 'approval.request': return q(e.title);
    case 'approval.resolve': return e.approved ? 'approved' : 'declined';
    case 'tool.result': return `${e.ok ? 'ok' : 'failed'} ${q(e.summary)}`;
    case 'artifact': return `${e.kind} ${q(e.title)}`;
  }
}

function formatEvent(e: BiomeEvent, startTs: number): string {
  const t = `+${((e.ts - startTs) / SEC).toFixed(1)}s`.padEnd(9);
  const line = `${t}${e.type.padEnd(15)}${e.agentId.padEnd(12)}${detail(e)}`;
  return paint(COLORS[e.type] ?? '0', line);
}

function attachPrinter(chip: OfflineChip, startTs: number, out: (s: string) => void): () => void {
  return chip.bus.subscribe((e) => out(formatEvent(e, startTs)));
}

// ── The offline brain: small talk, keyword delegation, summaries ──

const THREAD = 'cli-thread';
const PLAN = '1. Archie [beaver]: read the notes on the desktop. 2. Scout [eagle]: find 3 sources. 3. Pixel [workspace]: draft the report.';

const CANNED: Record<SpecialistId, { say: string; bubble: string; summary: string }> = {
  workspace: { say: 'Five letters worth reading!', bubble: '5 emails 📬', summary: 'Five emails today. Prof Lee moved the quiz to Monday.' },
  beaver: { say: 'Found your files!', bubble: 'Files 🪵', summary: 'Found 3 files: notes.txt, syllabus.pdf and budget.xlsx.' },
  eagle: { say: 'Found three good options!', bubble: 'Intel 🦅', summary: "Top picks: Tony's (4.6 stars), Slice Bros, Pie Hole." },
  ants: { say: 'Your plan is ready!', bubble: 'Plan 🐜', summary: PLAN },
  butterfly: { say: 'Posts are drafted!', bubble: 'Drafts 🦋', summary: 'Two post drafts are ready.' },
  nightingale: { say: 'Something soothing is queued!', bubble: 'Music 🎵', summary: 'A calm playlist is ready.' },
};

const words = (s: string, n: number): string => s.trim().split(/\s+/).slice(0, n).join(' ');
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const reply = (bubble: string, speech: string): string => `[bubble: ${bubble}]\n${speech}`;

interface Delegation { agent: SpecialistId; title: string; task: string; planStep?: number }

/** Enough of a brain to demo the flow without a key. One Chip turn at a time, so one pending final answer is enough. */
class OfflineBrain implements LlmClient {
  private pending = '(silent)';

  async send(p: SendParams): Promise<LlmResponse> {
    const c = p.content;
    if (c.startsWith('[job_results]')) return this.resultTurn(c);
    if (c.startsWith('[nudge]')) {
      const question = /suggested question: (.*)/.exec(c)?.[1] ?? 'How are you doing?';
      return completed(reply('Hey!', question), THREAD);
    }
    return this.userTurn(/\[user\]\n([\s\S]*)$/.exec(c)?.[1]?.trim() ?? '');
  }

  async submitToolOutputs(): Promise<LlmResponse> {
    const text = this.pending;
    this.pending = '(silent)';
    return completed(text, THREAD);
  }

  private userTurn(text: string): LlmResponse {
    const lower = text.toLowerCase();
    const letters = text.replace(/[^A-Za-z]/g, '');
    const shouting = letters.length >= 8 && letters === letters.toUpperCase();
    const userMood = shouting ? toolCall('report_user_mood', { mood: 'angry', intensity: 0.9, reason: 'all caps' })
      : /thank|great|awesome|love/.test(lower) ? toolCall('report_user_mood', { mood: 'happy', intensity: 0.5, reason: 'friendly words' })
        : toolCall('report_user_mood', { mood: 'calm', intensity: 0.3, reason: 'plain words' });

    const jobs: Delegation[] = [];
    /** The first few words after the keyword, as a short Hub title ("pizza near campus"). */
    const topicAfter = (keyword: RegExp): string =>
      cap(words(lower.replace(keyword, '').replace(/\s+and\b.*$/, '').replace(/[?.!,]/g, ''), 4));
    if (/\bplan\b/.test(lower)) {
      jobs.push({ agent: 'ants', title: `Plan: ${topicAfter(/^.*?\bplan\s+(?:for\s+)?/) || 'your goal'}`, task: text });
    } else {
      if (/e-?mails?|inbox/.test(lower)) jobs.push({ agent: 'workspace', title: "Today's inbox", task: text });
      if (/\bfiles?\b|folders?|downloads?/.test(lower)) jobs.push({ agent: 'beaver', title: 'Find files', task: text });
      else if (/\b(find|search|look up|research)\b/.test(lower)) {
        jobs.push({ agent: 'eagle', title: topicAfter(/^.*?\b(?:find|search(?: for)?|look up|research)\s+/) || 'Web search', task: text });
      }
    }

    if (jobs.length === 0) {
      this.pending = /^(hi|hello|hey)\b/.test(lower) ? reply('Hi!', "Hey there! I'm Chip. What are we up to today?")
        : /thank|great/.test(lower) ? reply('Anytime!', "Anytime! I'm glad that's better.")
          : reply('Hmm', 'Tell me more! I can check your email, find files, search the web, or plan your day.');
      return requiresAction([userMood], THREAD);
    }
    this.pending = '(silent)';                                   // the ack already told the user
    return requiresAction([userMood, ...jobs.map(delegateCall)], THREAD);
  }

  private resultTurn(content: string): LlmResponse {
    const body = content.slice(0, content.indexOf('[context]') < 0 ? undefined : content.indexOf('[context]'));
    const items: { agent: string; title: string; ok: boolean; summary: string }[] = [];
    for (const m of body.matchAll(/^- \S+ \[(\w+)\] · "(.*)" · (ok|failed)\n\s+summary: (.*)$/gm)) {
      items.push({ agent: m[1]!, title: m[2]!, ok: m[3] === 'ok', summary: m[4]! });
    }

    const plan = items.find((i) => i.agent === 'ants' && i.ok && i.title.startsWith('Plan:'));
    if (plan) {
      const steps: Delegation[] = [];
      for (const m of plan.summary.matchAll(/(\d+)\.\s*\w+ \[(\w+)\]:\s*([^.]*)\./g)) {
        const agent = m[2] as SpecialistId;
        if (agent in AGENTS) steps.push({ agent, planStep: Number(m[1]), title: cap(words(m[3]!, 4)), task: m[3]! });
      }
      if (steps.length > 0) {
        this.pending = reply('Plan rolling 🐜', "Swarm made a plan. Everyone's on it!");
        return requiresAction(steps.map(delegateCall), THREAD);
      }
    }

    const speech = items.length === 0 ? 'Your animals are back.'
      : items.map((i) => (i.ok ? `${nameOf(i.agent as AgentId)} is back. ${i.summary}` : `${nameOf(i.agent as AgentId)} hit a problem. ${i.summary}`)).join(' ');
    return completed(reply(items.length === 1 ? `${nameOf(items[0]!.agent as AgentId)} ✓` : 'All back ✓', speech), THREAD);
  }
}

function delegateCall(d: Delegation) {
  return toolCall('delegate', { agent: d.agent, task: d.task, title: d.title, ...(d.planStep !== undefined ? { plan_step: d.planStep } : {}) });
}

// ── Stack ─────────────────────────────────────────────────

interface Stack { chip: OfflineChip; clock: FakeClock | RealClock; startTs: number; fake: FakeClock | null }

function specialistsFor(clock: FakeClock | RealClock): FakeSpecialists {
  const specialists = new FakeSpecialists({ clock });
  for (const [agent, c] of Object.entries(CANNED) as [SpecialistId, (typeof CANNED)[SpecialistId]][]) {
    specialists.setBehavior(agent, () => fakeResult(agent, { say: c.say, bubble: c.bubble, summary: c.summary }));
  }
  return specialists;
}

/** Loads `.env` with a tiny parser. Never prints values. Existing process.env keys win. */
function loadEnv(): void {
  const file = fileURLToPath(new URL('../.env', import.meta.url));
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(raw);
    if (!m || m[1]!.startsWith('#')) continue;
    const value = m[2]!.replace(/^(["'])(.*)\1$/, '$2');
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = value;
  }
}

type BackboardModule = {
  BackboardClient?: new (opts: { apiKey: string }) => LlmClient;
  createBackboardClient?: (opts: { apiKey: string }) => LlmClient;
};

/** The real Backboard client (Shafeen's S1), imported dynamically so this script runs before it exists. */
async function loadLiveLlm(): Promise<LlmClient> {
  const file = fileURLToPath(new URL('../src/main/runtime/backboard.ts', import.meta.url));
  if (!existsSync(file)) {
    console.error('Backboard client not merged yet (sponsor kit)');
    process.exit(1);
  }
  loadEnv();
  const apiKey = process.env.BACKBOARD_API_KEY;
  const assistantId = process.env.BB_ASSISTANT_CHIPMUNK;
  if (!apiKey || !assistantId) {
    console.error('Missing BACKBOARD_API_KEY or BB_ASSISTANT_CHIPMUNK (set them in .env).');
    process.exit(1);
  }

  const specifier = '../src/main/runtime/backboard';
  const mod = (await import(specifier)) as BackboardModule;
  const real = mod.BackboardClient ? new mod.BackboardClient({ apiKey })
    : mod.createBackboardClient ? mod.createBackboardClient({ apiKey }) : undefined;
  if (!real) {
    console.error('backboard.ts exports neither BackboardClient nor createBackboardClient.');
    process.exit(1);
  }
  // The offline stack uses a placeholder assistant id; point every request at Chip's real assistant.
  const trace = (stage: string, response: LlmResponse): LlmResponse => {
    if (VERIFY_LIVE) console.log(`BACKBOARD ${stage}: ${response.status}; tools=${response.tool_calls?.map((c) => c.function.name).join(',') || 'none'}`);
    return response;
  };
  return {
    send: async (p) => trace('send', await real.send({ ...p, assistantId })),
    submitToolOutputs: async (threadId, outputs, signal) => trace('continue', await real.submitToolOutputs(threadId, outputs, signal)),
  };
}

function buildStack(llm: LlmClient, plannerLlm: LlmClient | undefined): Stack {
  const fake = LIVE ? null : new FakeClock(Date.now());
  const clock = fake ?? new RealClock();
  const settings = makeTestSettings(LIVE
    ? { models: Object.fromEntries(Object.keys(AGENTS).map((id) => [id, LIVE_MODEL])) as ReturnType<typeof makeTestSettings>['models'] }
    : {});
  const chip = buildOfflineChip({
    clock, llm, specialists: specialistsFor(clock), calendar: new FakeCalendar(clock),
    settings: DEMO ? makeTestSettings({ ...settings, timers: DEMO_TIMERS, demoMode: true }) : settings,
    ...(plannerLlm ? { plannerLlm } : {}),
    ...(VERIFY_LIVE ? { startNudges: false } : {}),
  });
  return { chip, clock, startTs: clock.now(), fake };
}

// ── Scenarios (/scenario C7): the §19 scripts, run and printed (the asserted versions are tests/scenarios) ──

type Step = string | { ff: string } | ((chip: OfflineChip) => void | Promise<void>);
interface Scenario {
  title: string;
  script: FakeLlmStep[];
  steps: Step[];
  start?: Date;
  delayMs?: number | Partial<Record<SpecialistId, number>>;
  nudges?: boolean;
  plannerLlm?: LlmClient;
  setup?: (chip: OfflineChip) => void;
}

const mood = (m: string, i = 0.4, reason = 'plain words') => toolCall('report_user_mood', { mood: m, intensity: i, reason });
const delegate = (agent: SpecialistId, title: string, extra: Record<string, unknown> = {}) =>
  toolCall('delegate', { agent, task: `Please do: ${title}`, title, ...extra });
const tools = (...calls: ReturnType<typeof toolCall>[]) => requiresAction(calls);
const say = (bubble: string, speech: string) => completed(reply(bubble, speech));
const silent = () => completed('(silent)');

const NOON = new Date(2026, 9, 4, 12, 0);

function plannerFor(askAt: Date): LlmClient {
  return {
    async send() {
      return completed(JSON.stringify({ nudges: [{ eventId: 'ev-midterm', kind: 'after', askAt: askAt.toISOString(), question: 'How did the midterm go?', about: 'CS 280 midterm' }] }));
    },
    async submitToolOutputs() {
      throw new Error('the planner never uses tools');
    },
  };
}

const SCENARIOS: Record<string, Scenario> = {
  C1: { title: 'Small talk', script: [tools(mood('happy', 0.6)), say('Hi!', "Hey there! I'm Chip. What are we up to today?")], steps: ['hi chip!'] },
  C2: {
    title: '"What emails today?"',
    script: [tools(mood('calm'), delegate('workspace', "Today's inbox")), silent(), say('5 emails 📬', 'Five emails matter. Prof Lee moved the quiz to Monday.')],
    steps: ['what emails did I get today?', { ff: '5s' }],
  },
  C3: {
    title: 'Pizza running, then "check my email"', delayMs: { eagle: 10 * SEC },
    script: [tools(mood('calm'), delegate('eagle', 'Pizza near campus')), silent(), tools(mood('calm'), delegate('workspace', "Today's inbox")), silent(),
      say('5 emails 📬', 'Five emails today.'), say('Pizza 🍕', "Tony's is closest.")],
    steps: ['find pizza near campus', { ff: '2s' }, 'oh and check my email', { ff: '15s' }],
  },
  C4: {
    title: 'Second research while Scout is busy', delayMs: { eagle: 10 * SEC },
    script: [tools(mood('calm'), delegate('eagle', 'Pizza near campus')), silent(), tools(mood('calm'), delegate('eagle', 'Coffee near campus')), silent(),
      say('Pizza 🍕', "Tony's is closest."), say('Coffee ☕', 'Bean Counter opens at seven.')],
    steps: ['find pizza near campus', { ff: '2s' }, 'also find coffee near campus', { ff: '25s' }],
  },
  C5: {
    title: 'Same pizza request twice', delayMs: { eagle: 30 * SEC },
    script: [tools(mood('calm'), delegate('eagle', 'Pizza near campus')), silent(), tools(mood('calm'), delegate('eagle', 'pizza near campus!')), silent()],
    steps: ['find pizza near campus', { ff: '2s' }, 'find pizza near campus', { ff: '1s' }],
  },
  C6: {
    title: 'Research internships, then draft an email to Melvin',
    script: [
      tools(mood('excited', 0.6), delegate('eagle', 'Internship research', { next_step: 'draft email to Melvin with the list' })), silent(),
      tools(toolCall('delegate', { agent: 'workspace', title: 'Email to Melvin', task: 'Draft an email to Melvin listing the internships Scout found.' })),
      say('Drafting ✍️', "Scout found three. Pixel's drafting the email to Melvin."),
      say('Draft ready', "It's in your Drafts. You hit send."),
    ],
    steps: ['research internships, then draft an email to Melvin', { ff: '10s' }, { ff: '10s' }],
  },
  C7: {
    title: 'Pixel asks Archie for help while Archie is busy', delayMs: { beaver: 5 * SEC, workspace: 1 * SEC },
    script: [tools(mood('calm'), delegate('beaver', 'Organize downloads')), silent(), tools(mood('calm'), delegate('workspace', 'Email with syllabus')), silent(),
      say('Tidy 🪵', 'Archie organized your downloads.'), say('Sent along', 'Pixel found the syllabus and drafted the email.')],
    setup(chip) {
      chip.specialists.setBehavior('workspace', async (_task, ctx) => {
        const help = chip.jobs.submit({ agent: 'beaver', task: 'Find the syllabus PDF', title: 'Find syllabus', requestedBy: 'workspace', kind: 'help', parentTaskId: ctx.taskId });
        const res = await chip.jobs.waitFor(help.jobId!);
        return fakeResult('workspace', { summary: `Drafted the email with the syllabus. ${res.summary}` });
      });
    },
    steps: ['organize my downloads', { ff: '1s' }, 'email Prof Lee my syllabus', { ff: '12s' }],
  },
  C8: {
    title: '"Stop Scout"', delayMs: { eagle: 60 * SEC, workspace: 5 * SEC },
    script: [tools(mood('calm'), delegate('eagle', 'Pizza near campus'), delegate('workspace', "Today's inbox")), silent(), say('5 emails 📬', 'Five emails today.')],
    steps: ['find pizza near campus and check my email', { ff: '2s' }, 'Stop Scout', { ff: '10s' }],
  },
  C9: { title: 'Fast-forward sleepAfter, then dockAfter', script: [], steps: [{ ff: '3m' }, { ff: '10m' }] },
  C10: {
    title: 'Delegate to docked Swarm',
    script: [tools(mood('calm'), delegate('ants', 'Plan the week')), silent(), say('Planned 🐜', 'Swarm mapped out your week.')],
    steps: [{ ff: '13m' }, 'plan my week', { ff: '6s' }],
  },
  C11: {
    title: 'A job waits 4 min on a Warden approval (clock paused)', delayMs: { workspace: 1 * SEC },
    script: [tools(mood('calm'), delegate('workspace', 'Add study group')), silent(), say('Added 📅', 'Study group is on your calendar for Sunday.')],
    setup(chip) {
      chip.specialists.setBehavior('workspace', async (_task, ctx) => {
        chip.bus.emit({ type: 'approval.request', agentId: 'wolf', taskId: ctx.taskId, callId: 'call-1', title: 'Create event', preview: 'no invites sent' });
        chip.jobs.pauseClock(ctx.jobId);
        await new Promise<void>((resolve) => { chip.clock.setTimeout(resolve, 4 * MIN); });
        chip.jobs.resumeClock(ctx.jobId);
        chip.bus.emit({ type: 'approval.resolve', agentId: 'wolf', taskId: ctx.taskId, callId: 'call-1', approved: true });
        return fakeResult('workspace', { say: 'Event added!', bubble: 'Added 📅', summary: "Added 'Study group' to Sunday 3 PM." });
      });
    },
    steps: ['add study group to my calendar on Sunday at 3', { ff: '5m' }],
  },
  C12: {
    title: 'Midterm ends; fast-forward 1 h', nudges: true, plannerLlm: plannerFor(new Date(2026, 9, 4, 13, 5)),
    script: [say('Morning ☀️', 'Morning! Want the rundown for today?'), say('Midterm 📝', 'How did the midterm go?')],
    steps: [{ ff: '1h' }, { ff: '10m' }],
  },
  C13: {
    title: 'A nudge due 11:30 PM is held until 8 AM', nudges: true, start: new Date(2026, 9, 4, 23, 10),
    script: [say('Morning ☀️', 'Morning! Two quick things. Want the rundown, and how did the interview go?')],
    setup(chip) {
      chip.nudges.schedule({ kind: 'custom', source: 'chip', about: 'Google interview', question: 'How did the interview go?', askAt: new Date(2026, 9, 4, 23, 30) });
    },
    steps: [{ ff: '9h' }],
  },
  C14: { title: 'Shouting', script: [tools(mood('angry', 0.9, 'all caps')), say('Easy', 'I hear you. Let me look into it right now.')], steps: ['THIS IS SO ANNOYING NOTHING WORKS', { ff: '25s' }] },
  C15: {
    title: '"ok thanks, that\'s better" right after C14',
    script: [tools(mood('angry', 0.9, 'all caps')), say('Easy', 'I hear you. Looking now.'), tools(mood('calm', 0.3, 'relieved')), say('Phew', "Glad that's better!")],
    steps: ['THIS IS SO ANNOYING NOTHING WORKS', { ff: '3s' }, "ok thanks, that's better", { ff: '5s' }],
  },
  C16: { title: 'Unclear "send that to them"', script: [tools(mood('calm', 0.3)), say('Which one?', 'Send what, and to whom?')], steps: ['send that to them'] },
  C17: {
    title: 'Backboard down',
    script: [new Error('Backboard unreachable'), tools(mood('happy', 0.5)), say('Back!', 'Okay, I hear you now.')],
    steps: ['hello?', 'hello again'],
  },
  C18: {
    title: '"What did you do for me today?"',
    script: [
      tools(mood('happy', 0.5)), say('Hi!', 'Hey there!'),
      tools(mood('calm'), delegate('workspace', "Today's inbox")), silent(), say('Inbox 📬', 'Five emails, nothing urgent.'),
      tools(mood('calm'), toolCall('biome_history', { kind: 'recent_tasks', since_hours: 24 })),
      say('Recap', 'We said hi, then Pixel checked your email. Five emails, nothing urgent.'),
    ],
    steps: ['hi chip!', 'check my email', { ff: '5s' }, 'What did you do for me today?'],
  },
  C19: {
    title: '"Turn the notes on my desktop into a report with 3 sources"',
    script: [
      tools(mood('calm', 0.4, 'a big ask'), delegate('ants', 'Plan: notes into report')), silent(),
      tools(
        toolCall('delegate', { agent: 'beaver', title: 'Read desktop notes', task: 'Read the notes on the desktop.', plan_step: 1 }),
        toolCall('delegate', { agent: 'eagle', title: 'Find three sources', task: 'Find 3 sources on the topic.', plan_step: 2 }),
        toolCall('delegate', { agent: 'workspace', title: 'Draft the report', task: 'Draft the report with the sources.', plan_step: 3 }),
      ),
      say('Plan rolling 🐜', 'Swarm made the plan. Archie, Scout, and Pixel are on it.'),
      say('Report ready', 'The report draft is ready, with three sources.'),
    ],
    steps: ['turn the notes on my desktop into a report with 3 sources', { ff: '6s' }, { ff: '6s' }],
  },
};

function parseDuration(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(text.trim());
  if (!m) return null;
  const unit = (m[2] ?? 's').toLowerCase();
  return Number(m[1]) * (unit === 'ms' ? 1 : unit === 's' ? SEC : unit === 'm' ? MIN : HOUR);
}

async function runScenario(id: string, out: (s: string) => void): Promise<void> {
  const sc = SCENARIOS[id.toUpperCase()];
  if (!sc) {
    out(`Unknown scenario "${id}". Try ${Object.keys(SCENARIOS).join(', ')}.`);
    return;
  }
  const clock = new FakeClock(sc.start ?? NOON);
  const chip = buildOfflineChip({
    clock, llm: new FakeLlm(sc.script), specialists: new FakeSpecialists({ clock, delayMs: sc.delayMs ?? 3 * SEC }),
    startNudges: sc.nudges ?? false, ...(sc.plannerLlm ? { plannerLlm: sc.plannerLlm } : {}),
  });
  const detach = attachPrinter(chip, clock.now(), out);
  out(dim(`── ${id.toUpperCase()}: ${sc.title}`));
  try {
    sc.setup?.(chip);
    for (const step of sc.steps) {
      if (typeof step === 'string') {
        out(dim(`you> ${step}`));
        chip.orchestrator.submitUserMessage(step);
        await chip.orchestrator.whenIdle();
      } else if (typeof step === 'function') {
        await step(chip);
      } else {
        const ms = parseDuration(step.ff) ?? 0;
        out(dim(`(fast-forward ${step.ff})`));
        await clock.advanceAsync(ms);
        await chip.orchestrator.whenIdle();
      }
    }
  } finally {
    detach();
    chip.dispose();
  }
  out(dim(`── end of ${id.toUpperCase()}`));
}

// ── REPL ──────────────────────────────────────────────────

/** Real Chip calls, fake animals. Hold Scout until Pixel starts so API latency cannot hide overlap. */
async function verifyLive(stack: Stack): Promise<void> {
  const { chip } = stack;
  const events: BiomeEvent[] = [];
  const unsubscribe = chip.bus.subscribe((event) => events.push(event));
  let releaseScout = (): void => {};
  const scoutHeld = new Promise<void>((resolve) => { releaseScout = resolve; });
  let current = 'C1';
  const healthy = (): void => {
    assert(!events.some((e) => e.type === 'agent.status' && e.status === 'error'), 'Chip emitted an error');
    assert(!events.some((e) => e.type === 'job.update' && ['failed', 'cancelled'].includes(e.state)), 'A job failed or was cancelled');
  };
  const waitUntil = async (condition: () => boolean, why: string): Promise<void> => {
    const deadline = Date.now() + 60_000;
    while (!condition()) {
      healthy();
      assert(Date.now() < deadline, why);
      await sleep(50);
    }
    healthy();
  };
  const send = async (text: string): Promise<string> => {
    chip.orchestrator.submitUserMessage(text);
    await chip.orchestrator.whenIdle();
    healthy();
    const user = events.findLast((e) => e.type === 'user.message');
    assert(user?.taskId, 'Missing user task');
    return user.taskId;
  };
  const jobFor = (taskId: string, agent: SpecialistId) => {
    const job = chip.jobs.list().find((j) => j.parentTaskId === taskId && j.agent === agent);
    assert(job, `No ${agent} delegation for the current request`);
    return job;
  };
  const reported = (taskId: string, agent: SpecialistId, evidence: RegExp): boolean => {
    const returned = events.find((e) => e.type === 'agent.return' && e.agentId === agent && e.taskId === taskId);
    if (!returned) return false;
    const resultTurn = events.find((e) => e.type === 'agent.status' && e.agentId === 'chipmunk'
      && e.taskId === taskId && e.status === 'thinking' && e.ts >= returned.ts);
    return !!resultTurn && events.some((e) => e.type === 'agent.say' && e.agentId === 'chipmunk'
      && e.taskId === taskId && e.priority === 'chip' && e.ts >= resultTurn.ts && evidence.test(e.text));
  };
  try {
    const greeting = await send('hi chip!');
    assert.equal(chip.jobs.list().length, 0, 'Small talk started a job');
    // Chip's own tools emit no tool.request events (those are for specialist tools going through Warden).
    // A real mood read is a user.mood event the orchestrator did NOT synthesize: its fallback reasons are
    // 'no mood reported' and 'voice cue ...'.
    assert(events.some((e) => e.type === 'user.mood' && e.taskId === greeting
      && !/^(no mood reported|voice cue)/.test(e.reason)), 'Chip did not call the mood tool (only the fallback mood was recorded)');
    assert(events.some((e) => e.type === 'agent.say' && e.taskId === greeting && e.priority === 'chip'
      && !/couldn't finish|foggy/i.test(e.text)), 'Missing successful small-talk reply');
    console.log('PASS C1: small talk, mood, speech, no jobs');

    current = 'C2';
    const email = await send('what emails did I get today?');
    const pixel = jobFor(email, 'workspace');
    await waitUntil(() => jobFor(email, 'workspace').state === 'done' && reported(email, 'workspace', /five|email|quiz/i), 'Missing Pixel result or result-turn summary grounded in its fixture result');
    const sequence = events.filter((e) => e.taskId === email);
    assert(sequence.some((e) => e.type === 'agent.say' && e.priority === 'ack'), 'Missing delegation acknowledgement');
    assert(sequence.some((e) => e.type === 'agent.say' && e.agentId === 'workspace' && e.priority === 'report'), 'Missing Pixel report');
    const returned = sequence.findIndex((e) => e.type === 'agent.return');
    assert(!sequence.slice(0, returned).some((e) => e.type === 'agent.say' && e.agentId === 'chipmunk' && e.priority === 'chip'), 'Chip spoke in the user tool loop instead of waiting for the job result');
    await chip.orchestrator.whenIdle();
    console.log('PASS C2: acknowledgement, fake Pixel report, delayed Chip summary');

    current = 'C3';
    chip.specialists.setBehavior('eagle', async () => {
      await scoutHeld;
      return fakeResult('eagle', CANNED.eagle);
    });
    const pizza = await send('Find pizza near the University of Michigan-Dearborn campus.');
    const scout = jobFor(pizza, 'eagle');
    assert.equal(scout.state, 'running', 'Scout must be running before the follow-up');
    const followup = await send('oh and check my email');
    const parallelPixel = jobFor(followup, 'workspace');
    const pixelStart = events.find((e) => e.type === 'job.update' && e.jobId === parallelPixel.jobId && e.state === 'running');
    assert(pixelStart, 'Pixel did not start');
    assert.equal(jobFor(pizza, 'eagle').state, 'running', 'Scout stopped before Pixel started');
    assert(!events.some((e) => e.type === 'job.update' && e.jobId === parallelPixel.jobId && e.state === 'queued'), 'Pixel was queued');
    assert.equal(chip.jobs.list().filter((j) => j.agent === 'eagle').length, 1, 'Scout was delegated twice');
    console.log(`OVERLAP: Scout started +${((scout.startedAt! - stack.startTs) / SEC).toFixed(1)}s; Pixel started +${((pixelStart.ts - stack.startTs) / SEC).toFixed(1)}s while Scout was running`);
    releaseScout();
    await waitUntil(() => jobFor(pizza, 'eagle').state === 'done' && jobFor(followup, 'workspace').state === 'done'
      && reported(pizza, 'eagle', /tony|slice|pie|pizza/i) && reported(followup, 'workspace', /five|email|quiz/i), 'Missing parallel result or result-turn summary grounded in its fixture result');
    await chip.orchestrator.whenIdle();
    healthy();
    console.log('PASS C3: Pixel started alongside Scout; both finished and Chip summarized');
  } catch (error) {
    console.error(`FAIL ${current}: ${error instanceof Error ? error.message : 'verification failed'}`);
    process.exitCode = 1;
  } finally {
    releaseScout();
    unsubscribe();
    chip.dispose();
  }
}

const HELP = [
  'Type to talk to Chip. Commands:',
  '  /ff 10m      fast-forward the fake clock (30s, 2h, ...; offline only)',
  '  /nudge       fire the next nudge now',
  '  /jobs        list jobs',
  '  /presence    who is active, sleeping or docked',
  '  /scenario C7 run one of the §19 scenarios on a fresh stack',
  '  /quit        exit',
].join('\n');

async function main(): Promise<void> {
  if (VERIFY_LIVE && !LIVE) throw new Error('--verify-live requires --live; /scenario always uses the offline brain.');
  const llm = LIVE ? await loadLiveLlm() : new OfflineBrain();
  const out = (s: string): void => console.log(s);
  const stack = buildStack(llm, LIVE ? llm : undefined);
  const { chip } = stack;
  attachPrinter(chip, stack.startTs, out);

  if (VERIFY_LIVE) {
    out('Verifying C1-C3: LIVE Backboard, real clock, fake Pixel/Scout, nudges disabled.');
    return verifyLive(stack);
  }

  out(dim(`Chip CLI · ${LIVE ? 'LIVE Backboard (real clock, fake animals)' : 'offline (fake brain, fake clock)'}${DEMO ? ' · demo timers' : ''}`));
  out(dim(HELP));

  let quitting = false;
  const quit = (): void => {
    if (quitting) return;
    quitting = true;
    chip.dispose();
    process.exit(0);
  };
  process.on('SIGINT', quit);

  const settle = async (): Promise<void> => {
    await flushPromises();
    await chip.orchestrator.whenIdle();
  };

  async function command(line: string): Promise<void> {
    const [cmd = '', ...rest] = line.slice(1).trim().split(/\s+/);
    switch (cmd.toLowerCase()) {
      case 'ff': {
        if (!stack.fake) return out('The real clock can\'t be fast-forwarded; /ff is offline only.');
        const ms = parseDuration(rest.join(' '));
        if (ms === null) return out('Usage: /ff 10m   (also 30s, 2h, 500ms)');
        await stack.fake.advanceAsync(ms);
        return chip.orchestrator.whenIdle();
      }
      case 'nudge':
        chip.nudges.fireNextNow();
        return settle();
      case 'jobs': {
        const list = chip.jobs.list();
        if (list.length === 0) return out('(no jobs)');
        for (const j of list) {
          out(`${j.jobId.slice(0, 8)}  ${j.agent.padEnd(12)}${j.state.padEnd(10)}${q(j.title)}  by ${j.requestedBy}${j.kind === 'help' ? ' (help)' : ''}${j.planStep !== undefined ? ` step ${j.planStep}` : ''}${j.position !== undefined ? ` #${j.position}` : ''}`);
        }
        return;
      }
      case 'presence':
        for (const id of Object.keys(AGENTS) as AgentId[]) out(`${id.padEnd(12)}${nameOf(id).padEnd(8)}${chip.presence.get(id)}`);
        return;
      case 'scenario':
        if (!rest[0]) return out(`Usage: /scenario C7   (${Object.keys(SCENARIOS).join(', ')})`);
        return runScenario(rest[0], out);
      case 'help':
        return out(HELP);
      case 'quit':
      case 'exit':
        return quit();
      default:
        return out(`Unknown command /${cmd}. Try /help.`);
    }
  }

  const rl = createInterface({ input: process.stdin, ...(process.stdin.isTTY ? { output: process.stdout, prompt: 'you> ' } : {}) });
  rl.on('SIGINT', quit);
  if (process.stdin.isTTY) rl.prompt();

  for await (const raw of rl) {
    const line = raw.trim();
    try {
      if (line.startsWith('/')) await command(line);
      else if (line) {
        chip.orchestrator.submitUserMessage(line);
        await chip.orchestrator.whenIdle();
      }
    } catch (err) {
      out(paint('1;31', `error: ${err instanceof Error ? err.message : String(err)}`));
    }
    if (process.stdin.isTTY) rl.prompt();
  }

  // stdin closed (piped input): let live jobs and their result turns finish before leaving.
  if (LIVE) {
    for (let waited = 0; waited < 2 * MIN; waited += 250) {
      await chip.orchestrator.whenIdle();
      if (!chip.jobs.list().some((j) => j.state === 'running' || j.state === 'queued')) break;
      await sleep(250);
    }
    await sleep(2 * SEC);
  }
  await chip.orchestrator.whenIdle();
  quit();
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
