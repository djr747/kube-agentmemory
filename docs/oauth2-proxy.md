# Optional UI single sign-on

The optional OAuth2 Proxy sidecar protects the browser UI on a **separate TLS
hostname**. By default it preserves bearer API authentication. API OIDC is an
explicit opt-in; see below.

| Client | Example endpoint | Authentication |
| --- | --- | --- |
| Agent integrations / stdio MCP shim | `https://memory.example.com` | Existing `AGENTMEMORY_SECRET` bearer |
| Browser UI | `https://memory-ui.example.com` | Your OIDC identity provider and a secure session cookie |

The published `quay.io/oauth2-proxy/oauth2-proxy:v7.15.5` image is an external
dependency. This project does not build, publish or scan it. Its repository,
version and optional digest are configurable in `oauth2Proxy.image`. Consult
its [official configuration documentation](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/)
before changing versions or registry settings.

Register a confidential OIDC client with your provider. Use exact redirect URI
`https://memory-ui.example.com/oauth2/callback` and authorization code flow with
PKCE S256. Configure the issuer URL, client ID and allowed email domains/groups.
Only explicitly allowed provider identities receive access; `emailDomains: ['*']`
deliberately permits all users authenticated by that provider.

Create an existing Kubernetes Secret `agentmemory-oauth` with:

- `OAUTH2_PROXY_CLIENT_SECRET`: the OIDC client's secret.
- `OAUTH2_PROXY_COOKIE_SECRET`: a base64/base64url-encoded random 32-byte cookie key.

To generate a cookie key using Node:

```sh
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))"
```

Keep generated values in your secret manager. Do not commit them or pass them
in Helm values/arguments. Overlay these example files with your actual domains,
provider and TLS certificate Secrets:

```sh
helm upgrade --install memory ./charts/kube-agentmemory \
  --namespace agentmemory --create-namespace \
  -f examples/local.yaml \
  -f examples/traefik-ingress.yaml \
  -f examples/oauth2-proxy.yaml \
  --set image.repository=kube-agentmemory --set image.tag=dev --set image.pullPolicy=Never \
  --set engine.image.repository=kube-agentmemory-engine --set engine.image.tag=dev --set engine.image.pullPolicy=Never
```

Use your built/published app and engine image settings as described in the
README. The chart creates an additional UI Ingress; the original API Ingress
continues forwarding `/agentmemory` to REST port 3111. The UI Ingress forwards
`/`, `/oauth2/*`, and same-origin browser API calls to proxy port 4180. Traefik
must terminate TLS and supply trusted forwarding headers. OAuth2 Proxy uses
Secure, HttpOnly, SameSite=Lax cookies, nonce verification and PKCE. HTTP access
does not provide a working login session because cookies require HTTPS.

For Gateway API, overlay `examples/traefik-gateway.yaml` instead. The chart
creates separate API and UI HTTPRoutes. The parent HTTPS listener must accept
**both** hostnames and its certificate must cover both; an API-only hostname on
the listener will reject the UI route. Keep routing to the two backends separate.

The sidecar forwards to the viewer on loopback port 3113. That local viewer
authenticates upstream REST requests using the private memory secret. Neither
the viewer port nor worker/stream ports receive a Kubernetes Service. Browser
users log in with the identity provider and do not need the backend bearer
secret. Outside this SSO route, the upstream viewer's Unlock prompt uses
`AGENTMEMORY_SECRET`; there is no default username/admin password. For trusted
local inspection, port-forward Pod port 3113 to localhost; the loopback viewer
already has the server token and does not prompt for it.

## Vault or mounted files

To use Vault, overlay `examples/vault.yaml`, `examples/oauth2-proxy.yaml`, and
`examples/oauth2-proxy-vault.yaml`. Add `OAUTH2_PROXY_CLIENT_SECRET` and
`OAUTH2_PROXY_COOKIE_SECRET` alongside `AGENTMEMORY_SECRET` in the Vault KV v2
record. The client secret is rendered without a trailing newline. The cookie
field is stored as base64 and rendered using Vault's `base64Decode` template
function because the native `--cookie-secret-file` expects raw binary AES key
bytes, not base64 text. The injector mounts files only in the app/proxy
containers and runs with their UID/GID. Restart after credential rotation.

Alternatively set `oauth2Proxy.secretFiles.clientSecret` and
`oauth2Proxy.secretFiles.cookieSecret` and use `extraVolumes` plus
`oauth2Proxy.extraVolumeMounts` to mount your existing credential files. The
cookie file must contain exactly 16, 24 or 32 raw bytes. Leave `existingSecret`
empty when using files. Add NetworkPolicy egress selectors/ports for an
in-cluster identity provider; public HTTPS providers use the default allowance.
For Secrets Store CSI/Azure Key Vault, see [CSI file secrets](csi-secrets.md).

## Microsoft Entra ID

Overlay `examples/oidc-entra.yaml` instead of the generic OAuth example. Create a
single-tenant app registration with a Web redirect URI exactly matching the UI
callback. Set the tenant ID, application client ID and allowed email domain;
store the client secret value in `agentmemory-oauth` or your file secret store.
Request `openid profile email` and configure the `email` ID-token claim if needed.
Enable user assignment on the enterprise application to limit admission.

