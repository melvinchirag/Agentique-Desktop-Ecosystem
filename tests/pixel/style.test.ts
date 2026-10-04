import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { GmailApi, GmailMessage, GmailMessageSummary } from '../../src/main/connectors/google/api';
import type { LlmClient, Memory, MemoryApi, MemoryWriter, SendParams } from '../../src/main/runtime/types';
import { cleanEmails } from '../../src/main/agents/workspace/style/cleaner';
import { redact } from '../../src/main/agents/workspace/style/redact';
import { computeStats } from '../../src/main/agents/workspace/style/stats';
import { sampleEmails } from '../../src/main/agents/workspace/style/sampler';
import { learnEmailStyle } from '../../src/main/agents/workspace/style/learner';
import { StyleStore } from '../../src/main/agents/workspace/style/styleStore';

const baseBody = 'Hey Jordan,\n\nThanks for checking in. I can look at the draft this afternoon and send you my comments before our meeting tomorrow. Let me know if there is anything else you need!\n\nThanks,\nAlex';
function message(index: number, body = baseBody): GmailMessage {
  return {
    id: `m${index}`, threadId: `t${index}`, snippet: '', labels: ['SENT'], internalDate: index * 1000,
    from: 'Alex <alex@example.org>', subject: index % 2 ? 'Re: Project' : 'Project',
    headers: { To: 'Jordan Smith <jordan@example.org>' }, textBody: body, attachments: [],
  };
}
function corpus(): GmailMessage[] {
  return Array.from({ length: 20 }, (_, index) => message(index,
    (index % 3 ? baseBody : baseBody.replace('Hey Jordan,', 'Hi team,')) +
    '\n\nSent from my iPhone\nOn Tue, someone wrote:\n> SECRET-QUOTE'));
}

class FakeMemory implements MemoryApi, MemoryWriter {
  rows: Memory[] = [];
  writes: string[] = [];
  async list() { return [...this.rows]; }
  async search(_agentId: 'workspace', query: string) { return this.rows.filter(row => row.content.includes(query)); }
  async update(_agentId: 'workspace', id: string, text: string) {
    this.writes.push(text);
    this.rows.find(row => row.id === id)!.content = text;
  }
  async remove(_agentId: 'workspace', id: string) { this.rows = this.rows.filter(row => row.id !== id); }
  async add(_agentId: 'workspace', text: string) {
    this.writes.push(text);
    const id = String(this.rows.length + 1);
    this.rows.push({ id, content: text });
    return { id };
  }
}

