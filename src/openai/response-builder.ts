import type { UpstreamChunk } from '../workbuddy/client.js';
import {
  ToolAccumulator,
  normalizeFinishReason,
  type AssembledToolCall,
  type OpenAiToolCallDelta,
} from './tool-calls.js';

/**
 * Upstream events → OpenAI responses. The upstream is a near-standard
 * Chat Completions variant (see fixtures/protocol-notes.json); this module
 * owns every conversion:
 *  - finish_reason '' upstream means "in progress" → null (handled in client normalize)
 *  - delta shells (reasoning_content/refusal/function_call/extra_fields) filtered
 *  - tool_calls accumulated by the shared ToolAccumulator (see tool-calls.ts)
 *  - usage reduced to the three standard fields
 */

export type OpenAiUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type { OpenAiToolCallDelta, AssembledToolCall };

/** Streaming: convert one upstream chunk into one OpenAI chunk delta. */
export function toOpenAiChunk(
  chunk: UpstreamChunk,
  meta: { id: string; created: number; model: string },
):
  | {
      id: string;
      object: 'chat.completion.chunk';
      created: number;
      model: string;
      choices: Array<{
        index: number;
        delta: Record<string, unknown>;
        logprobs: null;
        finish_reason: string | null;
      }>;
    }
  | null {
  const delta = deltaFrom(chunk);
  if (delta === null && chunk.finish_reason === null) return null;
  return {
    id: meta.id,
    object: 'chat.completion.chunk',
    created: meta.created,
    model: meta.model,
    choices: [
      {
        index: 0,
        delta: delta ?? {},
        logprobs: null,
        finish_reason: normalizeFinishReason(chunk.finish_reason),
      },
    ],
  };
}

/** Build the outgoing delta, dropping upstream shell fields. */
function deltaFrom(chunk: UpstreamChunk): Record<string, unknown> | null {
  const delta: Record<string, unknown> = {};
  let any = false;
  if (chunk.delta.role) {
    delta.role = chunk.delta.role;
    any = true;
  }
  if (chunk.delta.content) {
    delta.content = chunk.delta.content;
    any = true;
  }
  if (chunk.delta.reasoning_content) {
    // Pass thinking deltas through under the de-facto standard field name.
    delta.reasoning_content = chunk.delta.reasoning_content;
    any = true;
  }
  const tc = openAiToolCallDeltas(chunk.delta.tool_calls);
  if (tc.length > 0) {
    delta.tool_calls = tc;
    any = true;
  }
  return any ? delta : null;
}

/**
 * Normalize upstream tool_call frame entries into OpenAI streaming deltas.
 * Empty upstream shell frames are dropped.
 *
 * OpenAI streaming semantics: metadata (`id`/`type`/`name`) is emitted once,
 * while later frames contain only the same `index` and argument fragments.
 * Never invent a second ID or append a fallback `"{}"` value.
 *
 * Frames are stateless within a chunk, which is all the streaming path needs:
 * the upstream never repeats metadata for an index after its first frame.
 * Cross-frame state (and therefore the id-changed-mid-stream check) lives in
 * ToolAccumulator, used by the aggregating path. `tests/tool-calls.test.ts`
 * asserts both paths agree on the same fixture.
 */
function openAiToolCallDeltas(
  raw: UpstreamChunk['delta']['tool_calls'],
): OpenAiToolCallDelta[] {
  if (!raw || raw.length === 0) return [];
  const out: OpenAiToolCallDelta[] = [];
  for (const tc of raw) {
    const index = typeof tc.index === 'number' ? tc.index : 0;
    const name = tc.function?.name ?? '';
    const args = tc.function?.arguments ?? '';
    if (!tc.id && !name && !args) continue; // upstream shell frame

    if (tc.id) {
      out.push({
        index,
        id: tc.id,
        type: 'function',
        function: { name, arguments: args },
      });
    } else {
      out.push({ index, function: { arguments: args } });
    }
  }
  return out;
}

/**
 * Aggregation state for building a non-stream chat.completion from the
 * (always-streaming) upstream.
 *
 * Tool-call accumulation and validation are delegated to ToolAccumulator so
 * the streaming and non-stream paths cannot drift apart.
 */
export class CompletionAggregator {
  private content = '';
  private reasoning = '';
  private readonly tools = new ToolAccumulator();
  private finishReason: string | null = null;
  private usage: OpenAiUsage | null = null;
  private upstreamId: string | undefined;
  private sawFirstFrame = false;

  push(chunk: UpstreamChunk): void {
    this.sawFirstFrame = true;
    if (chunk.id && !this.upstreamId) this.upstreamId = chunk.id;
    if (chunk.delta.content) this.content += chunk.delta.content;
    if (chunk.delta.reasoning_content) this.reasoning += chunk.delta.reasoning_content;
    this.tools.push(chunk);
    if (chunk.finish_reason) this.finishReason = normalizeFinishReason(chunk.finish_reason);
    if (chunk.usage) {
      this.usage = {
        prompt_tokens: chunk.usage.prompt_tokens ?? 0,
        completion_tokens: chunk.usage.completion_tokens ?? 0,
        total_tokens: chunk.usage.total_tokens ?? 0,
      };
    }
  }

  build(requestedModel: string): {
    id: string;
    object: 'chat.completion';
    created: number;
    model: string;
    choices: Array<{
      index: number;
      message: Record<string, unknown>;
      logprobs: null;
      finish_reason: string | null;
    }>;
    usage?: OpenAiUsage;
  } {
    if (!this.sawFirstFrame) {
      throw new Error('stream ended without producing a ChatCompletion');
    }
    const message: Record<string, unknown> = { role: 'assistant', content: this.content || null };
    if (this.reasoning) message.reasoning_content = this.reasoning;
    // Throws UpstreamProtocolError on incomplete or non-JSON tool arguments.
    const toolCalls = this.tools.assembled();
    if (toolCalls.length > 0) message.tool_calls = toolCalls;
    const finish = this.finishReason ?? (toolCalls.length > 0 ? 'tool_calls' : 'stop');
    const out = {
      id: localCompletionId(),
      object: 'chat.completion' as const,
      created: Math.floor(Date.now() / 1000),
      model: requestedModel,
      choices: [{ index: 0, message, logprobs: null, finish_reason: finish }],
      ...(this.usage ? { usage: this.usage } : {}),
    };
    return out;
  }
}

export function localCompletionId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return 'chatcmpl-' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}
