import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',

    // A gateway request in these suites spins up a Fastify app, walks the whole
    // plugin tree, and often streams a fixture through it. Under vitest's
    // default parallelism ~30 of these run at once, and the observed per-test
    // wall time for a single request ranges from ~200ms on an idle machine to
    // ~9s when several CPU-heavy suites (the admin panel's happy-dom DOM work,
    // the Postgres suites) are saturating the box.
    //
    // The 5000ms default sat inside that spread, which made CI red at random:
    // whichever test happened to be unlucky on a given run crossed the line and
    // reported "Test timed out" for a handler that was perfectly healthy. These
    // are not slow assertions, they are load-sensitive ones, so the ceiling has
    // to clear the loaded worst case rather than the idle one.
    testTimeout: 30_000,
    hookTimeout: 30_000,

    // Cap the pool so the load spike itself is bounded. 4 matches GitHub's
    // ubuntu-latest runner (4 vCPUs); letting vitest default to (cores - 1) on a
    // bigger dev box would just move the thrash into developer machines.
    // Override locally with VITEST_MAX_THREADS when needed.
    maxWorkers: Number(process.env.VITEST_MAX_THREADS ?? 4),
    minWorkers: 1,
  },
});
