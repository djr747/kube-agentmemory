# Runtime configuration

This repository packages upstream agentmemory 0.9.30 with iii 0.22.1. The
application package and all transitive packages are locked in `package-lock.json`.
`Dockerfile.engine` copies the unchanged iii 0.22.1 binary into Google's current
Distroless C/C++ runtime to refresh its OS/OpenSSL libraries. Both app and engine
images use this project's release version and are built, tested and published together.
Google Distroless and iii images support amd64/arm64 and require no DHI credentials.
Build and runtime both use Google's Distroless Debian 13 image family. The
Node builder uses `:debug`, which provides BusyBox. It downloads pinned npm CLI
source and verifies SHA-512 integrity before extraction. Its vendor-bundled
dependencies are removed and replaced with the complete, separately locked and
audited tree in `build/npm`; every package archive is integrity-verified before
extraction. This allows compatible security patches without waiting for a new
npm bundle. Full `npm audit` covers both dependency locks. Only production
dependencies are copied into the app's `:nonroot` runtime; neither npm nor
BusyBox is shipped. The engine also uses Distroless Debian 13. The iii vendor
image is only an artifact source for its unchanged binary/data directories.
The builder approves install scripts only for the pinned ONNX Runtime and
protobuf packages needed by local embeddings. Review/update those pins when
updating dependencies.
Optional `image.digest` and `engine.image.digest` override tags for immutable
local deployments. The chart appVersion tracks this project's release, not
the upstream package version.

The container supplies these fixed Kubernetes runtime settings:

| Variable | Value |
| --- | --- |
| `HOME` | `/data/home` |
| `AGENTMEMORY_DATA_DIR` | `/data` |
| `HF_HOME` | `/data/models` |
| `XDG_CACHE_HOME` | `/data/cache` |
| `AGENTMEMORY_EXPORT_ROOT` | `/data/exports` |
| `SNAPSHOT_DIR` | `/data/snapshots` |
| `STANDALONE_PERSIST_PATH` | `/data/local.db` |
| `III_ENGINE_URL` | `ws://127.0.0.1:49134` |
| `AGENTMEMORY_URL` | `http://127.0.0.1:3111` |
| `III_REST_PORT`, `III_STREAM_PORT`, `III_VIEWER_PORT` | `3111`, `3112`, `3113` |
| `III_TELEMETRY_ENABLED` | `false` |

Do not override these ports/paths individually: the iii ConfigMap, probes,
Service and volume mounts must agree. REST uses internal port 3111; optional SSO
also exposes proxy port 4180. `service.port` can change the primary ClusterIP's
public port (default 3111); its numeric target remains 3111, or 4180 with API OIDC.
Numeric targets support the engine's restartable init container on Kubernetes
1.30–1.32. The headless Service advertises the actual listener port, 3111 or 4180,
because its DNS records return Pod IPs without port translation. Worker
and stream listeners bind loopback; the separate viewer and engine metrics
ports are not published. Use the optional [UI SSO route](oauth2-proxy.md), or
port-forward Pod port 3113 to localhost for trusted local inspection.
The application has no Kubernetes API token or RBAC permissions.

`env` accepts non-secret upstream environment variables. `extraEnv` supports
Kubernetes `valueFrom` references; `envFrom` supports an existing Secret or
ConfigMap. `extraVolumes` and `extraVolumeMounts` support externally managed
credentials, TLS certificates and other required files. Never commit plaintext
credentials into Helm values: Helm stores those values in release metadata.
Use [Secrets Store CSI](csi-secrets.md) for Azure Key Vault or another file
provider, and [resource sizing](resources.md) for CPU/memory requests and limits.

