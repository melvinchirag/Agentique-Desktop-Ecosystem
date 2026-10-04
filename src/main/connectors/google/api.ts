/** Pixel's shared Google boundary. Clients and FakeGoogle implement these interfaces. */

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  snippet: string;
  labels: string[];
  internalDate: number;
  from: string;
  subject: string;
}

export interface GmailAttachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface GmailMessage extends GmailMessageSummary {
  headers: Record<string, string>;
  textBody: string;
  htmlBody?: string;
  attachments: GmailAttachment[];
}

export interface GmailThread { id: string; messages: GmailMessage[] }
export interface GmailDraft { id: string; messageId: string; threadId?: string }

export interface GmailApi {
  search(query: string, maxResults?: number): Promise<GmailMessageSummary[]>;
  getMessage(id: string): Promise<GmailMessage>;
  getThread(id: string): Promise<GmailThread>;
  getAttachment(messageId: string, attachmentId: string): Promise<Uint8Array>;
  listSent(maxResults: number): Promise<GmailMessageSummary[]>;
  createDraft(input: { raw: string; threadId?: string }): Promise<GmailDraft>;
  updateDraft(draftId: string, input: { raw: string; threadId?: string }): Promise<GmailDraft>;
  getDraft(draftId: string): Promise<GmailDraft>;
  listDrafts(maxResults?: number): Promise<GmailDraft[]>;
}

export interface GoogleCalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  description?: string;
  location?: string;
  attendees?: string[];
  declined?: boolean;
}

export interface CalendarApi {
  listEvents(input: { timeMin: string; timeMax: string; query?: string; maxResults?: number }): Promise<GoogleCalendarEvent[]>;
  /** Implementations always send `sendUpdates=none`. */
  createEvent(event: Omit<GoogleCalendarEvent, 'id'>): Promise<GoogleCalendarEvent>;
  /** Implementations always send `sendUpdates=none` and never alter attendees. */
  updateEvent(id: string, patch: Partial<Omit<GoogleCalendarEvent, 'id' | 'attendees'>>): Promise<GoogleCalendarEvent>;
}

export type DriveFileKind = 'doc' | 'sheet' | 'slides' | 'pdf' | 'folder' | 'other';
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  kind: DriveFileKind;
  size?: number;
  modifiedTime?: string;
}

export interface DriveApi {
  search(input: { text: string; kind?: DriveFileKind | 'any'; modifiedWithinDays?: number; maxResults?: number }): Promise<DriveFile[]>;
  getFile(id: string): Promise<DriveFile>;
  exportText(id: string): Promise<string>;
  download(id: string): Promise<Uint8Array>;
}

export type DocsRequest = Record<string, unknown>;
export interface DocsApi {
  create(title: string): Promise<{ id: string; title: string }>;
  batchUpdate(docId: string, requests: DocsRequest[]): Promise<void>;
  getEndIndex(docId: string): Promise<number>;
}

export interface SheetTab { title: string; rows: number; columns: number }
export interface SheetsApi {
  info(sheetId: string): Promise<{ id: string; title: string; tabs: SheetTab[] }>;
  getValues(sheetId: string, range: string): Promise<string[][]>;
}

export interface GoogleApi {
  gmail: GmailApi;
  calendar: CalendarApi;
  drive: DriveApi;
  docs: DocsApi;
  sheets: SheetsApi;
  whoAmI(): Promise<string>;
}
