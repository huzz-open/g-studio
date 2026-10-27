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
| `RELAY_HOME` | `~/.g-studio/relay`; device hashes, browser grants and task metadata only; images/models are never stored here |
| `RELAY_MAX_MEMORY_MB` | Payload buffer quota, default 512MiB; output reception reserves 256MiB for a maximum 128MiB file and concatenation. `RELAY_MAX_STORAGE_MB` remains a legacy alias. |
| `RELAY_TRUSTED_PROXIES` | Comma-separated exact proxy IPs permitted to supply `X-Forwarded-For`; empty by default. With the nginx example use `127.0.0.1,::1`. |
| `RELAY_ORIGINS` | Exact comma-separated browser origins; set to the actual public HTTPS site |
| `RELAY_TLS_CERT` / `RELAY_TLS_KEY` | Optional certificate chain and private key paths for native HTTPS/WSS instead of reverse-proxy TLS termination |

## HTTPS reverse proxy

Example nginx locations inside an existing HTTPS server with a trusted certificate:

```nginx
client_max_body_size 129m;
# Disable both request-body and response buffering to avoid nginx temp files.
proxy_request_buffering off;
proxy_buffering off;
proxy_max_temp_file_size 0;
proxy_cache off;
# Overwrite incoming client-supplied values at this public edge proxy.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_http_version 1.1;
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

Pairing uses a ten-character code drawn from uppercase A–Z and digits 0–9. It expires after five minutes and grants access immediately when submitted to `POST /v1/pair`; there is no local terminal confirmation. Possession of a valid code is authorization to use this worker. A successful claim consumes the code atomically, and a consumed code cannot be republished during its original validity window. The response contains `{ state: "approved", token, deviceId }`; no polling step is required. Publishing a new code invalidates any previous outstanding code for that worker.

Browser grants expire after 30 days and can be revoked from settings. Share a fresh code with each person/browser you want to authorize. Each task belongs to the browser grant that submitted it; reads, cancellation and downloads enforce ownership. The pairing code, direct worker token, worker identity secret and resulting browser grant are different credentials. Update both worker and relay when upgrading from the old eight-character/terminal-confirmation flow.

Five invalid pairing attempts within ten minutes block the client IP for fifteen minutes (HTTP 429 and `Retry-After`), in addition to per-IP and global request limits. Only explicitly trusted proxies may supply client IP headers; do not enable this for untrusted peers. For multiple relay instances, rate limits and bans must be enforced in a shared gateway/store.

To revoke browser access, use **Unpair device**. This revokes only the current browser grant and its unfinished tasks, leaving other approved browsers unaffected. To retire a worker identity, stop it and remove its private credentials before creating a new identity; old grants remain tied to the old identity.

## Temporary data

The relay buffers input images and generated GLBs in bounded memory. Inputs are released as soon as the worker accepts the job; outputs are released after HTTP delivery (or client disconnection). Abandoned input buffers expire after two minutes, output buffers after one minute; a ten-second sweeper releases unused expired buffers. Active HTTP deliveries remain accounted for until their stream ends. Cancellation, revocation and acknowledgment also release buffers. A browser may have at most 20 task records; metadata expires after one hour (active task polling renews this deadline). Authorization and task metadata still persist in `state.json` for reconnects, but contain no image/model bytes. Known legacy `.input`/`.output` files are removed during upgrade startup.

The local worker still stores its task data separately; these relay changes do not make local inference file-free. To ensure no public transfer files are written, use the nginx buffering settings above and check any CDN/load-balancer in front of it. The Node process still has normal runtime/OS memory overhead beyond the payload quota.

## Disconnects and restarts

The relay authenticates workers over WSS, correlates RPC replies to the originating device and uses durable idempotency keys. Temporary disconnects do not reassign a running task to another device. On restart, workers reconnect and accepted task queries resume. In-memory transfer buffers are lost: an unfinished input upload must be resubmitted, while a generated output can be fetched again from the local worker until it has been acknowledged/expired. If the worker process itself restarts, incomplete local jobs are explicitly marked interrupted rather than silently recomputed.

Local TLS integration tests are recorded in the dated [validation report](../../docs/history/model-generation-validation.md). They do not establish production reverse-proxy or public-network compatibility.
