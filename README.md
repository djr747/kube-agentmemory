# kube-agentmemory

Build and deploy [agentmemory](https://github.com/rohitg00/agentmemory) on
Kubernetes using Helm, persistent local embeddings and Vault/Secrets Store CSI secrets.
Local embeddings execute inside the app; no separate model server is needed.
External LLM and embedding providers are optional.

The chart runs one StatefulSet replica with an iii engine and an application
container sharing a retained PVC. Local state has one writer and no replication
protocol; increasing replicas would create independent memory stores. Both
containers run as UID 65532 with dropped capabilities, read-only filesystems and
restricted security contexts. Only the REST API is exposed through a ClusterIP
Service, with optional Traefik Ingress or Gateway API routing.
The application runtime uses Google's public Distroless Node image, without a
shell or package manager.

## Build and verify

Requires Kubernetes 1.30+, Node 22.23.3, Docker, Helm 3.19+, kubectl and Kind 0.33.0.
The source chart has development metadata and needs explicit image tags.
Run `make package` to generate the release chart from `package.json`.

```sh
make install
make test chart audit
make build
make integration
```

All tests use JavaScript in `tests/`. Integration creates an isolated disposable
cluster and proves authentication, real local vector generation, writes/search,
Pod replacement, mounted credential files, and PVC retention across Helm
uninstall/reinstall. See [CONTRIBUTING.md](CONTRIBUTING.md) for required checks
and the release process.

## Deploy to your cluster

Build the image and load it into your local cluster, or use a version published
by a successful release from `main`. This initial repository has no published image
until that first release. For a local Kind cluster:

```sh
kind load docker-image kube-agentmemory:dev kube-agentmemory-engine:dev --name YOUR_CLUSTER
```

For a first deployment, create namespace `agentmemory` and an existing Kubernetes
Secret named `agentmemory-auth` containing key `AGENTMEMORY_SECRET`, with at
least 32 random characters. Use your secret-management process; do not put its
value in Helm arguments, source files or committed values. For Vault, replace
the local Secret settings with `examples/vault.yaml` and follow [Vault setup](docs/vault.md).

```sh
helm upgrade --install memory ./charts/kube-agentmemory \
  --namespace agentmemory --create-namespace \
  -f examples/local.yaml \
  --set image.repository=kube-agentmemory \
  --set image.tag=dev \
  --set image.pullPolicy=Never \
  --set engine.image.repository=kube-agentmemory-engine \
  --set engine.image.tag=dev --set engine.image.pullPolicy=Never \
  --wait --timeout 10m
```

The cluster must have a default dynamic StorageClass, or set
`persistence.storageClass` to yours. Existing data volumes must be writable by
UID/GID 65532; CSI drivers must support `fsGroup`. PVCs are retained when the
release is removed. Back them up using your storage snapshot/backup system;
periodic application snapshots on the same volume do not protect against volume
loss. Do not run more than one writer against a PVC.

Port-forward for initial testing:

```sh
kubectl -n agentmemory port-forward svc/memory-kube-agentmemory 3111:3111
```

The API base is `http://127.0.0.1:3111/agentmemory`. Send
`Authorization: Bearer <AGENTMEMORY_SECRET>` for protected requests. Public
`/agentmemory/livez` supports Kubernetes probes. The first memory write downloads
`Xenova/all-MiniLM-L6-v2` into `/data/models`; network access is needed to warm
this persistent cache. Verify vectors with authenticated `/agentmemory/status`.

## Traefik access

Overlay **one** of `examples/traefik-ingress.yaml` or
`examples/traefik-gateway.yaml` onto your provider/secret values. Change the host,
certificate Secret, controller namespace and pod labels to match your cluster.
Both routes preserve `/agentmemory`; do not strip that prefix or log the
Authorization header.

Ingress uses `ingressClassName: traefik`, the `websecure` entrypoint and an
existing TLS Secret in namespace `agentmemory`. Gateway API uses an existing
HTTPS listener, standard Gateway API CRDs and Traefik's `kubernetesGateway`
provider. `examples/gateway.yaml` shows the parent Gateway with a TLS Secret in
namespace `traefik` and permission for routes from namespace `agentmemory`.
Verify your controller's [Gateway API requirements](https://doc.traefik.io/traefik/reference/install-configuration/providers/kubernetes/kubernetes-gateway/).

```sh
helm upgrade --install memory ./charts/kube-agentmemory \
  --namespace agentmemory --create-namespace \
  -f examples/local.yaml -f examples/traefik-ingress.yaml \
  --set image.repository=kube-agentmemory --set image.tag=dev --set image.pullPolicy=Never \
  --set engine.image.repository=kube-agentmemory-engine --set engine.image.tag=dev --set engine.image.pullPolicy=Never
```

Use the same command with `examples/traefik-gateway.yaml` for Gateway API after
configuring its parent Gateway. Traefik terminates TLS; bearer auth still applies
to agentmemory's protected routes. Add your gateway's rate limits, request-size
limits and access controls to suit your environment.

Optional browser SSO is available through an external OAuth2 Proxy sidecar.
Overlay `examples/oauth2-proxy.yaml` and follow [UI SSO setup](docs/oauth2-proxy.md).
The UI uses a separate hostname; the API keeps its existing bearer token so
standard agent integrations continue working. Set `oauth2Proxy.protectApi=true`
only when agents can provide verified OIDC JWTs. Provider examples cover
[Entra and local Keycloak](docs/oauth2-proxy.md). OAuth secrets support environment
references, mounted files and Vault injection. The external proxy image is not
built or scanned by this project.

For Azure Key Vault or another Secrets Store CSI provider, see
[CSI secrets](docs/csi-secrets.md) and `examples/csi-azure.yaml`. Adjust app,
engine and proxy CPU/memory independently using the documented
[defaults and scaling guidance](docs/resources.md).

## CI and security

CI validates the dependency lock, release metadata, unit/chart tests and examples.
It audits npm dependencies, scans the app **and engine** with Anchore Grype,
creates an SBOM, and runs the packaged-chart integration on native amd64 and
arm64 runners. High/critical findings with published fixes block the build; all
findings are retained in reports and unfixed high/critical findings remain visible
in the CI summary. No Aqua tools are used.
Only successful push CI on `main` publishes the exact tested images and OCI chart,
then creates the version tag/GitHub Release. `develop` is the staging branch for
reviewed PRs into `main`; it never publishes. Images include project/upstream
version tags and `latest`. See [release structure and tags](docs/release.md).
There is no automatic PR merge.
The release framework generates chart versions from `package.json`, signs app
and engine digests with Cosign, and publishes image/chart provenance plus signed
architecture SBOM attestations before applying release aliases.

For [SonarQube Cloud's free public-project analysis](https://www.sonarsource.com/open-source/),
create a project, disable automatic analysis when using CI, and configure:

- Repository secret `SONAR_TOKEN`.
- Repository variables `SONAR_PROJECT_KEY` and `SONAR_ORGANIZATION`.

When configured, CI waits for Sonar's quality gate. Missing configuration is
reported visibly; npm and Grype checks remain mandatory on all builds, including
fork pull requests. Weekly CI rechecks current advisory data and Dependabot
proposes dependency, base image and Action updates.

See [configuration](docs/configuration.md) for environment variables, external
providers, file credentials, networking and cache controls, and
[Vault setup](docs/vault.md) for injector-specific instructions.
