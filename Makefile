XPI = zen-tabs-panel.xpi

SRC = manifest.json \
      background.js \
      experiment/api.js \
      experiment/schema.json \
      popup/popup.html \
      popup/popup.js \
      popup/popup.css \
      popup/state.js \
      popup/render.js \
      popup/keyboard.js \
      $(wildcard popup/views/*.js) \
      options/options.html \
      options/options.js \
      options/options.css \
      welcome/welcome.html \
      welcome/welcome.js \
      welcome/welcome.css \
      $(wildcard shared/*.js) \
      $(wildcard lib/*.js) \
      $(wildcard icons/*.svg) \
      LICENSE

.PHONY: build clean test

build: $(XPI)

$(XPI): $(SRC)
	rm -f $@
	zip $@ $(SRC)

test:
	node --test tests/*.test.js

clean:
	rm -f $(XPI)
