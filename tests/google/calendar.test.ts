import { describe, expect, it } from 'vitest';
import { CalendarClient, type GoogleTransport } from '../../src/main/connectors/google/calendarClient';

function transport(replies: unknown[]) {
  const calls: Array<{ method: string; url: URL; body?: Record<string, unknown> }> = [];
  const http: GoogleTransport = { async request(method, input, init) {
    calls.push({ method, url: new URL(input), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    return Response.json(replies.shift() ?? {});
  } };
  return { client: new CalendarClient(http), calls };
}

describe('CalendarClient', () => {
  it('expands recurring events, keeps all-day dates, and excludes declined and cancelled events', async () => {
    const { client, calls } = transport([{ items: [
      { id: 'recurring_1', summary: 'Class', start: { dateTime: '2026-10-05T09:00:00-04:00' }, end: { dateTime: '2026-10-05T10:00:00-04:00' } },
      { id: 'all_day', summary: 'Holiday', start: { date: '2026-10-06' }, end: { date: '2026-10-07' } },
      { id: 'declined', attendees: [{ email: 'me@example.com', self: true, responseStatus: 'declined' }] },
      { id: 'cancelled', status: 'cancelled' },
    ] }]);
    const events = await client.listEvents({ timeMin: '2026-10-05T00:00:00-04:00', timeMax: '2026-10-08T00:00:00-04:00', query: 'class' });
    expect(events.map((event) => event.id)).toEqual(['recurring_1', 'all_day']);
    expect(events[1]).toMatchObject({ start: '2026-10-06', end: '2026-10-07', allDay: true });
    expect(calls[0]!.url.searchParams.get('singleEvents')).toBe('true');
    expect(calls[0]!.url.searchParams.get('showDeleted')).toBe('false');
    expect(calls[0]!.url.searchParams.get('q')).toBe('class');
  });

  it('forces no guest notifications and changes only supplied fields', async () => {
    const wire = { id: 'e_1', summary: 'Planning', start: { dateTime: '2026-10-05T09:00:00-04:00' }, end: { dateTime: '2026-10-05T10:00:00-04:00' } };
    const { client, calls } = transport([wire, wire]);
    await client.createEvent({ title: 'Planning', start: wire.start.dateTime, end: wire.end.dateTime, attendees: ['guest@example.com'] });
    await client.updateEvent('e_1', { title: 'New title', description: '' });
    expect(calls.map((call) => call.url.searchParams.get('sendUpdates'))).toEqual(['none', 'none']);
    expect(calls[0]!.body).toMatchObject({ summary: 'Planning', attendees: [{ email: 'guest@example.com' }] });
    expect(calls[1]!.method).toBe('PATCH');
    expect(calls[1]!.body).toEqual({ summary: 'New title', description: '' });
    expect(JSON.stringify(calls[1]!.body)).not.toContain('attendees');
  });
});
