XPI = zen-tabs-panel.xpi
VARIANT ?= svelte

.PHONY: build build-vanilla build-svelte package clean test

build:
	npm run build:$(VARIANT)

build-vanilla:
	npm run build:vanilla

build-svelte:
	npm run build:svelte

package: build
	rm -f $(XPI)
	cd dist && zip -r ../$(XPI) .

test:
	npm test

clean:
	rm -rf dist
	rm -f $(XPI)
