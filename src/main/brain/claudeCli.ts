/** Kept for callers of the first cut: the Claude Code brain is CliBrainClient with the CLAUDE vendor. */
import { CliBrainClient, type CliBrainOptions } from './cliBrain';
import { CLAUDE } from './vendors';

export class ClaudeCliClient extends CliBrainClient {
  constructor(o: CliBrainOptions) { super(CLAUDE, o); }
}
