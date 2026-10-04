import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import os from 'node:os';
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
  restart?: { parent: string; fixture: Awaited<ReturnType<typeof makeSandbox>>; clock: FakeClock },
) {
  const parent = restart?.parent ?? await mkdtemp(path.join(os.tmpdir(), 'ade-archie-i-'));
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
  let approvals!: ScriptedApprovals;
  const core = createChipCore({
    llm: chipLlm, plannerLlm: new FakeLlm(), runner: fake, calendar: new FakeCalendar(clock),
    settings: () => makeTestSettings({ allowedFolders: [...safe.allowedRoots] }), chipAssistantId: 'chip-test',
    clock, startNudges: false,
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
      gate: ({ bus }) => new AskingWardenGate({ bus }),
      approvals: (ctx) => (approvals = new ScriptedApprovals(ctx, decisions)),
    },
  });
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
    parent, fixture, clock, safe, index, journal, journalPath, shell, documentCalls, core, approvals, archieLlm, chipLlm, fake, run,
    async cleanup() { await core.dispose(); index.stopWatching(); await rm(parent, { recursive: true, force: true }); },
  };
}

export const toolStep = (name: string, input: object) => requiresAction([toolCall(name, input)]);
export const doneStep = (say: string, summary = say) => completed(`BUBBLE: Done\nSAY: ${say}\nSUMMARY: ${summary}`);
