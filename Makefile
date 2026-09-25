# ER2-ENGINE — a Quarto execution engine and syntax highlighter for ER2
#
# Common targets:
#   make build     compile src/er2.ts to _extensions/er2/er2.js
#   make test      render the test documents and check their output
#   make examples  render everything under examples/
#   make check     doctor + lint + build + test + examples
#   make clean     remove rendered output
#
# The engine finds ER2 as it would for a user; ER2_PYTHON=/path/to/python
# points it (and the tests) at a particular ER2 environment.

QUARTO  ?= quarto
PYTHON  ?= python3
RUFF    ?= ruff

EXT_DIR := _extensions/er2
ENGINE  := $(EXT_DIR)/er2.js
SOURCE  := src/er2.ts
RUNNER  := $(EXT_DIR)/er2_runner.py
SYNTAX  := $(EXT_DIR)/er2.xml
VERSION := $(shell cat VERSION)

.DEFAULT_GOAL := help
.PHONY: help build test examples check doctor clean distclean version bump-version \
        package release-check lint fmt

help: ## Show this help
	@echo "ER2-ENGINE $(VERSION)"
	@echo
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) \
	  | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

build: $(ENGINE) ## Compile the TypeScript engine to JavaScript

$(ENGINE): $(SOURCE)
	$(QUARTO) call build-ts-extension $(SOURCE)

test: build ## Render the test documents and check their output
	./tests/run-tests.sh

examples: build ## Render every document under examples/
	$(QUARTO) render examples

lint: ## Lint the runner with ruff
	$(RUFF) check $(RUNNER)
	$(RUFF) format --check $(RUNNER)

fmt: ## Reformat the runner with ruff
	$(RUFF) format $(RUNNER)
	$(RUFF) check --fix $(RUNNER)

doctor: ## Report whether Quarto and ER2 are usable
	@command -v $(QUARTO) >/dev/null && echo "quarto $$($(QUARTO) --version)" \
	  || { echo "quarto: not found (https://quarto.org)"; exit 1; }
	@py="$${ER2_PYTHON:-$$(head -1 "$$(command -v er2)" 2>/dev/null | sed -n 's|^#! *\(/usr/bin/env  *\)\{0,1\}||p')}"; \
	 py="$${py:-python3}"; \
	 v=$$($$py -c 'import er2; print(er2.__version__)' 2>/dev/null) \
	   && echo "er2 $$v ($$py)" \
	   || { echo "er2: $$py cannot import er2 (https://github.com/oeistools/ER2)"; exit 1; }

check: doctor lint build ## Run every check: lint, tests and examples
	@$(PYTHON) -c "import xml.dom.minidom as m; m.parse('$(SYNTAX)')" \
	  && echo "$(SYNTAX): well-formed"
	@$(MAKE) --no-print-directory test
	@$(MAKE) --no-print-directory examples

package: build ## Build the release archives into dist/
	@rm -rf dist && mkdir -p dist
	@tar --transform 's,^,er2/,' -czf dist/er2-$(VERSION).tar.gz \
	   -C $(EXT_DIR) _extension.yml er2.js er2_runner.py er2.xml
	@cd $(EXT_DIR) && zip -qr $(CURDIR)/dist/er2-$(VERSION).zip \
	   _extension.yml er2.js er2_runner.py er2.xml
	@ls -l dist

release-check: ## Check VERSION, _extension.yml, CITATION.cff and CHANGELOG agree
	@v="$(if $(V),$(V),$(VERSION))"; fail=0; \
	 got="$$(cat VERSION)"; \
	 [ "$$got" = "$$v" ] || { echo "VERSION is $$got, expected $$v" >&2; fail=1; }; \
	 got="$$(sed -n 's/^version: *//p' $(EXT_DIR)/_extension.yml)"; \
	 [ "$$got" = "$$v" ] || { echo "$(EXT_DIR)/_extension.yml is $$got, expected $$v" >&2; fail=1; }; \
	 got="$$(sed -n 's/^version: *//p' CITATION.cff)"; \
	 [ "$$got" = "$$v" ] || { echo "CITATION.cff is $$got, expected $$v" >&2; fail=1; }; \
	 grep -q "^## \[$$v\]" CHANGELOG.md || { echo "CHANGELOG.md has no section for $$v" >&2; fail=1; }; \
	 [ $$fail -eq 0 ] && echo "version $$v is consistent everywhere"; exit $$fail

clean: ## Remove rendered documents and caches
	rm -rf .quarto _site _freeze tests/freeze/_freeze tests/freeze/.quarto
	rm -f  examples/*.html tests/cases/*.html tests/cases/*.md tests/expect-fail/*.html tests/freeze/*.html
	rm -rf examples/*_files tests/cases/*_files tests/expect-fail/*_files tests/freeze/*_files
	rm -rf dist

distclean: clean ## Also remove the compiled engine
	rm -f $(ENGINE)

version: ## Print the current version
	@echo $(VERSION)

bump-version: ## Set the version everywhere: make bump-version V=0.2.0
	@test -n "$(V)" || { echo "usage: make bump-version V=x.y.z" >&2; exit 1; }
	@echo "$(V)" > VERSION
	@sed -i.bak -E 's/^version: .*/version: $(V)/' $(EXT_DIR)/_extension.yml && rm -f $(EXT_DIR)/_extension.yml.bak
	@sed -i.bak -E 's/^version: .*/version: $(V)/' CITATION.cff && rm -f CITATION.cff.bak
	@sed -i.bak -E 's/^date-released: .*/date-released: "$(shell date +%F)"/' CITATION.cff \
	  && rm -f CITATION.cff.bak
	@echo "version is now $(V), released $(shell date +%F)"
