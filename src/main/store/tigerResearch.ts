import { randomUUID } from 'node:crypto';
import { redact, type Db } from './tiger';

export interface ResearchEntry { ts: Date; title: string; sources: string[]; brief_path?: string }

/** Scout's saved findings and briefs. Writes never interrupt a successful research job. */
export class TigerResearchStore {
  private readonly local: ResearchEntry[] = [];
  constructor(private readonly db: Db, private readonly log: (message: string) => void = message => console.warn(`[tiger] ${message}`)) {}

  async record(title: string, sources: string[], briefPath?: string): Promise<void> {
    const row = { ts: new Date(), title, sources, ...(briefPath ? { brief_path: briefPath } : {}) };
    this.local.push(row);
    try {
      await this.db.query('INSERT INTO research_log (id, ts, title, sources, brief_path) VALUES ($1, $2, $3, $4::jsonb, $5)',
        [randomUUID(), row.ts, title, JSON.stringify(sources), briefPath ?? null]);
    } catch (error) { this.log(`research record failed: ${redact((error as Error).message)}`); }
  }

  async find(since: Date, query = ''): Promise<ResearchEntry[]> {
    try {
      const rows = (await this.db.query('SELECT ts, title, sources, brief_path FROM research_log WHERE ts >= $1 AND title ILIKE $2 ORDER BY ts DESC LIMIT 20',
        [since, `%${query.replace(/[\\%_]/g, '\\$&')}%`])).rows;
      return rows as ResearchEntry[];
    } catch (error) {
      this.log(`research lookup failed: ${redact((error as Error).message)}`);
      return this.local.filter(row => row.ts >= since && row.title.toLowerCase().includes(query.toLowerCase())).reverse().slice(0, 20);
    }
  }
}
