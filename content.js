// content.js
// This script runs in every webpage to catch and clean URLs in the address bar
// that Single Page Applications (SPAs) modify via History API without triggering full network requests.

let trackingParams = new Set();
let isGloballyDisabled = false;
let isAllowedOnDomain = false;

// 1. Initialize
async function init() {
  const currentDomain = window.location.hostname;

  // Ask background script for current rules and state
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getState",
      domain: currentDomain,
    });
    if (response) {
      isGloballyDisabled = response.isGloballyDisabled;
      isAllowedOnDomain = response.isAllowed;
      trackingParams = new Set(response.trackers || []);

      cleanCurrentUrl();
    }
  } catch (e) {
    // Background script might not be ready
    console.debug("NeatURL: Could not fetch initial state.");
  }
}

// 2. The Cleaning Logic
function cleanCurrentUrl() {
  if (isGloballyDisabled || isAllowedOnDomain || trackingParams.size === 0)
    return;

  try {
    const url = new URL(window.location.href);
    let changed = false;

    // 1. Clean Query Parameters (?)
    const paramsToDelete = [];
    url.searchParams.forEach((value, key) => {
      if (trackingParams.has(key)) paramsToDelete.push(key);
    });

    if (paramsToDelete.length > 0) {
      paramsToDelete.forEach((key) => url.searchParams.delete(key));
      changed = true;
    }

    // 2. Clean Hash Parameters (#)
    // Some SPAs like Facebook put parameters like _rdc after the hash
    if (url.hash && url.hash.includes("=")) {
      // The hash string includes the '#' e.g. '#_rdc=1&_rdr'
      const hashContent = url.hash.substring(1);

      const hashParams = new URLSearchParams(hashContent);
      let hashParamsToDelete = [];

      hashParams.forEach((value, key) => {
        if (trackingParams.has(key)) hashParamsToDelete.push(key);
      });

      if (hashParamsToDelete.length > 0) {
        hashParamsToDelete.forEach((key) => hashParams.delete(key));
        url.hash = hashParams.toString() ? "#" + hashParams.toString() : "";
        changed = true;
      }
    }

    if (changed) {
      // Use replaceState to update the URL bar without reloading or adding to history
      window.history.replaceState(null, "", url.toString());

      const totalRemoved =
        paramsToDelete.length +
        (typeof hashParamsToDelete !== "undefined"
          ? hashParamsToDelete.length
          : 0);
      if (totalRemoved > 0) {
        chrome.runtime.sendMessage({
          action: "recordStats",
          domain: window.location.hostname,
          count: totalRemoved,
        });
      }
    }
  } catch (e) {
    // Ignore invalid URLs
  }
}

let lastCheckedUrl = window.location.href;

// 3. Setup Observers for SPAs
// Modern heavy SPAs like Facebook bypass standard History API monkey patches.
// We use a frequent interval combined with a URL change detection.
setInterval(() => {
  if (window.location.href !== lastCheckedUrl) {
    lastCheckedUrl = window.location.href;
    cleanCurrentUrl();
  }
}, 500); // Check every 500ms for URL changes

// Also attempt to use the newer Navigation API where supported
if (window.navigation) {
  window.navigation.addEventListener("navigate", (event) => {
    // Wait a brief moment for the framework to finish its internal state update
    setTimeout(cleanCurrentUrl, 50);
  });
}

// And keep the fallback popstate
window.addEventListener("popstate", () => setTimeout(cleanCurrentUrl, 50));

// 4. Listen for live settings changes from Popup/Options
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    if (changes.isGloballyDisabled) {
      isGloballyDisabled = changes.isGloballyDisabled.newValue;
    }
    if (changes.allowlist) {
      isAllowedOnDomain = (changes.allowlist.newValue || []).includes(
        window.location.hostname,
      );
    }
    if (changes.upstreamParams || changes.customTrackers) {
      // Re-fetch everything if rules change
      init();
    } else {
      cleanCurrentUrl();
    }
  }
});

// Run
init();
