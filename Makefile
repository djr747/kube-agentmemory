IMAGE ?= kube-agentmemory:dev
ENGINE_IMAGE ?= kube-agentmemory-engine:dev
GRYPE ?= grype
PREVIOUS_IMAGE ?= kube-agentmemory:previous
PREVIOUS_ENGINE_IMAGE ?= kube-agentmemory-engine:previous
PREVIOUS_CHART ?= dist/baseline/kube-agentmemory-0.1.2.tgz

.PHONY: install check test audit chart build integration-baseline integration package security release-check release-sync
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
integration-baseline:
	baseline=$$(mktemp -d); trap 'rm -rf "$$baseline"' EXIT; \
	  git archive v0.1.2 > "$$baseline/source.tar" && tar -xf "$$baseline/source.tar" -C "$$baseline" && rm "$$baseline/source.tar" && \
	  docker build -t "$(PREVIOUS_IMAGE)" "$$baseline" && \
	  docker build -f "$$baseline/Dockerfile.engine" -t "$(PREVIOUS_ENGINE_IMAGE)" "$$baseline" && \
	  helm package "$$baseline/charts/kube-agentmemory" --version 0.1.2 --app-version 0.1.2 --destination "$$(dirname "$(PREVIOUS_CHART)")"
integration:
	IMAGE=$(IMAGE) ENGINE_IMAGE=$(ENGINE_IMAGE) PREVIOUS_CHART="$(PREVIOUS_CHART)" \
	  PREVIOUS_IMAGE="$(PREVIOUS_IMAGE)" PREVIOUS_ENGINE_IMAGE="$(PREVIOUS_ENGINE_IMAGE)" node tests/integration.mjs
package:
	node tests/package-chart.mjs dist
release-check:
	node tests/release-metadata.mjs
release-sync:
	node tests/sync-release.mjs
