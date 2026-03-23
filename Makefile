XPI = zen-tabs-panel.xpi

SRC = manifest.json \
      background.js \
      experiment/api.js \
      experiment/schema.json \
      popup/popup.html \
      popup/popup.js \
      popup/popup.css \
      options/options.html \
      options/options.js \
      options/options.css \
      $(wildcard icons/*.svg) \
      LICENSE \
      README.md

.PHONY: build clean

build: $(XPI)

$(XPI): $(SRC)
	rm -f $@
	zip $@ $(SRC)

clean:
	rm -f $(XPI)
