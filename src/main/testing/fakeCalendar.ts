import type { CalendarEvent, CalendarSource, Clock } from '../runtime/types';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Three events relative to construction time; one "Midterm" ends 5 minutes from now. */
export class FakeCalendar implements CalendarSource {
  readonly events: CalendarEvent[];

  constructor(clock: Clock, events?: CalendarEvent[]) {
    const now = clock.now();
    const at = (offsetMs: number): Date => new Date(now + offsetMs);
    this.events = events ?? [
      { id: 'ev-midterm', title: 'CS 280 Midterm', start: at(-85 * MIN), end: at(5 * MIN) },
      { id: 'ev-standup', title: 'Team standup', start: at(DAY), end: at(DAY + 15 * MIN) },
      { id: 'ev-interview', title: 'Google interview', start: at(3 * DAY), end: at(3 * DAY + HOUR) },
    ];
  }

  async listEvents(from: Date, to: Date): Promise<CalendarEvent[]> {
    return this.events
      .filter((e) => e.start < to && e.end > from)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }
}
