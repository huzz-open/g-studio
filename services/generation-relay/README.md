# Generation relay

Compatibility service for legacy clients. It routes authenticated jobs to user-owned workers without installing models or running inference.

Current web settings use direct APIs. For new connections, see the [backend guide](../generation-python/README.md).

## Start

From the repository root, with npm dependencies installed:

```sh
npm run relay:start
```

The default listener is `127.0.0.1:8787`. Public deployments require HTTPS/WSS, an exact origin allowlist and persistent relay state. Static hosting alone cannot run this service.

## Documentation

- [Configuration and reverse proxy](deployment.md): variables, HTTPS/WSS and worker connections.
- [Authorization](deployment.md#authorization): pairing, browser grants and revocation.
- [Stored results](deployment.md#stored-results): persistent files and explicit user deletion.
- [Disconnects and restarts](deployment.md#disconnects-and-restarts): recovery behavior and limits.

[Protocol](../../packages/generation-protocol/README.md) · [Documentation index](../../docs/README.md)