The example uses generic OIDC with a tenant-specific issuer and no Microsoft
Graph access. If restricting groups, emit the `groups` claim and configure
`allowedGroups` with group object IDs. Generic OIDC does not resolve group
overage; users whose token omits those groups are denied. For large memberships,
the `entra-id` provider needs additional Graph consent/scopes configured for your
tenant. See the official [Entra provider guide](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/ms_entra_id/).

## Keycloak on a local cluster

`examples/keycloak-local.yaml` runs an external Keycloak 26.8.0 development
instance behind Traefik. Create namespace `identity`, an existing TLS Secret
`identity-tls`, and a bootstrap Secret `keycloak-bootstrap` containing key
`password`. Substitute your local DNS hosts in both Keycloak and the OAuth
values. The browser and app must resolve/reach `https://identity.example.com`,
and the proxy must trust its TLS certificate. Use a trusted local CA; do not
disable certificate or issuer verification. Configure the perimeter so only
Traefik can reach the identity service and sanitizes forwarding headers.
The Keycloak values allow issuer HTTPS egress to Traefik; adjust its namespace,
labels and listener target ports for your cluster.

```sh
kubectl apply -f examples/keycloak-local.yaml
```

Log into Keycloak's admin console using `admin` and your bootstrap secret.
Create realm `agentmemory` and OIDC client `agentmemory`: client authentication
on, standard authorization-code flow on, direct access grants off, exact redirect
URI `https://memory-ui.example.com/oauth2/callback`, and PKCE S256 required.
Copy its client secret to your secret store. Add a test user with a verified
email in the allowed domain and a password. Add an audience mapper for client
`agentmemory` to ID/access tokens, especially for JWT API callers; map `groups`
if configuring `allowedGroups`.

```sh
helm upgrade --install memory ./charts/kube-agentmemory \
  --namespace agentmemory --create-namespace \
  -f your-image-and-secret-values.yaml -f examples/traefik-ingress.yaml \
  -f examples/oidc-keycloak.yaml
```

This example uses `start-dev` and ephemeral realm storage: replacement loses
configuration. For durable use, deploy production Keycloak with a supported
database, backups and its own resource/network controls. It is separate from
the memory chart and is not built/published by this project. See
[Keycloak's local quickstart](https://www.keycloak.org/getting-started/getting-started-docker),
[reverse-proxy setup](https://www.keycloak.org/server/reverseproxy), and
[OAuth2 Proxy's Keycloak guide](https://oauth2-proxy.github.io/oauth2-proxy/configuration/providers/keycloak_oidc/).

## Optional OIDC protection for API endpoints

`oauth2Proxy.protectApi` defaults to **false**. To protect the API as well,
overlay `examples/oauth2-api.yaml` on your provider settings. This also enables
verified JWT bearer support. API and headless Services then send requests to the
proxy, and the NetworkPolicy removes inbound port 3111 while allowing 4180.
Ingress and Gateway API both retain the `/agentmemory` path through those
Services. The private loopback viewer supplies the backend memory secret after
the proxy authenticates the caller.

Standard memory-secret clients fail on this protected route. They must obtain a
signed JWT from the configured issuer with matching audience (client ID, or an
explicit `extraJwtIssuers` issuer/audience pair). Supply it as
`Authorization: Bearer <JWT>`. Arbitrary Graph access tokens and the memory
secret are not suitable OIDC credentials. API paths return 401/403 instead of
redirecting unauthenticated requests to browser login. Browser API requests on
the UI hostname continue using its session cookie; its host-only cookie does
not authorize a different API hostname.

OAuth2 Proxy validates tokens according to its configured provider/claims; it
does not implement application-specific scopes, per-agent authorization or MCP
OAuth discovery/client registration. Configure provider admission deliberately
and test the tokens your agents acquire. See
[verified JWT and API-route options](https://oauth2-proxy.github.io/oauth2-proxy/configuration/overview/).
Keep the default off for standard agent integrations.

The app/engine still use bearer auth internally and probes reach their private
port. Enforcing NetworkPolicy is necessary to prevent direct Pod-IP access to
3111 bypassing the proxy; do not publish another direct Service/route or permit
broad policies for that port. This switch protects the chart's access paths,
not administrator port-forward/exec access.

## Agent identities and MCP

UI login admits users to the instance's memory; it does not bind an OIDC user to
an agent-specific memory namespace or create agent credentials. Use separate
releases, Vault roles and PVCs for separate access boundaries. Shared-secret API
clients retain their existing behavior.

`oauth2Proxy.skipJwtBearerTokens` is an optional setting for callers of the UI
proxy endpoint that already possess a valid JWT with the configured audience.
It does not accept the plain memory secret as an OIDC JWT. OAuth2 Proxy is not
an MCP OAuth discovery/dynamic-registration service; enabling UI SSO alone does
not add OAuth authentication to the upstream stdio MCP shim.

The JavaScript integration suite uses a disposable local OIDC issuer to check
PKCE login, nonce verification, cookies, UI/API access, denial of anonymous
requests, environment/file OAuth secrets and unchanged default bearer integrations.
It also enables API OIDC and verifies valid JWT access and rejection of absent,
expired, tampered, wrong-audience/issuer and memory-secret credentials.
Production identity-provider registration and live Traefik TLS must still be
configured in your cluster.
