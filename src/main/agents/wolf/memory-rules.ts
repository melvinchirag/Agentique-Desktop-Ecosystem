// Warden has NO memory, on purpose: security decisions must never drift (docs/SPONSORS.md §2.3).
// Every Warden call sends memory: 'off', and the assistant is created without memory prompts.
export const FACT_EXTRACTION_PROMPT = undefined;
export const UPDATE_MEMORY_PROMPT = undefined;
export const FACT_EXAMPLE = undefined;
