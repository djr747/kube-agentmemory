# Caddy validation status

Validated on 2026-10-15. Functional checks pass. The image security gate covers
only the application and engine images built by this repository.

## Passed

- Locked installation, unit/chart tests, strict Helm lint, both npm audits,
  app/engine builds, release metadata checks and 0.1.2 chart packaging.
  Final local checks used Node 22.23.3 and the repository's verified npm 12.2.0.
- The official Caddy parser verifies the loopback listener stays on 4181,
  health and Origin checks execute before proxying, and the stream destination
  follows `engine.streamPort` at both 443 and 3212.
- Full packaged-chart integration (`make integration`, exit 0) in disposable
  cluster `agentmemory-integration-31517`, followed by successful cluster removal.
- Local embeddings, memory search, pod-replacement and reinstall persistence,
  retained PVCs, and environment/file credentials.
- Through the UI Service from a separate pod: PKCE login, group rejection,
  secure cookies, HTTP UI/API access, authenticated root WebSocket upgrades,
  delivery of live memory events and rejection of cross-origin upgrades.
- Session reuse with missing, rewritten and chained forwarding headers; private
  Caddy/viewer/stream ports are inaccessible from the separate client.
- Standard bearer clients remain functional with UI SSO enabled. The separate
  opt-in API OIDC case accepts a valid JWT, rejects missing/invalid credentials,
  and blocks direct Pod-IP access to the REST backend.
- App and engine scans pass the existing policy. Each still contains 11
  high/critical matches without published fixes.

Caddy executes the packaged binary directly. Its container drops all capabilities
and adds only `NET_BIND_SERVICE`, matching the official binary's file capability.
It runs nonroot with a read-only root filesystem and no secret mounts. No binary
is copied to a temporary volume. Caddy's capability comes from the image packaging,
independent of its high listener port; the engine's capability remains conditional
on its stream port being below 1024.

## Image scan scope

CI and `make security` scan only the application and engine images built here.
The high/critical policy for those images remains enforced. Stock Caddy and
OAuth2 Proxy are external images covered by the functional integration suite.
Their images are not scanned by this repository.

Live Entra, Vault and production ingress were not exercised by these changes.
Nothing was deployed to the production cluster.