| Feature | Variables |
| --- | --- |
| API authentication (required) | `AGENTMEMORY_SECRET` (minimum 32 characters) |
| Local embeddings (default) | `EMBEDDING_PROVIDER=local` |
| OpenAI-compatible LLM | `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_TIMEOUT_MS` |
| Dedicated OpenAI-compatible embeddings | `EMBEDDING_PROVIDER=openai`, `OPENAI_EMBEDDING_API_KEY`, `OPENAI_EMBEDDING_BASE_URL`, `OPENAI_EMBEDDING_MODEL`, `OPENAI_EMBEDDING_DIMENSIONS` |
| Embeddings-only OpenAI key | `OPENAI_API_KEY_FOR_LLM=false` |
| Anthropic | `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `ANTHROPIC_MODEL` |
| Gemini | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `GEMINI_MODEL` |
| OpenRouter | `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_EMBEDDING_MODEL` |
| Other embeddings | `VOYAGE_API_KEY`, `COHERE_API_KEY`, `EMBEDDING_PROVIDER` |
| MiniMax | `MINIMAX_API_KEY`, `MINIMAX_MODEL` |
| LLM behavior | `AGENTMEMORY_AUTO_COMPRESS`, `CONSOLIDATION_ENABLED`, `GRAPH_EXTRACTION_ENABLED`, `AGENTMEMORY_REFLECT`, `MAX_TOKENS`, `FALLBACK_PROVIDERS`, `AGENTMEMORY_LLM_TIMEOUT_MS` |
| Allowed browser origins | `VIEWER_ALLOWED_ORIGINS` (comma-separated HTTPS origins) |
| Search/context | `BM25_WEIGHT`, `VECTOR_WEIGHT`, `TOKEN_BUDGET`, `MAX_OBS_PER_SESSION` |
| Index checkpoint interval | `AGENTMEMORY_INDEX_SAVE_INTERVAL_MS` (chart default 2000 ms) |
| Summaries | `SUMMARIZE_CHUNK_SIZE`, `SUMMARIZE_CHUNK_CONCURRENCY` |
| Backups | `SNAPSHOT_ENABLED`, `SNAPSHOT_INTERVAL`, `SNAPSHOT_DIR` |
| Teams | `TEAM_MODE`, `TEAM_ID`, `USER_ID` |
| Agent tagging/filtering | `AGENT_ID`, `AGENTMEMORY_AGENT_SCOPE=shared` or `isolated` |

All other upstream settings are accepted through `env`/`extraEnv`/`envFrom`.
The full reference is the versioned upstream
[environment example](https://github.com/rohitg00/agentmemory/blob/v0.9.30/.env.example).
Provider keys may trigger upstream automatic detection; explicitly choose your
embedding provider. A key alone does not enable LLM-written compression.
Local embedding tests require neither an external model runner nor paid APIs.

The upstream API validates one bearer secret per server instance. For distinct
credentials per agent, use a separate Helm release for each agent, with its own
Secret or Vault role/path, service account, PVC and TLS hostname. Use separate
namespaces if Kubernetes access must also be isolated. Configure each Vault role
to read only that agent's path and bind only its namespace/service account. Do
not reuse `fullnameOverride` or `persistence.existingClaim` between those releases.
`AGENT_ID` and recall filtering within one instance are logical memory scopes;
they do not replace per-agent authentication or authorization.

Every credential listed below accepts either its environment variable or a
`_FILE` path to a raw UTF-8 file, with one trailing newline removed:

```text
AGENTMEMORY_SECRET OPENAI_API_KEY OPENAI_EMBEDDING_API_KEY ANTHROPIC_API_KEY
GEMINI_API_KEY GOOGLE_API_KEY OPENROUTER_API_KEY MINIMAX_API_KEY
VOYAGE_API_KEY COHERE_API_KEY AGENTMEMORY_REDIS_URL
```

Use `secretFiles` to set `_FILE` paths. `AGENTMEMORY_ENV_FILE` optionally reads
a dotenv file containing only those credential names. No shell code is sourced
or expanded. Environment variables and raw file selectors take precedence over
dotenv. Simultaneous direct and `_FILE` values fail startup. Credentials and
provider clients are boot-static: restart the StatefulSet after rotation.

NetworkPolicy defaults permit API callers in the release namespace, cluster DNS,
and public IPv4 HTTPS for the first local model download. Traffic to private
networks and link-local addresses is excluded from the HTTPS rule. Add explicit
namespace/pod/port egress rules for in-cluster providers or Vault. Adjust DNS
rules for NodeLocal DNS and IPv6 rules for IPv6 clusters. Generic Kubernetes
NetworkPolicy cannot restrict internet egress by hostname. After the model is
cached, set `networkPolicy.egress: []` for a local-only deployment. Your CNI
must enforce policies. Warm and verify local vectors again before blocking
egress; changing models requires another download.

The telemetry helper override resolves upstream transitive advisories:
[GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf)
and [GHSA-45rx-2jwx-cxfr](https://github.com/advisories/GHSA-45rx-2jwx-cxfr).
The vendor's `@iii-dev/helpers` 0.24.5 uses patched OpenTelemetry 2.11 packages
and adapts to their changed APIs. The iii wire SDK and engine remain at their
upstream-matched 0.22.1 pins. SDK import and integration tests verify this
helper override. Do not remove it until upstream resolves patched dependencies.
