# Development and release procedure

All tests and verification runners use JavaScript and live in `tests/`.
Use Kubernetes 1.30+, Node 22.23.3, Docker, Helm 3.19 or newer, kubectl and Kind 0.33.0.

Run the standard checks from the repository root:

```sh
make install
make release-check
make test chart audit
make build
make integration
make security
make package
```

`make test` checks runtime syntax, secret loading, Helm rendering and security
invariants, all examples, and release/dependency synchronization. `make audit`
audits both the app lock and `build/npm` tool lock and fails on high/critical
dependency advisories. The Distroless debug builder assembles npm from verified
source and that tool lock, removing its vulnerable vendor bundle. Container CI additionally scans
both the built application and paired iii engine with Anchore Grype, failing on
high/critical findings with published fixes. Full reports retain all severities;
unfixed high/critical findings are listed in the CI summary. This policy matches
the repository owner's chosen reference procedure. There are no advisory
suppressions. Do not bypass security gates to publish.

For `make security`, install the official Grype 0.120.1 CLI or pass its path with
`GRYPE=/path/to/grype`. It writes full application/engine reports to `test-results/`
and applies the same JavaScript policy gate as CI. Reports are not committed.

`make integration` creates a disposable Kind cluster, deploys the **packaged**
chart, checks authentication, real local vector generation, memory search,
replacement-Pod persistence, file credentials, retained PVCs and reinstall
persistence. It uses a temporary kubeconfig and removes only the cluster it
created. Tests never deploy to your current cluster. Supply a packaged chart with
`CHART_ARCHIVE_DIR=dist`; CI tests the validation job's archive and publishes those
same bytes. A previously created test
cluster may be reused only with `REUSE_CLUSTER=true`, an explicit `KUBECONFIG`
and an `INTEGRATION_CLUSTER` starting with `agentmemory-integration-`.

The suite also tests the optional external OAuth2 Proxy image with a local
JavaScript OIDC issuer, using PKCE, secure cookies and both environment/file
OAuth credentials. It verifies bearer-token API access after SSO is enabled.
It then opts into API OIDC, accepts a signed JWT and rejects invalid tokens and
the original memory secret on the API Service.
The external proxy image is neither built nor scanned by this repository.

The initial model download needs public HTTPS access and a few minutes. Allow
at least 4 GiB for the test cluster. Current Kind supports
[NetworkPolicy enforcement](https://github.com/kubernetes-sigs/kind/releases/tag/v0.24.0).
API OIDC integration also checks that direct backend Pod-IP access is blocked
from its separate test client. Verify isolation on your actual CNI before exposing
the service. Live Vault authentication and Traefik TLS routing require your
cluster's services; their manifests are covered by render tests.

`package.json` is the sole release version source. Update its version and add a
dated CHANGELOG entry on `develop`, update version-specific examples, then run
`make release-sync release-check`. Committed chart metadata stays at `0.0.0`;
`make package` generates both chart version/appVersion and checks default app and
engine tags from the package version. Do not manually version the source chart.
Run the full standard checks on `develop`, then prepare a reviewed PR into
`main`. Only successful push CI on `main` publishes the tested amd64/arm64
images, signs their index digests, attests image/chart provenance and architecture
SBOMs, publishes release aliases/OCI chart, and creates the annotated version tag
and GitHub Release. Do not create
release tags in advance. Develop/PR/scheduled/manual CI never publishes.
It never merges a pull request or pushes a source branch. See
[release structure](docs/release.md) for image aliases and artifact details.

When changing the upstream agentmemory pin, check its official npm manifest
and Docker Compose documentation, update `Dockerfile.engine`'s source image to
the exact matching `iii-sdk` version, regenerate the dependency lock and rerun all checks.
Verify official image tag availability and registry access before any change.
To refresh base packages without a version change, rebuild the same documented
base tag; CI does not cache container builds. Dependency and Action updates are
proposed weekly by Dependabot; they still need review and the full CI suite.

For an npm build-tool update, verify its official registry version, Node engines,
tarball URL and SHA-512 integrity. Update `build/npm/package.json`'s version,
`npmSource` and dependency constraints to the vendor manifest, then regenerate
its lock with `npm install --prefix build/npm --package-lock-only --ignore-scripts`.
Audit both locks and rerun the container build/integration. The source archive's
bundled dependencies are discarded; the separately locked graph must be clean.
Review the app's version-pinned `allowScripts` entries after native dependency
updates. Do not add blanket install-script approval.
