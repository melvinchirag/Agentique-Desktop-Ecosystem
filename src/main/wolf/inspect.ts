import type { ToolDefinition, ToolInspection } from '../../shared/tools';

const PATH_KEYS = new Set(['path', 'paths', 'from', 'to', 'to_folder', 'folder', 'dest', 'file', 'files', 'attachment', 'attachments']);
const URL_KEYS = new Set(['url', 'urls', 'link']);

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  throw new Error('Invalid inspection string value');
}

function unique(values: string[]): string[] { return [...new Set(values)]; }

/** Generic scan is always merged with the tool's own inspection; a tool cannot under-declare. */
export function inspectCall(args: unknown, tool?: Pick<ToolDefinition, 'inspect'>): ToolInspection {
  const paths: string[] = [];
  const urls: string[] = [];
  const attachments: string[] = [];
  let hasAttendees = false;
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value)) {
      const normalized = key.toLowerCase();
      if (PATH_KEYS.has(normalized)) paths.push(...strings(child));
      if (URL_KEYS.has(normalized)) urls.push(...strings(child));
      if (normalized === 'attachment' || normalized === 'attachments') attachments.push(...strings(child));
      if (normalized === 'attendees' && ((Array.isArray(child) && child.length > 0) || (typeof child === 'string' && child.trim().length > 0))) hasAttendees = true;
      visit(child);
    }
  };
  visit(args);
  const rawInspection: unknown = tool?.inspect ? tool.inspect(args) : {};
  if (rawInspection === null || typeof rawInspection !== 'object' || Array.isArray(rawInspection)
      || typeof (rawInspection as { then?: unknown }).then === 'function') throw new Error('Invalid tool inspection');
  const declared = rawInspection as ToolInspection;
  for (const value of [declared.paths, declared.writesPaths, declared.urls, declared.attachments]) {
    if (value !== undefined && (!Array.isArray(value) || value.some(item => typeof item !== 'string'))) throw new Error('Invalid tool inspection');
  }
  if (declared.count !== undefined && (!Number.isSafeInteger(declared.count) || declared.count < 0)) throw new Error('Invalid inspection count');
  if (declared.hasAttendees !== undefined && typeof declared.hasAttendees !== 'boolean') throw new Error('Invalid attendee inspection');
  return {
    paths: unique([...paths, ...(declared.paths ?? []), ...(declared.writesPaths ?? []), ...(declared.attachments ?? [])]),
    writesPaths: unique(declared.writesPaths ?? []),
    urls: unique([...urls, ...(declared.urls ?? [])]),
    attachments: unique([...attachments, ...(declared.attachments ?? [])]),
    count: declared.count,
    hasAttendees: hasAttendees || !!declared.hasAttendees,
  };
}
