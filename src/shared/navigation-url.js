"use strict";

// Helpers for comparing browser tab URLs with main-frame request URLs.
//
// webRequest main_frame URLs are network request URLs, so they do not carry
// fragments. browser.tabs.get(tabId).url can still include the fragment. Treat
// those as the same in the duplicate-navigation blocker so reloads/current-page
// navigations do not look like fresh duplicate-link clicks.

this.isSameMainFrameNavigationUrl = function (tabUrl, requestUrl) {
  if (!tabUrl || !requestUrl) return false;
  if (tabUrl === requestUrl) return true;

  try {
    const tab = new URL(tabUrl);
    const request = new URL(requestUrl);
    if (!/^https?:$/.test(tab.protocol) || !/^https?:$/.test(request.protocol)) {
      return false;
    }

    tab.hash = "";
    request.hash = "";
    return tab.href === request.href;
  } catch (e) {
    return false;
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isSameMainFrameNavigationUrl: this.isSameMainFrameNavigationUrl,
  };
}
