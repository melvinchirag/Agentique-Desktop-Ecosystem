/**
 * Talk to an animal while it works. "Archie, skip the PDFs" or "tell Archie to skip the PDFs" reaches the
 * running job at its next step, without waiting for Chip or calling the model. If the job finishes before
 * the note is read, the note goes back to Chip as an ordinary message, so nothing the user says is lost.
 */
import type { SpecialistId } from './types';
import { specialistFromWord } from '../agents/chipmunk/names';

const DIRECT_RE = /^(?:tell|ask)\s+([\p{L}]+)\s+(?:to\s+)?(.+)$|^([\p{L}]+)\s*[,:]\s*(.+)$/isu;

/** "Archie, skip the PDFs" -> { agent: 'beaver', note: 'skip the PDFs' }. Anything else -> undefined. */
export function directNote(text: string): { agent: SpecialistId; note: string } | undefined {
  const m = DIRECT_RE.exec(text.trim());
  if (!m) return undefined;
  const agent = specialistFromWord(m[1] ?? m[3] ?? '');
  const note = (m[2] ?? m[4] ?? '').trim();
  return agent && note ? { agent, note } : undefined;
}

export class Steering {
  private readonly running = new Map<SpecialistId, number>();
  private readonly notes = new Map<SpecialistId, string[]>();
  /** Called when a job ends with notes it never read. Wired to Chip's inbox. */
  onUndelivered?: (agent: SpecialistId, text: string) => void;

  begin(agent: SpecialistId): void { this.running.set(agent, (this.running.get(agent) ?? 0) + 1); }

  end(agent: SpecialistId): void {
    const n = (this.running.get(agent) ?? 1) - 1;
    if (n > 0) { this.running.set(agent, n); return; }
    this.running.delete(agent);
    const left = this.take(agent);
    if (left.length) this.onUndelivered?.(agent, left.join(' '));
  }

  /** Queues a note for a running job. False when that animal has no job running (Chip handles the message). */
  tell(agent: SpecialistId, note: string): boolean {
    if (!this.running.has(agent)) return false;
    this.notes.set(agent, [...(this.notes.get(agent) ?? []), note]);
    return true;
  }

  take(agent: SpecialistId): string[] {
    const n = this.notes.get(agent) ?? [];
    this.notes.delete(agent);
    return n;
  }
}
