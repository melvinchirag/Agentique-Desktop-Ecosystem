import { promises as nodeFs } from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../../../shared/tools';

const BLOCKED_DOWNLOADS = /\.(?:exe|msi|zip|7z|rar|dmg|apk|bat|ps1)$/i;

export interface EagleToolDeps {
  openExternal: (url: string) => Promise<void>;
  documentsRoot: string;
  fs?: Pick<typeof nodeFs, 'mkdir' | 'writeFile'>;
  now?: () => Date;
}

export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password ||
        BLOCKED_DOWNLOADS.test(decodeURIComponent(url.pathname))) return null;
    return url.href;
  } catch { return null; }
}

export function briefPath(documentsRoot: string, title: unknown, date: Date): string | null {
  if (typeof title !== 'string' || !title.trim() || Number.isNaN(date.getTime())) return null;
  const slug = title.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70).replace(/-+$/g, '') || 'brief';
  return path.join(documentsRoot, 'ADE Research', `${slug}-${date.toISOString().slice(0, 10)}.md`);
}

export function createEagleTools(deps: EagleToolDeps): ToolDefinition[] {
  const fs = deps.fs ?? nodeFs;
  const now = deps.now ?? (() => new Date());
  return [
    {
      name: 'web_open', description: 'Open a source page in the user browser. HTTP and HTTPS pages only; no downloads.',
      parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
      risk: 'read',
      inspect: (input: { url?: unknown }) => ({ urls: typeof input.url === 'string' ? [input.url] : [] }),
      async execute(input: { url?: unknown }) {
        const url = safeWebUrl(input.url);
        if (!url) return { error: 'INVALID_URL' };
        await deps.openExternal(url);
        return { opened: url };
      },
    },
    {
      name: 'web_save_brief', description: 'Save a Markdown research brief in Documents/ADE Research.',
      parameters: { type: 'object', properties: { title: { type: 'string' }, markdown: { type: 'string' } }, required: ['title', 'markdown'], additionalProperties: false },
      risk: 'draft',
      inspect: (input: { title?: unknown }) => {
        const target = briefPath(deps.documentsRoot, input.title, now());
        return target ? { paths: [target], writesPaths: [target] } : {};
      },
      async execute(input: { title?: unknown; markdown?: unknown }, ctx) {
        const target = briefPath(deps.documentsRoot, input.title, now());
        if (!target || typeof input.markdown !== 'string' || !input.markdown.trim()) return { error: 'INVALID_BRIEF' };
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, input.markdown, { encoding: 'utf8', flag: 'wx' });
        ctx.emit({ type: 'artifact', agentId: 'eagle', taskId: ctx.taskId, kind: 'research_brief', title: input.title as string, data: { path: target } });
        return { path: target };
      },
    },
  ];
}
