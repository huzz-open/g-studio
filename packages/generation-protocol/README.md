# Generation protocol v1

Shared contract for AI and algorithm providers, browser clients and the generation backend.

## Contract files

| File | Purpose |
| --- | --- |
| [types.ts](types.ts) | TypeScript requests, jobs, capabilities and results |
| [schema.json](schema.json) | JSON validation schemas |
| [openapi.json](openapi.json) | HTTP endpoints and authentication |

Update types, schemas, OpenAPI, validators and both clients and services together when changing the contract.

## Documentation

- [HTTP endpoints and task lifecycle](protocol.md#http-endpoints).
- [Geometry result format and import limits](protocol.md#geometry-result).
- [Provider extension](protocol.md#add-a-python-provider).
- [Loading, residency and timing](protocol.md#loading-residency-and-timing).
- [Legacy relay transport](protocol.md#relay-transport).

[Backend](../../services/generation-python/README.md) · [Part storage (中文)](../../docs/reference/parts.md) · [Documentation index](../../docs/README.md)
