XPI = zen-tabs-panel.xpi

.PHONY: build package xpi clean test

build:
	npm run build

package: build
	rm -f $(XPI)
	cd dist && zip -r ../$(XPI) .

xpi: package

test:
	npm test

clean:
	rm -rf dist
	rm -f $(XPI)