const tempPaths: string[] = [];
afterEach(async () => { await Promise.all(tempPaths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function store(memory = new FakeMemory()) {
  const directory = await mkdtemp(join(tmpdir(), 'pixel-style-'));
  tempPaths.push(directory);
  return { styleStore: new StyleStore(memory, memory, join(directory, 'pixel-style.json')), memory };
}
function gmail(messages: GmailMessage[]): GmailApi {
  const byId = new Map(messages.map(item => [item.id, item]));
  return {
    listSent: async max => messages.slice(0, max) as GmailMessageSummary[],
    getMessage: async id => byId.get(id)!,
    search: async () => [], getThread: async () => { throw new Error('unused'); },
    getAttachment: async () => new Uint8Array(), createDraft: async () => { throw new Error('unused'); },
    updateDraft: async () => { throw new Error('unused'); }, getDraft: async () => { throw new Error('unused'); },
    listDrafts: async () => [],
  };
}
function llm(content: string, calls: SendParams[]): LlmClient {
  return { send: async params => { calls.push(params); return { thread_id: 'fresh', content }; },
    submitToolOutputs: async () => { throw new Error('no tools allowed'); } };
}
const validJson = JSON.stringify({
  greetings: ['Hey <name>,'], signoffs: ['Thanks,\nAlex'], formality: 2, avgWords: 32, avgSentences: 3,
  paragraphs: 'short', emojiUse: 'never', exclamations: 'some', contractions: true,
  startsLowercase: false, quirks: ['short paragraphs'], examples: ['Hey <name>, Thanks for checking in.'],
});

describe('Pixel style P13 and P14 store behavior', () => {
  it('removes common quote formats, forwarded blocks, mobile footers, and bulk mail', () => {
    const variants = [
      `${baseBody}\nOn Tue, Jordan wrote:\nSECRET-GMAIL`,
      `${baseBody}\n-----Original Message-----\nSECRET-ORIGINAL`,
      `${baseBody}\nFrom: Jordan\nSent: Tuesday\nTo: Alex\nSubject: Re:\nSECRET-OUTLOOK`,
      `${baseBody}\n> SECRET-CHEVRON`,
      `${baseBody}\nBegin forwarded message:\nSECRET-FORWARD`,
      `${baseBody}\nSent from my iPhone\nSECRET-FOOTER`,
    ];
    const cleaned = cleanEmails(variants.map((body, index) => message(index, body)));
    expect(cleaned).toHaveLength(variants.length);
    expect(cleaned.map(item => item.text).join(' ')).not.toMatch(/SECRET/);
    expect(cleanEmails([message(99, baseBody), { ...message(100), headers: { 'List-Id': 'bulk' } }, message(101, 'Attached.')])).toHaveLength(1);
    expect(cleaned[0]?.signoff).toContain('Thanks');
    const html = { ...message(200, ''), htmlBody: `<p>${baseBody}</p><div class="gmail_quote"><div>SECRET-HTML-QUOTE</div></div>` };
    expect(cleanEmails([html])[0]?.text).not.toContain('SECRET-HTML-QUOTE');
    expect(cleanEmails(corpus())[0]?.text).not.toContain('Alex'); // recurring signature is a sign-off, not body text
  });

  it('redacts addresses, phones, URLs, long numbers, and recipient names', () => {
    const output = redact('Hey Jordan Smith, email jordan@example.org or call (313) 555-1234. Visit https://example.org/a?x=1 for 123456.', 'Jordan Smith');
    expect(output).toContain('Hey <name>');
    expect(output).toContain('<email>');
    expect(output).toContain('<phone>');
    expect(output).toContain('<url>');
    expect(output).toContain('<number>');
    expect(output).not.toMatch(/Jordan|example\.org|313|123456/);
  });

  it('keeps the 20-email fixture corpus above the STOP threshold and samples at most 30', () => {
    const cleaned = cleanEmails(corpus());
    expect(cleaned.length).toBeGreaterThanOrEqual(15);
    expect(computeStats(cleaned).replyRate).toBeGreaterThan(0);
    const samples = sampleEmails(cleaned);
    expect(samples).toHaveLength(20);
    expect(samples.join(' ')).not.toContain('SECRET-QUOTE');
    expect(sampleEmails([...cleaned, ...cleaned]).length).toBe(30);
  });

  it('learns with a fresh memory-off JSON call, then saves a compact mirror', async () => {
    const { styleStore, memory } = await store();
    const calls: SendParams[] = [];
    const progress: object[] = [];
    const result = await learnEmailStyle({ gmail: gmail(corpus()), llm: llm(validJson, calls), assistantId: 'pixel-assistant', store: styleStore,
      now: () => new Date('2026-10-04T12:00:00Z'), onProgress: value => progress.push(value) });
    expect(result.sampled).toBe(20);
    expect(result.profile.source).toBe('llm');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ assistantId: 'pixel-assistant', memory: 'off', webSearch: 'off', jsonOutput: true, tools: [] });
    expect(calls[0]?.threadId).toBeUndefined();
    expect(calls[0]?.content).not.toMatch(/Jordan|jordan@example|SECRET-QUOTE/);
    expect(progress.at(-1)).toMatchObject({ phase: 'done', completed: 20 });
    expect(JSON.stringify(progress)).not.toMatch(/Jordan|SECRET|@/);
    expect((await styleStore.get())?.examples).toHaveLength(1);
    expect(memory.rows).toHaveLength(1);
    expect(memory.rows[0]?.content).toMatch(/^User email style:/);
    expect(memory.rows[0]?.content).not.toMatch(/examples|checking in|SECRET|Jordan/);
  });

  it('retries invalid JSON once, then uses stats only', async () => {
    const { styleStore } = await store();
    const calls: SendParams[] = [];
    const result = await learnEmailStyle({ gmail: gmail(corpus()), llm: llm('bad-json', calls), assistantId: 'pixel', store: styleStore });
    expect(calls).toHaveLength(2);
    expect(result.profile.source).toBe('stats');
    expect(result.profile.examples).toEqual([]);
  });

  it('relearns in place and honors remote memory erasure on sync', async () => {
    const { styleStore, memory } = await store();
    await learnEmailStyle({ gmail: gmail(corpus()), llm: llm(validJson, []), assistantId: 'pixel', store: styleStore });
    await learnEmailStyle({ gmail: gmail(corpus()), llm: llm('bad-json', []), assistantId: 'pixel', store: styleStore });
    expect(memory.rows).toHaveLength(1);
    expect(memory.writes).toHaveLength(2);
    memory.rows = [];
    expect(await styleStore.sync()).toBeNull();
    expect(await styleStore.get()).toBeNull();
  });
});
