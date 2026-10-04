import type { CalendarApi, GoogleCalendarEvent } from './api';

/** Structural shape of lane H's GoogleHttp, so this lane can compile independently. */
export interface GoogleTransport {
  request(method: string, url: string | URL, init?: Omit<RequestInit, 'method' | 'signal'>): Promise<Response>;
}

type WireEvent = {
  id: string; summary?: string; description?: string; location?: string;
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string };
  attendees?: Array<{ email: string; self?: boolean; responseStatus?: string }>;
  status?: string;
};

const endpoint = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
function eventPath(id: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('BAD_ID');
  return `${endpoint}/${id}`;
}

function fromWire(value: WireEvent): GoogleCalendarEvent {
  return {
    id: value.id,
    title: value.summary ?? '',
    start: value.start?.dateTime ?? value.start?.date ?? '',
    end: value.end?.dateTime ?? value.end?.date ?? '',
    ...(value.start?.date ? { allDay: true } : {}),
    ...(value.description !== undefined ? { description: value.description } : {}),
    ...(value.location !== undefined ? { location: value.location } : {}),
    ...(value.attendees ? { attendees: value.attendees.map(({ email }) => email) } : {}),
    ...(value.attendees?.some((attendee) => attendee.self && attendee.responseStatus === 'declined') ? { declined: true } : {}),
  };
}

function dateValue(value: string, allDay: boolean | undefined): { date: string } | { dateTime: string } {
  return allDay ? { date: value } : { dateTime: value };
}

function createBody(event: Omit<GoogleCalendarEvent, 'id'>): Record<string, unknown> {
  return {
    summary: event.title,
    start: dateValue(event.start, event.allDay),
    end: dateValue(event.end, event.allDay),
    ...(event.description !== undefined ? { description: event.description } : {}),
    ...(event.location !== undefined ? { location: event.location } : {}),
    ...(event.attendees !== undefined ? { attendees: event.attendees.map((email) => ({ email })) } : {}),
  };
}

export class CalendarClient implements CalendarApi {
  constructor(private readonly http: GoogleTransport) {}

  async listEvents(input: { timeMin: string; timeMax: string; query?: string; maxResults?: number }): Promise<GoogleCalendarEvent[]> {
    const url = new URL(endpoint);
    url.searchParams.set('timeMin', input.timeMin);
    url.searchParams.set('timeMax', input.timeMax);
    url.searchParams.set('singleEvents', 'true');
    url.searchParams.set('showDeleted', 'false');
    url.searchParams.set('orderBy', 'startTime');
    url.searchParams.set('maxResults', String(Math.max(1, Math.min(50, Math.floor(input.maxResults ?? 50)))));
    if (input.query !== undefined) url.searchParams.set('q', input.query);
    const page = await (await this.http.request('GET', url)).json() as { items?: WireEvent[] };
    return (page.items ?? [])
      .filter((event) => event.status !== 'cancelled' && !event.attendees?.some((attendee) => attendee.self && attendee.responseStatus === 'declined'))
      .map(fromWire);
  }

  async createEvent(event: Omit<GoogleCalendarEvent, 'id'>): Promise<GoogleCalendarEvent> {
    const url = new URL(endpoint);
    url.searchParams.set('sendUpdates', 'none');
    const response = await this.http.request('POST', url, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createBody(event)),
    });
    return fromWire(await response.json() as WireEvent);
  }

  async updateEvent(id: string, patch: Partial<Omit<GoogleCalendarEvent, 'id' | 'attendees'>>): Promise<GoogleCalendarEvent> {
    const body: Record<string, unknown> = {};
    if (patch.title !== undefined) body.summary = patch.title;
    if (patch.description !== undefined) body.description = patch.description;
    if (patch.location !== undefined) body.location = patch.location;
    if (patch.start !== undefined) body.start = dateValue(patch.start, patch.allDay);
    if (patch.end !== undefined) body.end = dateValue(patch.end, patch.allDay);
    const url = new URL(eventPath(id));
    url.searchParams.set('sendUpdates', 'none');
    const response = await this.http.request('PATCH', url, {
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return fromWire(await response.json() as WireEvent);
  }
}
