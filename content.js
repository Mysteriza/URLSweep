// content.js
// Content script - SPA URL cleaning with retry messaging

// ============================================================
// Constants (module-level, never change)
// ============================================================

const SAFE_PARAMS = new Set([
  "v", "t", "list", "index", "pp", "s",
  "q", "search", "page", "sort", "filter",
  "lang", "hl", "gl",
  // Auth/OAuth parameters that must never be stripped
  "code", "state", "scope", "redirect_uri", "response_type",
  "client_id", "client_secret", "grant_type", "access_token",
  "token_type", "refresh_token", "expires_in", "id_token",
  "session", "session_id", "token", "rtoken",
  "auth", "callback", "return_to",
  "next", "continue", "destination", "goto",
  "username", "password", "twoFA", "mfa", "verify",
  "reset_token", "resetToken", "verification_code",
  "email_token",
]);

const AUTH_PATH_PATTERNS = new Set([
  "/login", "/signin", "/signup", "/register", "/auth",
  "/oauth", "/authorize", "/callback", "/verify", "/verify-email",
  "/forgot-password", "/reset-password", "/two-factor", "/2fa",
  "/mfa", "/session", "/sso",
]);

// ============================================================
// State
// ============================================================

/** @type {Set<string>} */
let trackingParams = new Set();
let isGloballyDisabled = false;
let isAllowedOnDomain = false;
let isInitialized = false;

/** @type {number|null} */
let urlCheckIntervalId = null;
let initGeneration = 0;

/** @type {string} */
let lastCheckedUrl = "";

/** @type {number|null} */
let navigationTimeout = null;
/** @type {number|null} */
let storageChangeTimeout = null;

// ============================================================
// Utilities
// ============================================================

function isDomainMatch(hostname, pattern) {
  return hostname === pattern || hostname.endsWith("." + pattern);
}

function checkDomainAllowed(domain, allowlist) {
  if (!allowlist || allowlist.length === 0) return false;
  return allowlist.some((d) => isDomainMatch(domain, d));
}

function isSafeParam(key) {
  return SAFE_PARAMS.has(key.toLowerCase());
}

function isAuthPage() {
  const pathname = window.location.pathname.toLowerCase();
  for (const pattern of AUTH_PATH_PATTERNS) {
    if (pathname.includes(pattern)) return true;
  }
  return false;
}

/**
 * Send message with retry. Returns null on failure.
 */
function postMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(response);
      }
    });
  });
}

// ============================================================
// Interval / Lifecycle
// ============================================================

function startUrlCheck() {
  stopUrlCheck();
  urlCheckIntervalId = setInterval(() => {
    if (!isInitialized || isGloballyDisabled || isAllowedOnDomain) return;
    if (window.location.href !== lastCheckedUrl) {
      lastCheckedUrl = window.location.href;
      cleanCurrentUrl();
    }
  }, 1000);
}

function stopUrlCheck() {
  if (urlCheckIntervalId !== null) {
    clearInterval(urlCheckIntervalId);
    urlCheckIntervalId = null;
  }
}

// ============================================================
// Core
// ============================================================

async function init() {
  const gen = ++initGeneration;
  const host = window.location.hostname;

  if (!host) {
    isAllowedOnDomain = true;
    isInitialized = true;
    stopUrlCheck();
    return;
  }

  lastCheckedUrl = window.location.href;

  try {
    const resp = await postMessage({ action: "getState", domain: host });
    if (gen !== initGeneration) return;

    if (resp) {
      isGloballyDisabled = !!resp.isGloballyDisabled;
      isAllowedOnDomain = !!resp.isAllowed;
      trackingParams = new Set(resp.trackers || []);
    }
  } catch (_e) {
    // Will retry on navigation
  }

  isInitialized = true;

  if (!isGloballyDisabled && !isAllowedOnDomain && trackingParams.size > 0) {
    cleanCurrentUrl();
    startUrlCheck();
  } else {
    stopUrlCheck();
  }
}

function cleanCurrentUrl() {
  if (
    !isInitialized ||
    isGloballyDisabled ||
    isAllowedOnDomain ||
    trackingParams.size === 0
  ) {
    return;
  }

  if (isAuthPage()) return;

  try {
    const url = new URL(window.location.href);
    let changed = false;

    // Query params
    const toDelete = [];
    url.searchParams.forEach((_v, key) => {
      if (trackingParams.has(key) && !isSafeParam(key)) {
        toDelete.push(key);
      }
    });
    if (toDelete.length > 0) {
      toDelete.forEach((k) => url.searchParams.delete(k));
      changed = true;
    }

    // Hash params
    const hashDel = [];
    if (url.hash.includes("=")) {
      const hp = new URLSearchParams(url.hash.substring(1));
      hp.forEach((_v, key) => {
        if (trackingParams.has(key) && !isSafeParam(key)) {
          hashDel.push(key);
        }
      });
      if (hashDel.length > 0) {
        hashDel.forEach((k) => hp.delete(k));
        url.hash = hp.toString() ? "#" + hp.toString() : "";
        changed = true;
      }
    }

    if (changed) {
      try {
        window.history.replaceState(null, "", url.toString());
      } catch (_e) {
        return;
      }

      const total = toDelete.length + hashDel.length;
      if (total > 0) {
        postMessage({
          action: "recordStats",
          domain: window.location.hostname,
          count: total,
        }).catch(() => {});
      }
    }
  } catch (_e) {
    // Ignore
  }
}

// ============================================================
// Event Listeners
// ============================================================

// Navigation API
if (window.navigation) {
  window.navigation.addEventListener("navigate", () => {
    if (!isInitialized || isGloballyDisabled || isAllowedOnDomain) return;
    clearTimeout(navigationTimeout);
    navigationTimeout = setTimeout(cleanCurrentUrl, 200);
  });
}

// Popstate
window.addEventListener("popstate", () => {
  if (!isInitialized || isGloballyDisabled || isAllowedOnDomain) return;
  setTimeout(cleanCurrentUrl, 50);
});

// Hash change
window.addEventListener("hashchange", () => {
  if (!isInitialized || isGloballyDisabled || isAllowedOnDomain) return;
  setTimeout(cleanCurrentUrl, 50);
});

// Page visibility
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopUrlCheck();
  } else if (isInitialized && !isGloballyDisabled && !isAllowedOnDomain) {
    startUrlCheck();
  }
});

// Unload cleanup
window.addEventListener("pagehide", stopUrlCheck);

// Storage listener (debounced)
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  clearTimeout(storageChangeTimeout);
  storageChangeTimeout = setTimeout(() => {
    if (changes.isGloballyDisabled) {
      isGloballyDisabled = changes.isGloballyDisabled.newValue;
      if (isGloballyDisabled) stopUrlCheck();
      else if (isInitialized && !isAllowedOnDomain) startUrlCheck();
    }

    if (changes.allowlist) {
      const host = window.location.hostname;
      isAllowedOnDomain = checkDomainAllowed(host, changes.allowlist.newValue);
      if (isAllowedOnDomain) stopUrlCheck();
      else if (isInitialized && !isGloballyDisabled) startUrlCheck();
    }

    if (changes.upstreamParams || changes.customTrackers) {
      const up = changes.upstreamParams?.newValue || [];
      const cu = changes.customTrackers?.newValue || [];
      trackingParams = new Set([...up, ...cu]);
    }

    cleanCurrentUrl();
  }, 100);
});

// Start
init();