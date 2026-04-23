# infra/

Local development infrastructure and (later) deployment code.

## Local stack — docker-compose

Services:

| Service  | Port(s)      | Credentials (dev)            | Purpose |
|----------|--------------|------------------------------|---------|
| Postgres | **5433** (host) → 5432 (container) | `myreport` / `myreport` | Primary database. Host port shifted to avoid clashing with a local Postgres instance. |
| Redis    | 6379         | —                            | BullMQ queues, rate limiting, cache |
| MinIO    | 9000 / 9001  | `minioadmin` / `minioadmin`  | S3-compatible storage (console on :9001) |

### Usage

```sh
pnpm dev:up      # start services in background
pnpm dev:down    # stop services (keeps volumes)
pnpm dev:logs    # tail logs
pnpm dev:reset   # stop + wipe volumes + restart
```

Credentials and host ports are driven by the repo-root `.env` (copied from `.env.example`). The defaults listed above are **dev fallbacks baked into the compose file** — override `POSTGRES_USER`, `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and the `*_HOST_PORT` variables in `.env` if you need different values or if ports clash on your host.

## Postgres init scripts

Files under `postgres/init/` run on first container start (fresh volume). They create extensions and any baseline roles. To re-run them after changes, use `pnpm dev:reset`.

## Terraform (deferred)

Production infrastructure code will live in `infra/terraform/` once we get close to deploying. Not authored yet.
