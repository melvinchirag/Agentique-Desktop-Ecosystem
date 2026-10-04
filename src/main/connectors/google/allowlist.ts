/** The only Google API routes Pixel can reach. Match the decoded path, never a prefix. */
const segment = '[A-Za-z0-9_-]+';
const routes: ReadonlyArray<readonly [string, RegExp, string]> = [
  ['GET', /^\/gmail\/v1\/users\/me\/profile$/, 'gmail.googleapis.com'],
  ['GET', /^\/gmail\/v1\/users\/me\/messages$/, 'gmail.googleapis.com'],
  ['GET', new RegExp(`^/gmail/v1/users/me/messages/${segment}$`), 'gmail.googleapis.com'],
  ['GET', new RegExp(`^/gmail/v1/users/me/messages/${segment}/attachments/${segment}$`), 'gmail.googleapis.com'],
  ['GET', new RegExp(`^/gmail/v1/users/me/threads/${segment}$`), 'gmail.googleapis.com'],
  ['GET', /^\/gmail\/v1\/users\/me\/drafts$/, 'gmail.googleapis.com'],
  ['GET', new RegExp(`^/gmail/v1/users/me/drafts/${segment}$`), 'gmail.googleapis.com'],
  ['POST', /^\/upload\/gmail\/v1\/users\/me\/drafts$/, 'gmail.googleapis.com'],
  ['PUT', new RegExp(`^/upload/gmail/v1/users/me/drafts/${segment}$`), 'gmail.googleapis.com'],
  ['GET', /^\/calendar\/v3\/calendars\/primary\/events$/, 'www.googleapis.com'],
  ['POST', /^\/calendar\/v3\/calendars\/primary\/events$/, 'www.googleapis.com'],
  ['PATCH', new RegExp(`^/calendar/v3/calendars/primary/events/${segment}$`), 'www.googleapis.com'],
  ['GET', /^\/drive\/v3\/files$/, 'www.googleapis.com'],
  ['GET', new RegExp(`^/drive/v3/files/${segment}/export$`), 'www.googleapis.com'],
  ['GET', new RegExp(`^/drive/v3/files/${segment}$`), 'www.googleapis.com'],
  ['POST', /^\/v1\/documents$/, 'docs.googleapis.com'],
  ['GET', new RegExp(`^/v1/documents/${segment}$`), 'docs.googleapis.com'],
  ['POST', new RegExp(`^/v1/documents/${segment}:batchUpdate$`), 'docs.googleapis.com'],
  ['GET', new RegExp(`^/v4/spreadsheets/${segment}$`), 'sheets.googleapis.com'],
  ['GET', new RegExp(`^/v4/spreadsheets/${segment}/values/[^/]+$`), 'sheets.googleapis.com'],
];

/** Explicit deny table for audit: messages.send, drafts.send, delete/trash/modify,
 * settings, permissions/sharing and events.delete have no matching route above. */
export const DENIED_ENDPOINTS = [
  'messages.send', 'drafts.send', 'messages.delete', 'messages.trash',
  'messages.modify', 'settings/*', 'permissions.*', 'files.delete', 'events.delete',
] as const;

export class BlockedRequestError extends Error {
  readonly code = 'BLOCKED_REQUEST';
  constructor() { super('BLOCKED_REQUEST'); }
}

export function assertGoogleAllowed(method: string, input: string | URL): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new BlockedRequestError(); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) throw new BlockedRequestError();
  // Encoded separators and dot segments can change route meaning at a proxy.
  if (/%2f|%5c|%2e|\\|\/\.{1,2}(?:\/|$)/i.test(url.pathname)) throw new BlockedRequestError();
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { throw new BlockedRequestError(); }
  if (!routes.some(([verb, pattern, host]) => verb === method.toUpperCase() && host === url.hostname && pattern.test(path))) {
    throw new BlockedRequestError();
  }
  return url;
}
