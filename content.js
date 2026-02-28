// content.js
// This script runs in every webpage to catch and clean URLs in the address bar
// that Single Page Applications (SPAs) modify via History API without triggering full network requests.

let trackingParams = new Set();
let isGloballyDisabled = false;
let isAllowedOnDomain = false;
let isInitialized = false;

const KNOWN_ALLOWLIST = ["youtube.com", "youtu.be", "www.youtube.com", "m.youtube.com"];

// 1. Initialize
async function init() {
  const currentDomain = window.location.hostname;

  if (KNOWN_ALLOWLIST.some(d => currentDomain.includes(d))) {
    isAllowedOnDomain = true;
    isInitialized = true;
    return;
  }

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
    console.debug("URLSweep: Could not fetch initial state.");
  }
  isInitialized = true;
}

// 2. The Cleaning Logic
function cleanCurrentUrl() {
  if (!isInitialized || isGloballyDisabled || isAllowedOnDomain || trackingParams.size === 0)
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
    let hashParamsToDelete = [];
    if (url.hash && url.hash.includes("=")) {
      // The hash string includes the '#' e.g. '#_rdc=1&_rdr'
      const hashContent = url.hash.substring(1);

      const hashParams = new URLSearchParams(hashContent);

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
      const cleanUrl = url.toString();
      const cleanUrlEscaped = cleanUrl.replace(/[&"<>']/g, (c) => {
        const escapeMap = { '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;', "'": '&#39;' };
        return escapeMap[c] || c;
      });
      try {
        const script = document.createElement("script");
        script.textContent = `window.history.replaceState(null, "", "${cleanUrlEscaped}");`;
        (document.head || document.documentElement).appendChild(script);
        script.remove();
      } catch (e) {
        window.history.replaceState(null, "", cleanUrl);
      }

      const totalRemoved = paramsToDelete.length + hashParamsToDelete.length;
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
  if (!isInitialized) return;
  if (window.location.href !== lastCheckedUrl) {
    lastCheckedUrl = window.location.href;
    cleanCurrentUrl();
  }
}, 500); // Check every 500ms for URL changes

// Also attempt to use the newer Navigation API where supported
if (window.navigation) {
  window.navigation.addEventListener("navigate", (event) => {
    if (!isInitialized) return;
    // If the framework is currently transitioning to a new route, wait for it
    // so we don't abort their fetch/routing pipeline with our replaceState.
    if (window.navigation.transition) {
      window.navigation.transition.finished
        .then(() => setTimeout(cleanCurrentUrl, 100))
        .catch(() => setTimeout(cleanCurrentUrl, 100));
    } else {
      setTimeout(cleanCurrentUrl, 100);
    }
  });
}

// And keep the fallback popstate
window.addEventListener("popstate", () => {
  if (!isInitialized) return;
  setTimeout(cleanCurrentUrl, 50);
});

// 4. Listen for live settings changes from Popup/Options
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === "local") {
    if (changes.isGloballyDisabled) {
      isGloballyDisabled = changes.isGloballyDisabled.newValue;
    }
    if (changes.allowlist) {
      const currentDomain = window.location.hostname;
      isAllowedOnDomain = (changes.allowlist.newValue || []).includes(
        currentDomain,
      ) || KNOWN_ALLOWLIST.some(d => currentDomain.includes(d));
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
