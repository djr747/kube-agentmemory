# Secrets Store CSI Driver

Yes: the chart accepts file-mounted credentials from any installed Secrets Store
CSI provider, including Azure Key Vault. It does not install the driver/provider
or provision your external secret store. Use `extraVolumes` for the CSI volume,
`extraVolumeMounts` for the app and `secretFiles` to map credential names to
absolute paths. Do not combine multiple sources for `AGENTMEMORY_SECRET`.

## Azure Key Vault with workload identity

Install the driver and Azure provider, enable cluster OIDC/workload identity, and
configure an identity with Key Vault Secrets User access. Its federated credential
must match your cluster issuer, subject
`system:serviceaccount:agentmemory:agentmemory-keyvault`, and audience
`api://AzureADTokenExchange`. Set the same identity client ID in the ServiceAccount
annotation and SecretProviderClass. Follow Microsoft's
[identity setup](https://learn.microsoft.com/en-us/azure/aks/csi-secrets-store-identity-access).
On a local non-AKS cluster, install/configure the provider and federation yourself;
the AKS add-on is not available there.

Store at least 32 random characters in Key Vault secret `agentmemory-secret`.
Replace the public identifiers in `examples/azure-secretproviderclass.yaml` and
`examples/csi-azure.yaml`, create namespace `agentmemory`, and apply:

```sh
kubectl apply -f examples/azure-secretproviderclass.yaml
helm upgrade --install memory ./charts/kube-agentmemory \
  --namespace agentmemory -f examples/csi-azure.yaml \
  --set image.repository=kube-agentmemory --set image.tag=dev --set image.pullPolicy=Never \
  --set engine.image.repository=kube-agentmemory-engine --set engine.image.tag=dev --set engine.image.pullPolicy=Never
```

The SecretProviderClass lives in the workload namespace. `objectAlias` supplies
the filename consumed by `AGENTMEMORY_SECRET_FILE`. The read-only volume is
mounted only into the app. The example uses `0444` so UID 65532 can read the
provider's root-owned files; restrict which containers receive the mount. No
Kubernetes Secret synchronization is needed. Workload identity webhooks may add
their own token projection; `automountServiceAccountToken: false` still prevents
the ordinary Kubernetes API token mount. Provider/node authentication traffic
is distinct from app egress. Follow the Azure provider's
[mount configuration](https://azure.github.io/secrets-store-csi-driver-provider-azure/docs/getting-started/usage/).

## OAuth credentials and rotation

Add client/cookie objects to the class, mount the volume into the proxy using
`oauth2Proxy.extraVolumeMounts`, and set:

```yaml
oauth2Proxy:
  existingSecret: ""
  secretFiles:
    clientSecret: /mnt/secrets-store/OAUTH2_PROXY_CLIENT_SECRET
    cookieSecret: /mnt/secrets-store/OAUTH2_PROXY_COOKIE_SECRET
  extraVolumeMounts:
    - {name: keyvault-secrets, mountPath: /mnt/secrets-store, readOnly: true}
```

For the Azure cookie object, store a base64-encoded 32-byte key and set
`objectEncoding: base64` to decode it to raw bytes on disk. The native proxy file
option requires raw AES bytes, whereas its environment option accepts base64.
Leave Vault disabled. Other credential files, such as `OPENAI_API_KEY`, use the
same app `secretFiles` mapping.

CSI rotation can refresh mounted files, but the app/proxy load credentials at
startup. Restart the StatefulSet after rotation; environment values also require
a restart. Do not mount secrets with `subPath`, which prevents mounted-file
updates. Render tests cover this example; real Key Vault auth/mount/rotation
requires your cloud identity and installed CSI driver.
