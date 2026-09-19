import { UpstreamProtocolError, type UpstreamChunk } from '../workbuddy/client.js';

/**
 * Single implementation of OpenAI tool-call semantics, shared by every
 * protocol route.
 *
 * Why this module exists: the streaming (`toOpenAiChunk`) and aggregating
 * (`CompletionAggregator`) paths used to be separate implementations that had
 * to agree without anything asserting they did. They did not:
 *
 *  - streaming only put `index`/`id`/`type`/`name` on the first frame for an
 *    index, while aggregation appended every frame's name;
 *  - aggregation never validated the assembled arguments, so a truncated
 *    stream produced a 200 response with malformed JSON where the tool
 *    arguments should be, whereas the Anthropic builder rejected it.
 *
 * Both bugs are invisible at the type level and only surface downstream, in a
 * caller's tool executor. Keeping one accumulator and one emitted shape, and
 * asserting in tests that streaming and aggregation agree, makes that class of
 * drift impossible rather than merely unlikely.
 */

/** One emitted tool-call delta, in OpenAI's streaming shape. */
export type OpenAiToolCallDelta = {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
};

/** Assembled tool call for a non-stream `chat.completion` message. */
export type AssembledToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
  index: number;
};

/** Finish reasons the upstream is known to send. Anything else is drift. */
const KNOWN_FINISH_REASONS = new Set(['stop', 'length', 'tool_calls', 'content_filter']);

/** Guard against a hostile or buggy upstream claiming an absurd tool index. */
const MAX_TOOL_INDEX = 1024;

type ToolState = { id: string; name: string; args: string };

/**
 * Accumulates tool-call frames across an upstream stream.
 *
 * One `ToolAccumulator` serves both output modes: feed every chunk to
 * `push()` and then read the state with `deltasFor()` (streaming) or
 * `assembled()` (non-stream).
 */
export class ToolAccumulator {
  private readonly tools = new Map<number, ToolState>();

  /** Fold one chunk's tool-call frames into the current state. */
  push(chunk: UpstreamChunk): void {
    for (const frame of chunk.delta.tool_calls ?? []) {
      const index = normalizeIndex(frame.index);
      const current = this.tools.get(index) ?? { id: '', name: '', args: '' };
      if (frame.id) {
        if (current.id && current.id !== frame.id) {
          throw new UpstreamProtocolError('Upstream tool ID changed mid-stream.');
        }
        current.id = frame.id;
      }
      if (frame.function?.name) {
        // A name arriving after arguments have already started cannot be
        // appended: the id/name pair is finished by then. Replace instead.
        current.name = current.args ? current.name : current.name + frame.function.name;
      }
      if (frame.function?.arguments) current.args += frame.function.arguments;
      this.tools.set(index, current);
    }
  }

  /** True when at least one tool call carries an id or a name. */
  get hasMetadata(): boolean {
    for (const tool of this.tools.values()) if (tool.id || tool.name) return true;
    return false;
  }

  get size(): number {
    return this.tools.size;
  }

  /** Indices of every tool call seen, ascending. */
  get indices(): number[] {
    return [...this.tools.keys()].sort((a, b) => a - b);
  }

  /**
   * Emit the OpenAI streaming delta for one index. Metadata (`id`, `type`,
   * `name`) is emitted only on the first frame that carries it; every later
   * frame for the same index contains only `index` and the argument fragment,
   * matching how OpenAI-compatible clients accumulate tool calls.
   */
  deltasFor(index: number): OpenAiToolCallDelta {
    const tool = this.tools.get(index);
    if (!tool) return { index };
    if (tool.id) {
      return { index, id: tool.id, type: 'function', function: { name: tool.name, arguments: '' } };
    }
    return { index, function: { arguments: tool.args } };
  }

  /**
   * Build the finalized tool calls for a non-stream response.
   *
   * Validates what the streaming path cannot: every call must have an id and a
   * name, and the assembled arguments must parse as a JSON object. A truncated
   * stream previously produced a successful-looking response here with broken
   * JSON in `arguments`; now it fails loudly and the route maps it to a 502.
   */
  assembled(): AssembledToolCall[] {
    const out: AssembledToolCall[] = [];
    const seenIds = new Set<string>();
    for (const [index, tool] of [...this.tools.entries()].sort((a, b) => a[0] - b[0])) {
      if (!tool.id || !tool.name) {
        throw new UpstreamProtocolError('Upstream returned an incomplete tool call.');
      }
      if (seenIds.has(tool.id)) {
        throw new UpstreamProtocolError('Upstream returned a duplicated tool call ID.');
      }
      seenIds.add(tool.id);
      const args = tool.args === '' ? '{}' : tool.args;
      let parsed: unknown;
      try {
        parsed = JSON.parse(args);
      } catch {
        throw new UpstreamProtocolError('Upstream tool arguments are not valid JSON.');
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new UpstreamProtocolError('Upstream tool arguments are not a JSON object.');
      }
      out.push({
        id: tool.id,
        type: 'function',
        function: { name: tool.name, arguments: args },
        index,
      });
    }
    return out;
  }

  /**
   * The streaming view of the accumulated state — one entry per index, in the
   * same shape `deltasFor` emits, with metadata attached to the first frame.
   */
  allDeltas(): OpenAiToolCallDelta[] {
    return this.indices.filter((index) => this.meaningful(index)).map((index) => this.deltasFor(index));
  }

  /** True when the index carries data. Empty upstream shell frames are dropped. */
  meaningful(index: number): boolean {
    const tool = this.tools.get(index);
    if (!tool) return false;
    return Boolean(tool.id || tool.name || tool.args);
  }
}

/**
 * Normalize an upstream tool index. Missing means 0 (OpenAI's own default);
 * anything non-integer, negative, or absurd is protocol drift and rejected,
 * matching the Anthropic builder's behaviour.
 */
export function normalizeIndex(index: number | undefined): number {
  if (index === undefined) return 0;
  if (!Number.isSafeInteger(index) || index < 0 || index > MAX_TOOL_INDEX) {
    throw new UpstreamProtocolError('Invalid upstream tool index.');
  }
  return index;
}

/**
 * Validate an upstream finish reason. `null` means "still streaming"; `''` is
 * already normalized to null by the client. Unknown values are drift, and
 * silently passing them through produced responses that OpenAI clients could
 * not interpret.
 */
export function normalizeFinishReason(reason: string | null): string | null {
  if (reason === null) return null;
  if (!KNOWN_FINISH_REASONS.has(reason)) {
    throw new UpstreamProtocolError('Unsupported upstream stop reason.');
  }
  return reason;
}
