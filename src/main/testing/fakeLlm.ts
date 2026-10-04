import type { LlmClient, LlmResponse, LlmToolCall, SendParams } from '../runtime/types';
import type { ModelChoice } from '../../shared/agents';

export type FakeLlmCall =
  | { kind: 'send'; params: SendParams }
  | { kind: 'toolOutputs'; threadId: string; outputs: { tool_call_id: string; output: string }[]; model?: ModelChoice };

export type FakeLlmStep = LlmResponse | Error | ((call: FakeLlmCall) => LlmResponse | Promise<LlmResponse>);

/** A scripted stand-in for Backboard. Each request consumes the next step. */
export class FakeLlm implements LlmClient {
  readonly calls: FakeLlmCall[] = [];
  private readonly script: FakeLlmStep[];

  constructor(script: FakeLlmStep[] = []) {
    this.script = [...script];
  }

  push(...steps: FakeLlmStep[]): void {
    this.script.push(...steps);
  }

  remaining(): number {
    return this.script.length;
  }

  send(params: SendParams): Promise<LlmResponse> {
    return this.handle({ kind: 'send', params }, params.signal);
  }

  submitToolOutputs(threadId: string, outputs: { tool_call_id: string; output: string }[], signal?: AbortSignal, model?: ModelChoice): Promise<LlmResponse> {
    return this.handle({ kind: 'toolOutputs', threadId, outputs, model }, signal);
  }

  private async handle(call: FakeLlmCall, signal?: AbortSignal): Promise<LlmResponse> {
    this.calls.push(call);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const step = this.script.shift();
    if (step === undefined) throw new Error('FakeLlm: script exhausted');
    if (step instanceof Error) throw step;
    if (typeof step === 'function') return step(call);
    return step;
  }
}

let callCounter = 0;

/** A tool call as Backboard returns it: `arguments` is a JSON string. */
export function toolCall(name: string, args: object, id?: string): LlmToolCall {
  return { id: id ?? `call_${++callCounter}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

export function requiresAction(toolCalls: LlmToolCall[], threadId = 'thread-1'): LlmResponse {
  return { status: 'REQUIRES_ACTION', thread_id: threadId, content: null, tool_calls: toolCalls };
}

export function completed(content: string, threadId = 'thread-1', retrievedMemories?: string[]): LlmResponse {
  const res: LlmResponse = { status: 'COMPLETED', thread_id: threadId, content, tool_calls: null };
  if (retrievedMemories) res.retrieved_memories = retrievedMemories;
  return res;
}
