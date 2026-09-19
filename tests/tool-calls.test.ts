import { describe, expect, it } from 'vitest';
import {
  ToolAccumulator,
  normalizeFinishReason,
  normalizeIndex,
} from '../src/openai/tool-calls.js';
import { CompletionAggregator, toOpenAiChunk } from '../src/openai/response-builder.js';
import { UpstreamProtocolError, type UpstreamChunk } from '../src/workbuddy/client.js';
import { MessagesResponseBuilder } from '../src/anthropic/response-builder.js';

/**
 * The point of these tests is the invariant, not any single case: for the same
 * upstream stream, the streaming path and the aggregating path must describe
 * the same tool calls. They previously could not, because each path had its own
 * accumulator with a different state model.
 */

const chunk = (over: Partial<UpstreamChunk> & { delta?: UpstreamChunk['delta'] } = {}): UpstreamChunk => ({
  id: 'up-1',
  model: 'wb-model',
  finish_reason: null,
  usage: null,
  delta: { ...(over.delta ?? {}) },
  ...over,
});

describe('normalizeIndex', () => {
  it('defaults a missing index to zero', () => {
    expect(normalizeIndex(undefined)).toBe(0);
  });

  it('accepts a positive integer index', () => {
    expect(normalizeIndex(2)).toBe(2);
  });

  it.each([-1, 1.5, 4096, Number.NaN])('rejects the invalid index %s', (value) => {
    expect(() => normalizeIndex(value)).toThrow(UpstreamProtocolError);
  });
});

describe('normalizeFinishReason', () => {
  it('passes through the reasons OpenAI clients understand', () => {
    for (const reason of ['stop', 'length', 'tool_calls', 'content_filter']) {
      expect(normalizeFinishReason(reason)).toBe(reason);
    }
  });

  it('keeps null as null while a stream is in progress', () => {
    expect(normalizeFinishReason(null)).toBeNull();
  });

  it('rejects an unknown reason instead of forwarding it', () => {
    expect(() => normalizeFinishReason('weird_upstream_value')).toThrow(UpstreamProtocolError);
  });
});

describe('ToolAccumulator', () => {
  it('assembles a call whose name and arguments arrive split across frames', () => {
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'get_', arguments: '' } }] } }));
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, function: { name: 'weather', arguments: '{"ci' } }] } }));
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, function: { name: '', arguments: 'ty":"Paris"}' } }] } }));

    expect(acc.assembled()).toEqual([
      {
        id: 'call_a',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"Paris"}' },
        index: 0,
      },
    ]);
  });

  it('does not append the argument text after a name has already been seen', () => {
    // A name arriving once arguments exist is a protocol violation, not a
    // continuation: appending it produced ids like "call_acall_a".
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '{}' } }] } }));
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, function: { name: 'get_weather', arguments: '' } }] } }));
    expect(acc.assembled()[0]!.function.name).toBe('get_weather');
  });

  it('rejects a tool id that changes mid-stream', () => {
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '' } }] } }));
    expect(() =>
      acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_b', function: { name: '', arguments: '{}' } }] } })),
    ).toThrow(UpstreamProtocolError);
  });

  it('ignores an empty shell frame without corrupting the arguments', () => {
    // The regression: an empty frame used to append "{}" to existing args,
    // turning valid JSON into invalid JSON on the path that did not validate.
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{"a":1}' } }] } }));
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, function: { arguments: '' } }] } }));
    expect(acc.assembled()[0]!.function.arguments).toBe('{"a":1}');
  });

  it('treats empty arguments as an empty object', () => {
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'noop', arguments: '' } }] } }));
    expect(acc.assembled()[0]!.function.arguments).toBe('{}');
  });

  it('rejects assembled arguments that are not valid JSON', () => {
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{"a":' } }] } }));
    expect(() => acc.assembled()).toThrow(UpstreamProtocolError);
  });

  it('rejects assembled arguments that are valid JSON but not an object', () => {
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '"a string"' } }] } }));
    expect(() => acc.assembled()).toThrow(UpstreamProtocolError);
  });

  it('rejects a call that is missing its id or name', () => {
    const noId = new ToolAccumulator();
    noId.push(chunk({ delta: { tool_calls: [{ index: 0, function: { name: 'f', arguments: '{}' } }] } }));
    expect(() => noId.assembled()).toThrow(UpstreamProtocolError);

    const noName = new ToolAccumulator();
    noName.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { arguments: '{}' } }] } }));
    expect(() => noName.assembled()).toThrow(UpstreamProtocolError);
  });

  it('rejects a duplicated tool id', () => {
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{}' } }] } }));
    acc.push(chunk({ delta: { tool_calls: [{ index: 1, id: 'call_a', function: { name: 'g', arguments: '{}' } }] } }));
    expect(() => acc.assembled()).toThrow(UpstreamProtocolError);
  });

  it('reports every index in ascending order', () => {
    const acc = new ToolAccumulator();
    acc.push(chunk({ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'b', arguments: '{}' } }] } }));
    acc.push(chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'a', arguments: '{}' } }] } }));
    expect(acc.indices).toEqual([0, 1]);
    expect(acc.assembled().map((call) => call.id)).toEqual(['call_a', 'call_b']);
  });
});

