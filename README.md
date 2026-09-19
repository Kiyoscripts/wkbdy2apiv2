# wkbdy2api

A loopback-only gateway that exposes WorkBuddy AI through OpenAI-compatible and Anthropic-compatible HTTP APIs.

## Requirements

- Node.js 20 or newer
- pnpm

## Development

```bash
pnpm install
pnpm dev
```

Run validation with:

```bash
pnpm typecheck
pnpm test
```

## Supported API routes

- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /v1/responses`
- `POST /v1/messages`

The gateway forwards chat requests to WorkBuddy using streaming upstream responses and converts them to the response shape expected by each compatible API.

## Reasoning controls

OpenAI-compatible requests may provide `reasoning_effort` with one of these values:

- `none`
- `minimal`
- `low`
- `medium`
- `high`
- `xhigh`
- `max`

The value is forwarded to the WorkBuddy request body.

Anthropic-compatible `thinking` settings are converted to `reasoning_effort` as follows:

- `disabled` becomes `none`
- `adaptive` becomes `high`
- enabled budgets below 2,048 tokens become `low`
- enabled budgets from 2,048 tokens become `medium`
- enabled budgets from 8,192 tokens become `high`
- enabled budgets from 32,768 tokens become `xhigh`

## Model metadata

`GET /v1/models` returns OpenAI-shaped model objects. WorkBuddy-specific capabilities are exposed under `x_workbuddy`, including:

- reasoning support and reasoning-only status
- supported reasoning efforts
- default context-window length
- all values from `contextWindow.supportedLengths`
- image and tool-call support
- maximum input and output token limits

## Persistence

Two backends are supported, selected with `WKB2API_STORAGE_BACKEND`:

| Backend | Accounts | Telemetry | Survives a redeploy | Usage queries |
| --- | --- | --- | --- | --- |
| `file` (default) | AES-256-GCM blob on disk | JSONL file | only with a real volume | no |
| `postgres` | encrypted row in a table | `request_log` table | yes | yes |

Use `postgres` on hosts that recycle the filesystem between deploys (Render,
Heroku, most container platforms). With the `file` backend the account pool and
the entire request history are discarded on every restart, which is exactly when
an operator wants to inspect them; the gateway logs a warning when it detects
such a host.

### The encryption key

The account blob is encrypted in the application, so the key has to come from
somewhere. Two options, and the base64 value wins if both are set:

```bash
# Preferred on hosts with no persistent disk: nothing to mount, stable across
# restarts. Generate with: openssl rand -base64 32
WKB2API_ACCOUNT_STORE_KEY_B64=<base64 of 32 bytes>

# Or a mounted file containing 32 raw bytes or their base64 encoding.
WKB2API_ACCOUNT_STORE_KEY_FILE=/run/secrets/account-store-key
```

If neither is available the gateway **refuses to start**, unless
`WKB2API_ALLOW_EPHEMERAL_STORE=true` — a generated throwaway key would make
every stored account undecryptable after the next restart, and starting anyway
would hide that until an operator went looking for the missing pool.

### Render

`render.yaml` in this repository is a working blueprint: a Docker web service
plus a managed Postgres, with the key read from an environment variable. Set
`WKB2API_API_KEY` and `WKB2API_ACCOUNT_STORE_KEY_B64` in the dashboard and the
rest is wired automatically.

```bash
WKB2API_STORAGE_BACKEND=postgres
WKB2API_DATABASE_URL=postgres://user:password@host:5432/wkbdy2api
```

Notes:

- **Credentials stay encrypted in the database.** The row holds the same
  AES-256-GCM envelope the file backend writes, so a database backup or a
  `SELECT *` in a support session sees ciphertext. The key never leaves the
  process. Losing or rotating it makes existing rows undecryptable — the gateway
  reports that at startup rather than quietly starting with an empty pool.
- **TLS** is enabled automatically for any host that is not `localhost`,
  `127.0.0.1`, `::1`, or `*.internal`. Override with
  `WKB2API_DATABASE_SSL=true|false`.
- **Schema** is created on boot from an explicit migration table
  (`schema_migrations`), guarded by an advisory lock so several replicas can
  start at once. No external migration tool is required.
- **Telemetry is batched** (buffered, flushed on an interval or when the buffer
  fills) because a chatty gateway would otherwise pay a database round trip per
  request. A failed write disables persistence for the process and logs once,
  rather than failing requests.
- **Usage over a window** is available at `GET /admin/api/usage?window=<hours>`
  in `postgres` mode, with per-model, per-key, and per-account totals computed in
  SQL. The `file` backend returns 503 rather than misleading zeros, because it
  cannot answer the question across restarts.

`docker-compose.yml` includes a bundled `postgres` service for local use; in
production point `WKB2API_DATABASE_URL` at a managed database and drop it.

## API keys

Keys authenticate `/v1` requests and the panel, and are managed at
`/admin` → **API Keys**.

- **Only a hash is stored.** The plaintext is shown once at creation and is not
  recoverable; a lost key must be revoked and reissued.
- **Admin vs non-admin.** A key flagged admin may manage the gateway (accounts,
  keys, settings). A key without the flag authenticates `/v1` but is refused at
  every mutating admin endpoint — so issuing a key for API access does not also
  hand over the gateway.
- **Revocation is immediate.** Removing a key takes effect on the next request,
  with no cache and no restart.
- **`WKB2API_API_KEY` is always valid and always admin.** It cannot be deleted
  through the panel, which is what makes an accidental deletion recoverable
  rather than a lockout.

## Security

The service is intended for local loopback use. Configure downstream authentication and credential storage before exposing it to clients. Do not publish the service directly to an untrusted network.
