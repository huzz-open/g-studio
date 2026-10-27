# Generation relay deployment

This Node/TypeScript service routes jobs to authenticated user-owned workers. It does not install Python, download models or perform inference.

[Documentation index](../../docs/README.md) · [Worker setup](../generation-python/README.md) · [Browser pairing](../../docs/guides/model-generation.md#通过公网中转)

## Start

```sh
npm install
npm run build
npm run relay:start
```

Serve `dist/` and proxy the relay API through the same public HTTPS domain when possible. `relay:start` runs TypeScript through the pinned `tsx` dependency. Keep the service under a process supervisor and persist `RELAY_HOME`. The initial implementation is a single instance; do not load-balance several independent copies of its state directory.

## Configuration

| Variable | Default / meaning |
| --- | --- |
| `RELAY_HOST` | `127.0.0.1`; expose through the reverse proxy |
| `RELAY_PORT` | `8787` |
| `RELAY_HOME` | `~/.g-studio/relay`; device hashes, browser grants, task metadata and temporary uploads |
| `RELAY_MAX_STORAGE_MB` | Total temporary transfer quota, default 2048MiB; in-progress output uploads reserve up to 128MiB each |
| `RELAY_ORIGINS` | Exact comma-separated browser origins; set to the actual public HTTPS site |
| `RELAY_TLS_CERT` / `RELAY_TLS_KEY` | Optional certificate chain and private key paths for native HTTPS/WSS instead of reverse-proxy TLS termination |

## HTTPS reverse proxy

Example nginx locations inside an existing HTTPS server with a trusted certificate:

```nginx
client_max_body_size 129m;
location /generation/worker {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 90s;
}
location /v1/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_read_timeout 60s;
}
location /worker/files/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_read_timeout 120s;
}
```

The worker connects to `wss://your-domain/generation/worker`. In browser settings use `https://your-domain` as the relay base URL. Static hosting such as GitHub Pages cannot host this long-running server; configure a separate HTTPS relay with the site's exact origin if needed.

## Authorization

Pairing uses a five-minute, single-use code plus local terminal confirmation. Browser grants expire after 30 days and can be revoked from settings. Each task belongs to the browser grant that submitted it. All task reads, cancellation and downloads enforce this ownership. The direct worker token, worker identity secret and browser grant are different credentials.

To revoke browser access, use **Unbind and forget credentials**. To retire a worker identity, stop it and remove its private credentials before creating a new identity; old grants remain tied to the old identity.

## Temporary data

The relay temporarily stores input images and generated GLBs. Uploaded results are streamed to disk, capped at 128MiB, and are not processed by the CPU as model inputs. A browser may have at most 20 retained tasks; completed transfer files expire after 24 hours or shortly after acknowledgment. Set filesystem quotas and monitor disk space for a public deployment. This is private device pairing, not an anonymous public inference pool.

## Disconnects and restarts

The relay authenticates workers over WSS, correlates RPC replies to the originating device and uses durable idempotency keys. Temporary disconnects do not reassign a running task to another device. On restart, workers reconnect and task queries resume. If the worker process itself restarts, incomplete local jobs are explicitly marked interrupted rather than silently recomputed.

Local TLS integration tests are recorded in the dated [validation report](../../docs/history/model-generation-validation.md). They do not establish production reverse-proxy or public-network compatibility.
