# Changelog

## [0.1.3] - 2026-11-13

- Update AgentMemory to 0.9.33 with its matching iii 0.25.1 engine and SDK. Start the pinned HTTP and state workers with Worker Compose, retaining the existing PVC and database path.
- Serve viewer live events over authenticated HTTP through the existing HTTPS Ingress. Add an upgrade test from 0.1.2 and exercise OIDC, live events, and memory with WebSocket upgrades rejected.
- Update dotenv to 18.0.9 and incorporate compatible Dependabot build dependencies and Actions. Keep the undici 8.12.4 security fix.
- Patch both Distroless images with Copa before scanning. Block publication on every High or Critical image finding. Run the Ingress suite once on amd64 and check that the viewer can load a migrated memory.

## [0.1.2] - 2026-10-14

- Preserve Vault secret filename case so file-backed credentials match their configured paths.
- Render PVC template `apiVersion` and `kind` to prevent Argo CD server-side diff drift.
- Name new Kubernetes resources after the Helm release; preserve existing StatefulSet/PVC names with `fullnameOverride` during upgrades.
- Bind the iii stream listener to port 443 by default so the viewer WebSocket uses the UI HTTPS ingress or Gateway API route.
- Make the stream listener port configurable through `engine.streamPort` / `III_STREAM_PORT`, including the restricted bind capability for ports below 1024.
- Reject stream ports that collide with fixed pod listeners, including OAuth2 Proxy and Caddy while UI SSO is enabled.
- Reject `III_STREAM_PORT` overrides through both `env` and `extraEnv`, including references, to keep the app, engine and Caddy on the same stream port.
- Route UI HTTP/WebSocket requests through OAuth2 Proxy and a private stock Caddy sidecar, using standard Ingress/Gateway API backends without upstream patches or custom proxy code.
- Validate WebSocket origins against chart configuration, strip backend credentials and preserve bearer API access on its separate route; no ingress session affinity is required.
- Cover authenticated UI/WebSocket access through the UI Service in integration tests; image scanning remains limited to the application and engine images built by this project.
- Allow only `NET_BIND_SERVICE` on the Caddy container to execute the official image's file-capability binary directly, without copying it at startup.

## [0.1.1] - 2026-10-14

- Update checkout to 7.0.1, setup-node to 7.1.0, upload-artifact to 7.0.2,
  download-artifact to 8.0.2 and setup-helm to 5.0.1 at verified vendor commits.
- Update dotenv to 18.0.8 and refresh the application dependency lock.
- Stage grouped Dependabot version updates through develop and keep npm tool
  updates within vendor dependency ranges, verified again during bootstrap.
- Keep the upstream-supported iii engine/SDK pair at 0.22.1; newer engines remove
  the worker configuration lifecycle required by agentmemory 0.9.30.

## [0.1.0] - 2026-10-14

- Initial locked agentmemory container build with built-in local embeddings.
- Secure single-writer StatefulSet Helm chart with retained storage, Vault file injection,
  environment/file credentials, Traefik Ingress and Gateway API examples.
- Dependency audit, Anchore container scanning and disposable Kind integration
  tests before image/chart publication.
- Token-free SonarQube Cloud Automatic Analysis through its GitHub App, with
  source/test configuration and separate PR quality-gate setup.
- Optional external OAuth2 Proxy sidecar for UI-only SSO on a separate hostname,
  preserving standard bearer-token agent integrations.
- Native engine sidecar and shutdown flush delay to retain vector checkpoints
  across Pod replacement and Helm reinstall.
- Opt-in API OIDC protection, Entra and local Keycloak examples, Azure Key Vault
  CSI file mounts and documented resource sizing.
- Develop staging and main-only releases with upstream-version/latest image
  aliases, OCI charts and GitHub Release artifacts.
- Google Distroless Debian 13 throughout: debug build stage with audited,
  checksum-verified npm and shell-free nonroot app/engine runtimes.
- Shared locked npm tooling for CI and builds to preserve platform metadata
  during dependency-lock freshness checks.
- API bearer/OIDC integration waits for replacement Service routing before checking
  authentication, while preserving strict HTTP and NetworkPolicy assertions.
- Hardened npm bootstrap destinations and private extraction directories,
  script-free CI installation, bounded worker downloads, simpler credential and
  readiness handling, and adjustable ephemeral-storage budgets for all containers.
- Numeric Service targets support the engine sidecar on Kubernetes 1.30–1.32;
  headless Services expose the actual listener even with custom API ports or OIDC.
- Single release-version source, generated Helm package metadata, keyless image
  signatures, image/chart provenance, signed architecture SBOMs and annotated release tags.
- Retryable release publication reuses tags at the tested commit and incomplete
  drafts, uploads all assets before publishing, and preserves published releases.
