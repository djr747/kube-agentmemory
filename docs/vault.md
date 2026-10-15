# Vault Agent Injector

Install and configure Vault and its injector separately. This chart does not
create Vault policies, auth roles or store credential values. The injector
mutates the Pod with an init agent and a renewal sidecar, rendering credentials
before the app starts. The application reads raw credential files at boot.

Create a KV v2 record at `secret/agentmemory` with `AGENTMEMORY_SECRET` containing
at least 32 random characters. Add your chosen provider's API keys only when
needed. Grant a policy with read access to `secret/data/agentmemory` only:

```hcl
path "secret/data/agentmemory" {
  capabilities = ["read"]
}
```

Create a Kubernetes auth role bound to the chart's service account and namespace.
For release `memory`, use `serviceAccount.name: agentmemory` in your cluster's
values and bind `agentmemory` in namespace `agentmemory`. Configure the Vault
role's audience as `vault`, matching `vault.audience`. Configure Vault's
Kubernetes auth backend, CA, token reviewer and issuer for your cluster following
the [Vault Kubernetes auth guide](https://developer.hashicorp.com/vault/docs/auth/kubernetes).

```sh
helm upgrade --install memory ./charts/kube-agentmemory \
  --namespace agentmemory --create-namespace \
  -f examples/vault.yaml \
  --set serviceAccount.name=agentmemory \
  --set vault.role=agentmemory \
  --set image.repository=kube-agentmemory --set image.tag=dev --set image.pullPolicy=Never \
  --set engine.image.repository=kube-agentmemory-engine --set engine.image.tag=dev --set engine.image.pullPolicy=Never
```

The projected, audience-bound service account token is named `vault-token`.
Vault Agent mounts it through the injector's
`agent-service-account-token-volume-name` annotation; neither application
container mounts it, and automatic token mounting stays off. Agent UID/GID
65532 match the app; raw files have mode 0400 and are mounted only in `app`.
Vault delimiters remain literal in the rendered Pod annotations.

The example permits TCP 8200 to selected Vault pods in namespace `vault`.
Adapt selectors and ports to your actual service. Keep Vault TLS verification
enabled. If your Vault uses a private CA, configure injector defaults or pass
the documented `vault.hashicorp.com/tls-secret` and
`vault.hashicorp.com/ca-cert` annotations through `vault.annotations`.

For external provider keys, overlay `examples/external-provider.yaml` and set
the actual model. List each required key in `vault.fields`; missing fields make
the injector fail rather than start with absent credentials. On rotation,
restart `statefulset/memory`. Agent renewal alone cannot refresh
credentials already loaded into the Node process.

Reference: [official injector annotations](https://developer.hashicorp.com/vault/docs/deploy/kubernetes/injector/annotations).
