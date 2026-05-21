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

function duplicateNavigationUrlKeys(url) {
  const keys = new Set();
  if (!url) return keys;

  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return keys;
    keys.add(parsed.href);

    const pathname = parsed.pathname || "/";
    if (pathname.length > 1 && pathname.endsWith("/")) {
      const withoutSlash = pathname.replace(/\/+$/, "");
      const lastSegment = withoutSlash.split("/").pop() || "";
      if (!lastSegment.includes(".")) {
        parsed.pathname = withoutSlash;
        keys.add(parsed.href);
      }
    } else {
      const lastSegment = pathname.split("/").pop() || "";
      if (pathname.length > 1 && !lastSegment.includes(".")) {
        parsed.pathname = pathname + "/";
        keys.add(parsed.href);
      }
    }
  } catch (e) {}

  return keys;
}

this.isDuplicateNavigationUrl = function (candidateUrl, openTabUrl) {
  const candidateKeys = duplicateNavigationUrlKeys(candidateUrl);
  if (candidateKeys.size === 0) return false;
  for (const key of duplicateNavigationUrlKeys(openTabUrl)) {
    if (candidateKeys.has(key)) return true;
  }
  return false;
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    isSameMainFrameNavigationUrl: this.isSameMainFrameNavigationUrl,
    isDuplicateNavigationUrl: this.isDuplicateNavigationUrl,
  };
}
