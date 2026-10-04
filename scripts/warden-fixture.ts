/** Offline Warden acceptance against a disposable OS-temp Archie sandbox. No keys or services. */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeArchieScenario, toolStep, doneStep } from '../tests/scenarios/archie/helpers';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main(): Promise<void> {
  const rig = await makeArchieScenario([
    toolStep('fs_read_text', { path: 'Desktop/notes.txt' }), doneStep('Read notes.'),
    toolStep('fs_move', { from: 'Documents/resume.pdf', to_folder: 'Downloads' }), doneStep('Moved resume.'),
    toolStep('fs_move', { from: 'Windows/System32', to_folder: 'Documents' }), doneStep('Blocked outside path.'),
  ], [], undefined, 'real');
  try {
    assert.ok(rig.core.warden, 'createChipCore must install the real Warden');
    assert.equal(rig.core.archie?.gate, rig.core.warden.gate);
    assert.equal(rig.core.archie?.approvals, rig.core.warden.approvals);
    assert.equal((await rig.run('Read my notes')).ok, true);
    assert.equal((await rig.run('Move my resume')).ok, true);
    assert.equal(existsSync(path.join(rig.fixture.downloads, 'resume.pdf')), true);
    assert.equal(rig.approvals.requests.length, 1);
    await rig.run('Move the Windows folder');
    const events = rig.core.bus.recent();
    assert.ok(events.some(e => e.type === 'wolf.verdict' && e.verdict === 'allow' && e.rule === 'W2'));
    assert.ok(events.some(e => e.type === 'wolf.verdict' && e.verdict === 'ask' && e.rule === 'W3'));
    assert.ok(events.some(e => e.type === 'approval.resolve' && e.approved && e.how === 'user'));
    assert.ok(events.some(e => e.type === 'wolf.verdict' && e.verdict === 'deny' && e.rule === 'W5'));
    const index = JSON.parse(await readFile(path.join(root, 'tests/fixtures/warden/injection/index.json'), 'utf8')) as Array<{ file: string; kind: 'email' | 'file' | 'doc' | 'calendar' | 'web' | 'summary' }>;
    for (const item of index) {
      const content = await readFile(path.join(root, 'tests/fixtures/warden/injection', item.file), 'utf8');
      const screened = await rig.core.warden.screen.screen(content, { kind: item.kind, name: item.file, taskId: 'fixture-corpus' });
      assert.ok(screened.flagged && screened.score >= 0.6, `Injection fixture missed: ${item.file}`);
    }
    console.log(`PASS real Warden/Archie fixture: read, approval/move, outside deny, ${index.length} injection samples`);
  } finally {
    await rig.cleanup();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
