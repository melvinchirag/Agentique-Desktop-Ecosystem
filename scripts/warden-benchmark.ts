/** Offline W27 measurement: no services or filesystem probes. */
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { EventBus } from '../src/main/bus/eventBus';
import { WardenGateImpl } from '../src/main/wolf/gate';
import type { GateRequest } from '../src/main/runtime/types';
const roots = ['Desktop', 'Documents', 'Downloads'].map(n => path.resolve('tests/fixtures/sandbox', n));
const gate = new WardenGateImpl({ bus: new EventBus(),
  settings: { allowedFolders: roots, demoMode: false },
  registry: { beaver: [{ name: 'fs_list', risk: 'read', description: '', parameters: {}, execute: async () => undefined }] },
  exists: () => true, realpath: p => p });
for (const args of [{}, { path: 'Downloads/a.txt' }]) {
  const request: GateRequest = { agentId: 'beaver', taskId: 'bench', jobId: 'bench', callId: 'bench',
    jobKind: 'normal', tool: 'fs_list', risk: 'read', args };
  for (let i = 0; i < 1000; i++) gate.review(request);
  const start = performance.now();
  for (let i = 0; i < 10000; i++) {
    if (gate.review(request) !== 'allow') throw new Error('Benchmark read denied');
  }
  const ms = performance.now() - start;
  console.log(JSON.stringify({ reviews: 10000, args, ms: Number(ms.toFixed(2)), targetMs: 50, meetsTarget: ms < 50 }));
}
gate.dispose();
