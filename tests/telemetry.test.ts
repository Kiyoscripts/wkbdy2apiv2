import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTelemetrySink, toTelemetryRecord, type TelemetryRecord } from '../src/observability/telemetry.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wkb-telemetry-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const record = (over: Partial<TelemetryRecord> = {}): TelemetryRecord => ({
  time: '2026-09-19T00:00:00.000Z',
  request_id: 'req-1',
  method: 'POST',
  path: '/v1/chat/completions',
  status: 200,
  stream: false,
  duration_ms: 12,
  attempts: 1,
  retries: 0,
  ...over,
});

/** Writes are queued asynchronously, so poll until the expected count lands. */
async function settle(sinkPath: string, expected: number, timeoutMs = 2000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const raw = await readFile(sinkPath, 'utf8');
      const count = raw.split('\n').filter((l) => l.trim()).length;
      if (count >= expected) return count;
    } catch {
      // File not created yet.
    }
    if (Date.now() > deadline) {
      const raw = await readFile(sinkPath, 'utf8').catch(() => '');
      return raw.split('\n').filter((l) => l.trim()).length;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('TelemetrySink', () => {
  it('persists one JSONL line per request', async () => {
    const path = join(dir, 'requests.jsonl');
    const sink = createTelemetrySink({ path });
    sink.request(record({ request_id: 'req-1' }));
    sink.request(record({ request_id: 'req-2', status: 502, error_code: 'upstream_error' }));

    expect(await settle(path, 2)).toBe(2);
    const events = await sink.read();
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: 'request', record: { request_id: 'req-1', status: 200 } });
    expect(events[1]).toMatchObject({ kind: 'request', record: { request_id: 'req-2', status: 502 } });
  });

  it('survives a restart: a new sink reads what the old one wrote', async () => {
    // The whole point of the change. Previously the only record was an
    // in-memory ring buffer that vanished with the process.
    const path = join(dir, 'requests.jsonl');
    const first = createTelemetrySink({ path });
    first.request(record({ request_id: 'before-restart' }));
    await settle(path, 1);

    const second = createTelemetrySink({ path });
    const events = await second.read();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ record: { request_id: 'before-restart' } });
  });

  it('appends across sinks without losing earlier lines', async () => {
    const path = join(dir, 'requests.jsonl');
    const a = createTelemetrySink({ path });
    a.request(record({ request_id: 'one' }));
    await settle(path, 1);
    const b = createTelemetrySink({ path });
    b.request(record({ request_id: 'two' }));
    await settle(path, 2);

    const events = await createTelemetrySink({ path }).read();
    expect(events.map((e) => (e.kind === 'request' ? e.record.request_id : ''))).toEqual(['one', 'two']);
  });

  it('records pool lifecycle events in the same timeline as requests', async () => {
    const path = join(dir, 'requests.jsonl');
    const sink = createTelemetrySink({ path });
    sink.request(record({ request_id: 'req-1' }));
    sink.pool({ event: 'quarantined', label: 'acct-1', detail: 'attempt 2, cooldown 120s' });
    sink.pool({ event: 'restored', label: 'acct-1' });

    expect(await settle(path, 3)).toBe(3);
    const events = await sink.read();
    expect(events.map((e) => e.kind)).toEqual(['request', 'pool', 'pool']);
    expect(events[1]).toMatchObject({ record: { event: 'quarantined', label: 'acct-1' } });
    expect(events[1]!.kind === 'pool' && events[1]!.record.time).toBeTruthy();
  });

  it('redacts credentials before anything reaches disk', async () => {
    const path = join(dir, 'requests.jsonl');
    const sink = createTelemetrySink({ path });
    // A hostile/incautious caller passes a token as the model name.
    sink.request(record({ model: 'Bearer sk-abcdefghijklmnopqrstuvwxyz012345' }));

    await settle(path, 1);
    const raw = await readFile(path, 'utf8');
    expect(raw).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
  });

  it('returns the newest records when a limit is given', async () => {
    const path = join(dir, 'requests.jsonl');
    const sink = createTelemetrySink({ path });
    for (let i = 0; i < 10; i += 1) sink.request(record({ request_id: `req-${i}` }));
    await settle(path, 10);

    const events = await sink.read(3);
    expect(events.map((e) => (e.kind === 'request' ? e.record.request_id : ''))).toEqual(['req-7', 'req-8', 'req-9']);
  });

  it('skips a torn final line instead of failing the whole read', async () => {
    // A hard kill mid-append leaves a partial line; the history must still load.
    const path = join(dir, 'requests.jsonl');
    const sink = createTelemetrySink({ path });
    sink.request(record({ request_id: 'good' }));
    await settle(path, 1);
    await writeFile(path, (await readFile(path, 'utf8')) + '{"kind":"request","record":{"time":"2026-', 'utf8');

    const events = await sink.read();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ record: { request_id: 'good' } });
  });

  it('is a no-op when the path is empty', async () => {
    const sink = createTelemetrySink({ path: '' });
    expect(sink.enabled).toBe(false);
    sink.request(record());
    expect(await sink.read()).toEqual([]);
  });

  it('reads an absent file as an empty history', async () => {
    expect(await createTelemetrySink({ path: join(dir, 'nope.jsonl') }).read()).toEqual([]);
  });

  it('rotates rather than growing without bound', async () => {
    const path = join(dir, 'requests.jsonl');
    const sink = createTelemetrySink({ path, maxBytes: 300 });
    for (let i = 0; i < 12; i += 1) sink.request(record({ request_id: `req-${i}` }));
    await new Promise((r) => setTimeout(r, 200));

    const rotated = await readFile(`${path}.1`, 'utf8').catch(() => '');
    expect(rotated.length).toBeGreaterThan(0);
  });

  it('disables persistence after a write failure instead of spamming', async () => {
    // A path inside a file (not a directory) cannot be created.
    await writeFile(join(dir, 'blocker'), 'x', 'utf8');
    const errors: unknown[] = [];
    const sink = createTelemetrySink({ path: join(dir, 'blocker', 'requests.jsonl'), onError: (e) => errors.push(e) });
    sink.request(record());
    sink.request(record());
    sink.request(record());
    await new Promise((r) => setTimeout(r, 100));

    expect(errors.length).toBe(1);
    expect(await sink.read()).toEqual([]);
  });
});

describe('toTelemetryRecord', () => {
  it('maps a metrics entry onto a persisted record', () => {
    const out = toTelemetryRecord(
      {
        time: Date.parse('2026-09-19T00:00:00.000Z'),
        request_id: 'req-9',
        method: 'POST',
        path: '/v1/messages',
        status: 200,
        stream: true,
        duration_ms: 40,
        prompt_tokens: 10,
        completion_tokens: 5,
        model: 'wb-model',
        attempts: 1,
        retries: 0,
        error_class: 'none',
        key_id: 'key_abc',
      },
      { attempts: 3, retries: 2, account: 'acct-1' },
    );
    expect(out).toMatchObject({
      request_id: 'req-9',
      time: '2026-09-19T00:00:00.000Z',
      prompt_tokens: 10,
      completion_tokens: 5,
      attempts: 3,
      retries: 2,
      account: 'acct-1',
    });
  });

  it('preserves a request id so a record can be tied back to a log line', () => {
    const out = toTelemetryRecord({
      time: Date.now(), request_id: 'abc-123', method: 'POST', path: '/v1/chat/completions',
      status: 500, stream: false, duration_ms: 1, attempts: 1, retries: 0, error_class: 'internal_error',
    });
    expect(out.request_id).toBe('abc-123');
  });
});
