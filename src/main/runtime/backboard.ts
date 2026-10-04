import type { ModelChoice } from '../../shared/agents';
import type { LlmClient, LlmResponse, LlmToolCall, SendParams } from './types';

const BASE_URL = 'https://app.backboard.io/api';
const DEFAULT_TIMEOUT_MS = 25_000;

/** A non-2xx answer from Backboard. Carries the status and the raw body. */
export class BackboardError extends Error {
  constructor(readonly status: number, readonly body: string, path: string) {
    super(`Backboard ${path} returned ${status}: ${body.slice(0, 500)}`);
    this.name = 'BackboardError';
  }
}

export interface BackboardOptions {
  apiKey: string;
  /** Used when a call does not pass `model`. */
  defaultModel?: ModelChoice;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface BackboardModel { name: string; provider: string; supports_tools?: boolean; supports_json_output?: boolean; context_limit?: number }

export interface CreateAssistantParams {
  name: string; systemPrompt: string;
  factExtractionPrompt?: string; updateMemoryPrompt?: string;
}

interface RequestOptions { method?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number; retry?: boolean }

const isAbort = (e: unknown) => e instanceof Error && e.name === 'AbortError';

/** Backboard returns memories as strings or objects, depending on the call. The contract wants plain texts. */
export function normalizeMemories(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === 'string') out.push(item);
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>;
      const text = o.memory ?? o.content ?? o.text;
      if (typeof text === 'string') out.push(text);
    }
  }
  return out;
}

function toLlmResponse(raw: Record<string, unknown>): LlmResponse {
  return {
    status: (raw.status as LlmResponse['status']) ?? null,
    thread_id: String(raw.thread_id ?? ''),
    content: (raw.content as string | null | undefined) ?? null,
    tool_calls: (raw.tool_calls as LlmToolCall[] | null | undefined) ?? null,
    retrieved_memories: normalizeMemories(raw.retrieved_memories),
  };
}

/**
 * The real LlmClient. Every LLM call in ADE goes through here (docs/SPONSORS.md Part 2).
 * Shapes and paths were confirmed with real calls: docs/sponsor-verify.md.
 */
export class BackboardClient implements LlmClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly defaultModel: ModelChoice | undefined;

  constructor(opts: BackboardOptions) {
    if (!opts.apiKey) throw new Error('BACKBOARD_API_KEY is missing');
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl ?? BASE_URL;
    this.fetchFn = opts.fetch ?? fetch;
    this.defaultModel = opts.defaultModel;
  }

  async send(p: SendParams): Promise<LlmResponse> {
    const model = p.model ?? this.defaultModel;
    const body: Record<string, unknown> = { assistant_id: p.assistantId, content: p.content, stream: false };
    if (p.threadId) body.thread_id = p.threadId;
    if (p.systemPrompt !== undefined) body.system_prompt = p.systemPrompt;
    if (p.tools?.length) body.tools = p.tools;
    if (model) { body.llm_provider = model.llm_provider; body.model_name = model.model_name; }
    if (p.memory) body.memory = p.memory;
    if (p.webSearch) body.web_search = p.webSearch;
    if (p.jsonOutput) body.json_output = true;
    const raw = await this.request('/threads/messages', { method: 'POST', body, signal: p.signal, timeoutMs: p.timeoutMs, retry: true });
    return toLlmResponse(raw);
  }

  /** Every tool call of the previous response must get an output. */
  async submitToolOutputs(threadId: string, outputs: { tool_call_id: string; output: string }[], signal?: AbortSignal): Promise<LlmResponse> {
    const raw = await this.request('/threads/tool-outputs', { method: 'POST', body: { thread_id: threadId, tool_outputs: outputs }, signal, retry: true });
    return toLlmResponse(raw);
  }

  /** Tool-capable chat models for the Settings dropdown. The full list is huge, so always pass a limit. */
  async listModels(opts: { provider?: string; limit?: number } = {}): Promise<BackboardModel[]> {
    const path = opts.provider ? `/models/provider/${encodeURIComponent(opts.provider)}` : '/models';
    const raw = await this.request(`${path}?model_type=llm&supports_tools=true&limit=${opts.limit ?? 200}`, { retry: true });
    const models = Array.isArray(raw) ? raw : (raw.models as unknown[] | undefined) ?? [];
    return models as BackboardModel[];
  }

  async createAssistant(p: CreateAssistantParams): Promise<{ assistantId: string }> {
    const body: Record<string, unknown> = { name: p.name, system_prompt: p.systemPrompt };
    if (p.factExtractionPrompt) body.custom_fact_extraction_prompt = p.factExtractionPrompt;
    if (p.updateMemoryPrompt) body.custom_update_memory_prompt = p.updateMemoryPrompt;
    const raw = await this.request('/assistants', { method: 'POST', body });
    if (typeof raw.assistant_id !== 'string') throw new Error('Backboard did not return an assistant_id');
    return { assistantId: raw.assistant_id };
  }

  /** Deletes a thread and its messages (confirmed: DELETE /threads/{id}, docs/sponsor-verify.md §P3). Pixel's style learner calls this so writing samples do not linger. */
  async deleteThread(threadId: string): Promise<void> {
    await this.request(`/threads/${encodeURIComponent(threadId)}`, { method: 'DELETE' });
  }

  async deleteAssistant(assistantId: string): Promise<void> {
    await this.request(`/assistants/${encodeURIComponent(assistantId)}`, { method: 'DELETE' });
  }

  /**
   * One HTTP call. Timeout (default 25 s) is combined with the caller's signal.
   * With `retry`, retries once on a network error, a timeout, or a 5xx. Never on a 4xx or a caller abort.
   */
  async request(path: string, opts: RequestOptions = {}): Promise<Record<string, any>> {
    const attempts = opts.retry ? 2 : 1;
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      if (opts.signal?.aborted) throw abortError();
      const timeout = AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
      let res: Response;
      try {
        res = await this.fetchFn(this.baseUrl + path, {
          method: opts.method ?? 'GET',
          headers: { 'X-API-Key': this.apiKey, ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal,
        });
      } catch (e) {
        if (opts.signal?.aborted) throw abortError();          // the caller cancelled: never retried
        lastError = timeout.aborted ? new Error(`Backboard ${path} timed out`) : new Error(`Backboard ${path} is unreachable: ${isAbort(e) ? 'aborted' : (e as Error).message}`);
        continue;
      }
      const text = await res.text();
      if (res.ok) {
        try { return text ? JSON.parse(text) : {}; }
        catch { throw new Error(`Backboard ${path} returned a non-JSON body`); }
      }
      lastError = new BackboardError(res.status, text, path);
      if (res.status < 500) throw lastError;                   // 4xx: our mistake, retrying won't help
    }
    throw lastError;
  }
}

function abortError(): Error {
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}
