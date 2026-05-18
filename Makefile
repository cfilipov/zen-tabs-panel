XPI = zen-tabs-panel.xpi
VARIANT ?= svelte

.PHONY: build build-vanilla build-svelte package package-vanilla package-svelte xpi clean test

build:
	npm run build:$(VARIANT)

build-vanilla:
	npm run build:vanilla

build-svelte:
	npm run build:svelte

package: build
	rm -f $(XPI)
	cd dist && zip -r ../$(XPI) .

package-vanilla:
	$(MAKE) package VARIANT=vanilla

package-svelte:
	$(MAKE) package VARIANT=svelte

xpi: package

test:
	npm test

clean:
	rm -rf dist
	rm -f $(XPI)
