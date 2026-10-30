# Local runtime storage

Local resources and private service data. These directories are excluded from Git and are independent of frontend dependencies and build output.

| Directory | Contents | Maintenance |
| --- | --- | --- |
| `generation/` | Verified weights, inference source, platform runtimes and download caches | Retain; deleting required files triggers preparation again |
| `generation-data/` | Device credentials and temporary jobs | Private; do not distribute |
| `archives/` | Retired local experiments | Not a production dependency |
| `verification/` | Temporary runtime-check files | Remove only when the checks no longer need them |

The launcher uses a compatible installed Node in place, or caches an official runtime if needed. Python and dependencies are separated by platform and execution profile; models and inference source are shared.

After online preparation, reuse complete resources with `sh start-generation.sh --offline --cpu` from the repository root, selecting the device profile already prepared.

See [backend configuration](../services/generation-python/deployment.md#resources-and-private-data) for custom paths, device profiles and offline operation.
