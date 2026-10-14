# Changelog

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
