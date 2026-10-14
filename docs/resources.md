# Resource sizing and scaling

The defaults are a starting point for a basic, low-concurrency workload using
built-in `all-MiniLM-L6-v2` embeddings. They cover the integration workload, not
a measured capacity guarantee. The first embedding loads/downloads a model and
can use more CPU/memory than idle operation.

| Container / Helm key | CPU request | Memory request | CPU limit | Memory limit | Ephemeral request | Ephemeral limit |
| --- | --- | --- | --- | --- | --- | --- |
| App / `resources` | 250m | 512Mi | 2 CPUs | 2Gi | 100Mi | 512Mi |
| Engine / `engine.resources` | 100m | 128Mi | 1 CPU | 1Gi | 50Mi | 256Mi |
| Optional proxy / `oauth2Proxy.resources` | 50m | 64Mi | 500m | 256Mi | 10Mi | 64Mi |

Without SSO, scheduling requests total 350m CPU and 640Mi memory; limits total
3 CPUs and 3Gi. With SSO, totals are 400m/704Mi requested and 3.5 CPUs/3.25Gi
limited. Vault-injected containers, cluster services and a separate identity
provider add their own requirements. Reserve node headroom for those and model
startup; a memory request does not prevent the workload using up to its limit.

Ephemeral storage covers container logs, writable layers and disk-backed
`emptyDir` volumes, including `/tmp`. Requests total 150Mi and limits total 768Mi
without SSO, or 160Mi/832Mi with SSO. Persistent memory and downloaded model
weights use the PVC and are sized separately by `persistence.size`. Increase
`requests.ephemeral-storage` and `limits.ephemeral-storage` in the same resource
overlays when temporary files or logs grow; exceeding the Pod budget can cause
eviction.

Kubernetes schedules using requests, throttles CPU at limits and can terminate
containers that exceed memory limits. See
[Kubernetes resource management](https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/).
Use `kubectl top pod --containers` with Metrics Server, application latency and
CPU-throttling/OOM metrics to size for actual concurrent writes/searches and the
number of vectors. Raise the app's CPU/memory first for embedding pressure;
raise the engine's memory as the indexed data grows. Set requests near expected
steady usage and limits with measured startup/burst headroom.

Overlay `examples/resources.yaml` for a larger starting point, or set your own:

```sh
helm upgrade --install memory ./charts/kube-agentmemory \
  --namespace agentmemory -f your-values.yaml -f examples/resources.yaml
```

Include explicit app/engine image tags or digests, routing and secret values in
`your-values.yaml` when using the source chart.
The overlay changes all three containers independently and keeps local embeddings.
Resource changes roll the Pod and may cause a short interruption; the PVC persists.

Scale **vertically** for a single memory store. The chart deliberately fixes one
writer: extra replicas/HPA would create independent stores and do not provide
shared-memory scaling. Use separate releases/PVCs for independent agent groups.
Grow `persistence.size` with an expansion-capable StorageClass and the cluster's
PVC expansion procedure; StatefulSet volumeClaimTemplates cannot simply be
resized in place through an ordinary Helm upgrade. Back up data first.
