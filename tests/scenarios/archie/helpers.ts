import { mkdir, mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import path from 'node:path';
import { createChipCore } from '../../../src/main/chipCore';
import { FileIndex } from '../../../src/main/connectors/fs/fileIndex';
import { LocalFileOpsJournal } from '../../../src/main/connectors/fs/localJournal';
import { FakeClock, flushPromises } from '../../../src/main/runtime/clock';
import { FakeCalendar } from '../../../src/main/testing/fakeCalendar';
import { FakeFsShell } from '../../../src/main/testing/fakeFsShell';
import { FakeLlm, completed, requiresAction, toolCall, type FakeLlmStep } from '../../../src/main/testing/fakeLlm';
import { FakeSpecialists } from '../../../src/main/testing/fakeSpecialists';
import { makeTestSettings } from '../../../src/main/testing/settings';
import { makeSandbox } from '../../fixtures/makeSandbox';
import { AskingWardenGate, ScriptedApprovals, type Decision } from './approvals';
import type { ArchieContext } from '../../../src/main/chipCore';
import type { Approvals } from '../../../src/main/runtime/types';

export type DocumentCall =
  | { kind: 'upload'; threadId: string; path: string }
  | { kind: 'index'; documentId: string; timeoutMs: number };

async function age(dir: string, timestamp: number, fresh: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) await age(name, timestamp, fresh);
    else if (name !== fresh) await utimes(name, new Date(timestamp), new Date(timestamp));
  }
}

/** Every Archie scenario gets a disposable fixture, two independent scripted brains, and the real Chip-to-job route. */
export async function makeArchieScenario(
  archieScript: FakeLlmStep[], decisions: Decision[] = [],
  restart?: { parent: string; fixture: Awaited<ReturnType<typeof makeSandbox>>; clock: FakeClock; mode?: 'standin' | 'real' },
  mode: 'standin' | 'real' = restart?.mode ?? 'standin',
) {
  // The fixture lives only under this workspace-owned temporary directory. Windows' OS temp
  // is inside AppData, which the real Warden correctly protects even for test requests.
  const fixtureBase = path.resolve('integration/.warden-fixture-temp');
  if (!restart) await mkdir(fixtureBase, { recursive: true });
  const parent = restart?.parent ?? await mkdtemp(path.join(fixtureBase, 'ade-archie-i-'));
  const relativeParent = path.relative(fixtureBase, parent);
  if (!relativeParent.startsWith('ade-archie-i-') || relativeParent.includes(path.sep) || relativeParent.startsWith('..')) {
    throw new Error('Fixture parent is outside the workspace temporary directory');
  }
  const clock = restart?.clock ?? new FakeClock(Date.UTC(2026, 9, 4, 12));
  const fixture = restart?.fixture ?? await makeSandbox(parent, clock.now());
  if (!restart) await age(fixture.root, clock.now() - 24 * 60 * 60_000, fixture.freshFile);
  const safe = { allowedRoots: [fixture.desktop, fixture.documents, fixture.downloads], documentsRoot: fixture.documents };
  const index = new FileIndex({ ...safe, clock });
  await index.build();
  const journalPath = path.join(parent, 'ADE', 'file-ops.jsonl');
  const journal = new LocalFileOpsJournal(journalPath, { clock });
  const shell = new FakeFsShell();
  const documentCalls: DocumentCall[] = [];
  const archieLlm = new FakeLlm(archieScript);
  const chipLlm = new FakeLlm();
  const fake = new FakeSpecialists({ clock });
  let approvals!: { requests: Array<{ callId: string; preview: string }> };
  let realApprovals: Approvals | undefined;
  const realRequests: Array<{ callId: string; preview: string }> = [];
  let decisionIndex = 0;
  const core = createChipCore({
    llm: chipLlm, plannerLlm: new FakeLlm(), runner: fake, calendar: new FakeCalendar(clock),
    settings: () => makeTestSettings({ allowedFolders: [...safe.allowedRoots] }), chipAssistantId: 'chip-test',
    clock, startNudges: false,
    ...(mode === 'real' ? { warden: { documentsRoot: fixture.documents } } : {}),
    archie: {
      llm: archieLlm, assistantId: 'archie-test', safe, index, journal, shell, startSweep: false,
      documents: {
        async uploadToThread(threadId, absPath) {
          const relative = path.relative(fixture.documents, absPath);
          if (!threadId || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid fixture document');
          documentCalls.push({ kind: 'upload', threadId, path: absPath });
          return { documentId: 'fixture-document' };
        },
        async waitIndexed(documentId, timeoutMs) {
          documentCalls.push({ kind: 'index', documentId, timeoutMs });
          return { status: documentId === 'fixture-document' ? 'indexed' : 'error', chunks: 1 };
        },
      },
      ...(mode === 'standin' ? {
        gate: ({ bus }: ArchieContext) => new AskingWardenGate({ bus }),
        approvals: (ctx: ArchieContext) => (approvals = new ScriptedApprovals(ctx, decisions)),
      } : {}),
    },
  });
  if (mode === 'real') {
    if (!core.warden || !core.archie || core.archie.gate !== core.warden.gate || core.archie.approvals !== core.warden.approvals) {
      throw new Error('Real Warden was not wired into Archie');
    }
    approvals = { requests: realRequests };
    realApprovals = core.warden.approvals;
    core.bus.subscribe((event) => {
      if (event.type !== 'approval.request') return;
      realRequests.push({ callId: event.callId, preview: event.preview });
      const decision = decisions[decisionIndex++] ?? 'approve';
      if (decision !== 'hold') queueMicrotask(() => realApprovals?.resolve(event.callId, decision === 'approve'));
    });
  }
  const run = async (request: string, task = request) => {
    chipLlm.push(
      requiresAction([toolCall('report_user_mood', { mood: 'calm', intensity: 0.3, reason: 'plain words' }),
        toolCall('delegate', { agent: 'beaver', title: request, task })]),
      completed('(silent)'),
      completed('[bubble: Done]\nArchie returned.'),
    );
    core.orchestrator.submitUserMessage(request);
    await flushPromises();
    await core.orchestrator.whenIdle();
    const job = core.jobs.list().findLast((item) => item.agent === 'beaver');
    if (!job) throw new Error('Chip did not delegate to Archie');
    const result = await core.jobs.waitFor(job.jobId);
    await flushPromises();
    await clock.advanceAsync(1500);
    await core.orchestrator.whenIdle();
    return result;
  };
  return {
    parent, fixture, clock, safe, index, journal, journalPath, shell, documentCalls, core, approvals, realApprovals, mode, archieLlm, chipLlm, fake, run,
    async cleanup() { await core.dispose(); index.stopWatching(); await rm(parent, { recursive: true, force: true }); },
  };
}

export const toolStep = (name: string, input: object) => requiresAction([toolCall(name, input)]);
export const doneStep = (say: string, summary = say) => completed(`BUBBLE: Done\nSAY: ${say}\nSUMMARY: ${summary}`);
