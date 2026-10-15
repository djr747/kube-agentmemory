# Release process

`develop` is the staging branch. Prepare changes, version metadata and the
changelog there, then open a reviewed PR into `main`. Both branches and PRs run
validation, security scans and packaged-chart integration. **Only a push to
`main` can publish images, an OCI chart or a GitHub Release.** Develop, PR,
manual, tag and scheduled runs do not publish. There is no automated PR merge.

`package.json` is the version source. Before a release:

1. Update its stable SemVer version and add the matching dated `CHANGELOG.md`
   section on `develop`; update version-specific examples together.
2. Run `make release-sync release-check`. The JavaScript sync command updates
   lockfile version metadata; the check validates the version, lock and release
   notes. It does not commit, create a tag or publish.
3. Run the standard checks in [CONTRIBUTING.md](../CONTRIBUTING.md).
4. Have a human review and merge the `develop` → `main` PR.

The committed chart uses `0.0.0` development metadata, like the reflector
repository. Do not maintain another release number in `Chart.yaml`. `make package`
reads `package.json` and supplies that version as both Helm `version` and
`appVersion`, then verifies the archive and its app/engine image defaults. CI
performs this packaging on PRs and branch pushes; both integration jobs download
and test that exact archive. A source-chart install requires explicit app and
engine image tags or digests. A packaged/released chart defaults to its generated
release version.

New chart installs name Kubernetes resources after the Helm release name. Before
upgrading an installation created by an earlier chart version, set
`fullnameOverride` to its existing StatefulSet name to preserve the StatefulSet
and its PVC identity. For the existing `agentmemory` release, that value is
`agentmemory-kube-agentmemory`; shortening it requires a separate, data-preserving
PVC migration.

After CI succeeds on main, the reusable release workflow:

1. Checks the source revision and remote release state. An existing `vX.Y.Z`
   tag must be annotated and point to that exact tested commit; a published
   matching release makes publication a no-op.
2. Uploads the **exact tested** amd64/arm64 app and engine images and assembles
   their immutable multi-platform indexes; it does not rebuild the candidates.
3. Signs both index digests with keyless Cosign using GitHub OIDC and attaches
   signed SPDX SBOM attestations to each architecture's image digest.
4. Creates provenance attestations for both image indexes and the tested chart
   archive. Image provenance is stored in GHCR and GitHub; chart provenance is
   stored in GitHub.
5. Applies version/upstream/`latest` aliases to the signed digests, publishes the
   tested OCI chart, creates an annotated `vX.Y.Z` tag at the tested main commit,
   and creates a draft GitHub Release with that existing tag. It uploads all
   release assets before publishing the draft.

Signing/provenance must succeed before release aliases and the chart are
published. The release includes the chart, per-architecture app/engine SPDX SBOMs
and all three provenance bundles. No long-lived signing secret is needed;
release permissions include `id-token: write` and `attestations: write`. GitHub
artifact attestations are available for public repositories on free plans; check
[GitHub's availability and permissions](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
if using a private fork. Bump the
version for every main release; do not pre-create a release tag. Publication is
not atomic across GHCR and GitHub: a failed run may leave partial artifacts.
Rerun the same main workflow at the same commit to recover: it reuses a matching
tag and draft, replaces partial draft assets and publishes only after every upload
succeeds. Published GitHub Releases are left untouched, and a tag pointing to
another commit blocks publication before registry changes. Fixes on a different
commit require a new version. No tag deletion or forced tag update is needed.

For both image repositories, the next release aliases are:

| Tag | Purpose |
| --- | --- |
| `0.1.2` | Project release; the chart's default |
| `0.1` / `0` | Moving minor/major aliases |
| `0.1.2-agentmemory0.9.30-iii0.22.1` | Project plus exact upstream agentmemory/iii versions |
| `latest` | Most recently published successful main release |
| `sha-COMMIT-amd64` / `sha-COMMIT-arm64` | Exact architecture candidates |

Upstream tags are generated from the locked versions, not maintained separately.
OAuth2 Proxy and Keycloak are external images and are not published by this
project. Pin a release tag or digest in production; `latest` changes over time.

Install a published chart:

```sh
helm upgrade --install memory oci://ghcr.io/djr747/helm-charts/kube-agentmemory \
  --version X.Y.Z --namespace agentmemory --create-namespace \
  -f your-values.yaml
```

GHCR packages may initially be private. Configure their visibility for public
consumption or authenticate Docker/Helm with permission to read packages. For
unreleased development builds, use the local chart and explicit local image tags
shown in the README. No artifacts are published until a successful main release.

## Verify release artifacts

Install Cosign and the GitHub CLI, then verify a pinned image digest:

```sh
cosign verify ghcr.io/djr747/kube-agentmemory@sha256:IMAGE_DIGEST \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github\.com/djr747/kube-agentmemory/\.github/workflows/(ci|release)\.yml@refs/heads/main$'
gh attestation verify oci://ghcr.io/djr747/kube-agentmemory@sha256:IMAGE_DIGEST \
  --repo djr747/kube-agentmemory
gh attestation verify kube-agentmemory-X.Y.Z.tgz --repo djr747/kube-agentmemory
```

Apply the same image verification to `kube-agentmemory-engine`. Check the
attestation's source commit against the release tag. Cosign SBOM attestations
are attached to the architecture image digests referenced by the signed index;
the release also provides their readable JSON files. See the official
[Cosign signing/verification guide](https://docs.sigstore.dev/cosign/signing/signing_with_containers/).

The workflow configuration and release retry cases are tested without publishing,
including failures after tag creation, draft creation and partial asset uploads.
Keyless signing, registry attestation uploads and GitHub Release
creation need a real main GitHub Actions run; local tests do not prove those
external operations.
