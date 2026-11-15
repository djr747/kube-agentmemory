IMAGE ?= kube-agentmemory:dev
ENGINE_IMAGE ?= kube-agentmemory-engine:dev
GRYPE ?= grype
COPA ?= copa
PREVIOUS_IMAGE ?= ghcr.io/djr747/kube-agentmemory:0.1.3
PREVIOUS_ENGINE_IMAGE ?= ghcr.io/djr747/kube-agentmemory-engine:0.1.3
PREVIOUS_CHART ?= dist/baseline/kube-agentmemory-0.1.3.tgz

.PHONY: install check test audit chart build patch-images integration-baseline integration package security release-check release-sync
install:
	npm ci --include=optional --ignore-scripts
check:
	npm run check
	node --check tests/package-chart.mjs
	node --check tests/sync-release.mjs
	node --check tests/registry-digest.mjs
	node --check tests/publish-release.mjs
	node --check tests/external-image.mjs
	node --check tests/caddy-config.mjs
	node --check tests/helpers/integration-preflight.mjs
test: check
	npm test
audit:
	npm run audit
security: audit
	mkdir -p test-results
	$(GRYPE) docker:$(IMAGE) -o json --file test-results/grype-app.json
	$(GRYPE) docker:$(ENGINE_IMAGE) -o json --file test-results/grype-engine.json
	node tests/security-gate.mjs test-results/grype-app.json test-results/grype-engine.json
chart:
	helm lint charts/kube-agentmemory --strict --kube-version 1.30.0 --set secrets.existingSecret=agentmemory-auth --set image.tag=dev --set engine.image.tag=dev
build:
	docker build -t $(IMAGE) .
	docker build -f Dockerfile.engine -t $(ENGINE_IMAGE) .
patch-images:
	$(COPA) patch --addr docker:// --timeout 10m --image "$(IMAGE)" --tag "$(IMAGE)"
	$(COPA) patch --addr docker:// --timeout 10m --image "$(ENGINE_IMAGE)" --tag "$(ENGINE_IMAGE)"
integration-baseline:
	docker pull "$(PREVIOUS_IMAGE)"
	docker pull "$(PREVIOUS_ENGINE_IMAGE)"
	mkdir -p "$$(dirname "$(PREVIOUS_CHART)")"
	helm pull oci://ghcr.io/djr747/helm-charts/kube-agentmemory --version 0.1.3 --destination "$$(dirname "$(PREVIOUS_CHART)")"
integration:
	IMAGE=$(IMAGE) ENGINE_IMAGE=$(ENGINE_IMAGE) PREVIOUS_CHART="$(PREVIOUS_CHART)" \
	  PREVIOUS_IMAGE="$(PREVIOUS_IMAGE)" PREVIOUS_ENGINE_IMAGE="$(PREVIOUS_ENGINE_IMAGE)" node tests/integration.mjs
package:
	node tests/package-chart.mjs dist
release-check:
	node tests/release-metadata.mjs
release-sync:
	node tests/sync-release.mjs
