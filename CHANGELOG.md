# Changelog

## [0.1.0] - 2026-10-14

- Initial locked agentmemory container build with built-in local embeddings.
- Secure single-writer StatefulSet Helm chart with retained storage, Vault file injection,
  environment/file credentials, Traefik Ingress and Gateway API examples.
- Dependency audit, Anchore container scanning, optional SonarQube Cloud quality gate,
  and disposable Kind integration tests before image/chart publication.
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
- Single release-version source, generated Helm package metadata, keyless image
  signatures, image/chart provenance, signed architecture SBOMs and annotated release tags.
