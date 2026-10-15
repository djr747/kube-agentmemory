IMAGE ?= kube-agentmemory:dev
ENGINE_IMAGE ?= kube-agentmemory-engine:dev
GRYPE ?= grype

.PHONY: install check test audit chart build integration package security release-check release-sync
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
integration:
	IMAGE=$(IMAGE) ENGINE_IMAGE=$(ENGINE_IMAGE) node tests/integration.mjs
package:
	node tests/package-chart.mjs dist
release-check:
	node tests/release-metadata.mjs
release-sync:
	node tests/sync-release.mjs