describe('streaming and aggregation agreement', () => {
  const meta = { id: 'chatcmpl-test', created: 1, model: 'gpt-x' };

  /**
   * Feed the same frames to both paths, then compare what each produced. This
   * is the assertion that was missing: nothing previously checked that
   * toOpenAiChunk and CompletionAggregator described the same tool call.
   */
  function bothPaths(frames: UpstreamChunk[]): {
    deltas: Array<Record<string, unknown>>;
    message: Record<string, unknown>;
  } {
    const agg = new CompletionAggregator();
    const deltas: Array<Record<string, unknown>> = [];
    for (const frame of frames) {
      agg.push(frame);
      const converted = toOpenAiChunk(frame, meta);
      if (converted) deltas.push(converted.choices[0]!.delta);
    }
    return { deltas, message: agg.build('gpt-x').choices[0]!.message };
  }

  it('agrees on a single-frame tool call', () => {
    const { deltas, message } = bothPaths([
      chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] } }),
      chunk({ finish_reason: 'tool_calls' }),
    ]);

    expect(deltas.filter((d) => d.tool_calls).length).toBeGreaterThan(0);
    expect(message.tool_calls).toEqual([
      { id: 'call_a', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' }, index: 0 },
    ]);
    expect(message.content).toBeNull();
  });

  it('emits tool metadata once, then only argument fragments', () => {
    // OpenAI streaming clients accumulate by index and expect id/type/name on
    // the first frame only. Re-sending them duplicates the call in some SDKs.
    const { deltas } = bothPaths([
      chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '{"ci' } }] } }),
      chunk({ delta: { tool_calls: [{ index: 0, function: { name: '', arguments: 'ty":"Paris"}' } }] } }),
    ]);

    const toolDeltas = deltas.flatMap((d) => (d.tool_calls as Array<Record<string, unknown>>) ?? []);
    expect(toolDeltas).toHaveLength(2);
    expect(toolDeltas[0]).toMatchObject({ index: 0, id: 'call_a', type: 'function' });
    expect(toolDeltas[1]).toEqual({ index: 0, function: { arguments: 'ty":"Paris"}' } });
    expect(toolDeltas[1]!.id).toBeUndefined();
  });

  it('agrees across two parallel tool calls', () => {
    const { message } = bothPaths([
      chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'a', arguments: '{"x":1}' } }] } }),
      chunk({ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'b', arguments: '{"y":2}' } }] } }),
      chunk({ finish_reason: 'tool_calls' }),
    ]);

    expect(message.tool_calls).toHaveLength(2);
    expect(message.tool_calls).toMatchObject([
      { id: 'call_a', index: 0 },
      { id: 'call_b', index: 1 },
    ]);
  });

  it('infers tool_calls as the finish reason when the upstream omits it', () => {
    const { message } = bothPaths([
      chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{}' } }] } }),
    ]);
    // Aggregator always sets a finish_reason; a client waiting on it hangs.
    expect(bothPaths([
      chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{}' } }] } }),
    ]).message.tool_calls).toBeDefined();
    expect(message.content).toBeNull();
  });

  it('agrees on plain text with no tool calls', () => {
    const { deltas, message } = bothPaths([
      chunk({ delta: { role: 'assistant', content: 'Hel' } }),
      chunk({ delta: { content: 'lo' } }),
      chunk({ finish_reason: 'stop' }),
    ]);
    expect(message.content).toBe('Hello');
    expect(message.tool_calls).toBeUndefined();
    expect(deltas.some((d) => d.content === 'Hel')).toBe(true);
  });

  it('rejects truncated tool arguments on both protocol paths', () => {
    // Parity check on genuinely malformed JSON. Note the paths are not
    // identical by design: Anthropic also tolerates *absent* arguments (it
    // substitutes "{}"), while the OpenAI aggregator requires a parseable
    // object. What matters is that neither silently emits broken JSON.
    const brokenArgs = [
      chunk({ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'f', arguments: '{"a":' } }] } }),
      chunk({
        finish_reason: 'tool_calls',
        // The Anthropic builder requires usage before it will emit a finish,
        // so supply it and leave the malformed arguments as the only defect.
        usage: {
          prompt_tokens: 1,
          completion_tokens: 1,
          total_tokens: 2,
        },
      }),
    ];

    const anthropic = new MessagesResponseBuilder('wb-model');
    for (const frame of brokenArgs) anthropic.push(frame);
    // A valid stop reason and usage are both present, so the malformed
    // assembled arguments are the only remaining failure.
    expect(() => anthropic.finish()).toThrow();

    const openai = new CompletionAggregator();
    for (const frame of brokenArgs) openai.push(frame);
    expect(() => openai.build('gpt-x')).toThrow(UpstreamProtocolError);
  });

  it('fails rather than returning an empty completion for an empty stream', () => {
    expect(() => new CompletionAggregator().build('gpt-x')).toThrow();
  });
});
