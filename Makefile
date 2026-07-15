.PHONY: help test lint package ci install

help: ## Show targets
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-12s %s\n", $$1, $$2}'

install: ## Create venv and install automation package + Playwright Chromium
	cd automation && python3 -m venv .venv
	cd automation && .venv/bin/pip install -U pip && .venv/bin/pip install -e ".[dev]"
	cd automation && .venv/bin/playwright install chromium

test: ## Run pytest
	cd automation && .venv/bin/pytest -q

lint: ## Syntax-check extension JS + validate manifest JSON
	@node --check extension/core/dom.js
	@node --check extension/core/prompt.js
	@node --check extension/page-patcher.js
	@node --check extension/content.js
	@node --check extension/background.js
	@node --check extension/popup.js
	@python3 -m json.tool extension/manifest.json >/dev/null
	@echo "lint OK"

package: ## Zip extension/ into dist/
	python3 scripts/package_extension.py

ci: lint test package ## Local stand-in for GitHub Actions
