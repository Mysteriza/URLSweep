// content.js
// This script runs in every webpage to catch and clean URLs in the address bar
// that Single Page Applications (SPAs) modify via History API without triggering full network requests.

// ============================================================
// Module-level State
// ============================================================

/** @type {Set<string>} */
let trackingParams = new Set();
let isGloballyDisabled = false;
let isAllowedOnDomain = false;
let isInitialized = false;

/** @type {number|null} */
let urlCheckIntervalId = null;

/** @type {string} */
let lastCheckedUrl = window.location.href;

/** @type {number} */
let initGeneration = 0;

// ============================================================
// Constants
// ============================================================

/**
 * Parameters that should NEVER be removed as they are critical for
 * authentication, OAuth, session management, and core functionality.
 * @type {ReadonlySet<string>}
 */
const SAFE_PARAMS = Object.freeze(
  new Set([
    // OAuth/OpenID Connect
    "code",
    "state",
    "scope",
    "redirect_uri",
    "response_type",
    "client_id",
    "client_secret",
    "grant_type",
    "access_token",
    "token_type",
    "refresh_token",
    "expires_in",
    "id_token",
    // Session/Auth
    "session",
    "token",
    "auth",
    "callback",
    "return_to",
    "next",
    "continue",
    "returnUrl",
    "destination",
    // Proton-specific
    "goto",
    "username",
    "password",
    "twoFA",
    "mfa",
    "verify",
    // Password reset
    "reset_token",
    "resetToken",
    "verification_code",
  ]),
);

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a parameter is safe and should never be removed.
 * @param {string} param
 * @returns {boolean}
 */
function isSafeParam(param) {
  return SAFE_PARAMS.has(param.toLowerCase());
}

/**
 * Check if a hostname matches a domain pattern using suffix matching.
 * @param {string} hostname - The full hostname (e.g., "www.example.com")
 * @param {string} pattern - The domain pattern (e.g., "example.com")
 * @returns {boolean}
 */
function isDomainMatch(hostname, pattern) {
  return hostname === pattern || hostname.endsWith("." + pattern);
}

/**
 * Check if the current domain is in the allowlist.
 * @param {string} domain
 * @param {string[]} allowlist
 * @returns {boolean}
 */
function checkDomainAllowed(domain, allowlist) {
  return (allowlist || []).some((d) => isDomainMatch(domain, d));
}

// ============================================================
// Interval Management
// ============================================================

/**
 * Start the URL checking interval.
 */
function startUrlChecking() {
  // Clear any existing interval first
  stopUrlChecking();

  urlCheckIntervalId = setInterval(() => {
    if (!isInitialized || isGloballyDisabled || isAllowedOnDomain) return;
    if (window.location.href !== lastCheckedUrl) {
      lastCheckedUrl = window.location.href;
      cleanCurrentUrl();
    }
  }, 1000); // Check every 1000ms (reduced from 500ms for better performance)
}

/**
 * Stop the URL checking interval.
 */
function stopUrlChecking() {
  if (urlCheckIntervalId !== null) {
    clearInterval(urlCheckIntervalId);
    urlCheckIntervalId = null;
  }
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Initialize the content script by fetching state from background.
 */
async function init() {
  const currentGeneration = ++initGeneration;
  const currentDomain = window.location.hostname;

  // Handle special pages where hostname is empty
  if (!currentDomain) {
    isAllowedOnDomain = true;
    isInitialized = true;
    stopUrlChecking();
    return;
  }

  // Ask background script for current rules and state
  try {
    const response = await chrome.runtime.sendMessage({
      action: "getState",
      domain: currentDomain,
    });

    // Check if this init call is still the latest (prevent race conditions)
    if (currentGeneration !== initGeneration) {
      console.debug("URLSweep: Stale init response discarded.");
      return;
    }

    if (response) {
      isGloballyDisabled = response.isGloballyDisabled;
      isAllowedOnDomain = response.isAllowed;
      trackingParams = new Set(response.trackers || []);
    }
  } catch (e) {
    // Background script might not be ready (e.g., fresh install, service worker asleep)
    console.debug(
      "URLSweep: Could not fetch initial state, will retry on navigation.",
    );
  }

  isInitialized = true;

  // Always attempt to clean, even if init failed (use existing tracker set)
  cleanCurrentUrl();

  // Start or stop interval based on state
  if (!isGloballyDisabled && !isAllowedOnDomain) {
    startUrlChecking();
  } else {
    stopUrlChecking();
  }
}

/**
 * Check if the current URL is on an authentication/login page where
 * parameter stripping could break the flow.
 * @returns {boolean}
 */
function isAuthPage() {
  const pathname = window.location.pathname.toLowerCase();
  const authPatterns = [
    "/login",
    "/signin",
    "/signup",
    "/register",
    "/auth",
    "/oauth",
    "/authorize",
    "/callback",
    "/verify",
    "/verify-email",
    "/forgot-password",
    "/reset-password",
    "/two-factor",
    "/2fa",
    "/mfa",
    "/session",
    "/sso",
  ];

  return authPatterns.some((pattern) => pathname.includes(pattern));
}

/**
 * Clean tracking parameters from the current URL.
 */
function cleanCurrentUrl() {
  if (
    !isInitialized ||
    isGloballyDisabled ||
    isAllowedOnDomain ||
    trackingParams.size === 0
  ) {
    return;
  }

  // Skip cleaning on auth pages to prevent breaking login flows
  if (isAuthPage()) {
    console.debug("URLSweep: Skipping cleaning on auth page.");
    return;
  }

  try {
    const url = new URL(window.location.href);
    let changed = false;

    // 1. Clean Query Parameters (?)
    const paramsToDelete = [];
    url.searchParams.forEach((value, key) => {
      // Skip if it's a tracking param but ALSO a safe param
      if (trackingParams.has(key) && !isSafeParam(key)) {
        paramsToDelete.push(key);
      }
    });

    if (paramsToDelete.length > 0) {
      paramsToDelete.forEach((key) => url.searchParams.delete(key));
      changed = true;
    }

    // 2. Clean Hash Parameters (#)
    // Some SPAs like Facebook put parameters like _rdc after the hash
    let hashParamsToDelete = [];
    if (url.hash && url.hash.includes("=")) {
      const hashContent = url.hash.substring(1);
      const hashParams = new URLSearchParams(hashContent);

      hashParams.forEach((value, key) => {
        // Skip if it's a tracking param but ALSO a safe param
        if (trackingParams.has(key) && !isSafeParam(key)) {
          hashParamsToDelete.push(key);
        }
      });

      if (hashParamsToDelete.length > 0) {
        hashParamsToDelete.forEach((key) => hashParams.delete(key));
        url.hash = hashParams.toString() ? "#" + hashParams.toString() : "";
        changed = true;
      }
    }

    if (changed) {
      const cleanUrl = url.toString();
      try {
        window.history.replaceState(null, "", cleanUrl);
      } catch (e) {
        // Ignore replaceState failures (e.g., cross-origin restrictions)
        console.debug("URLSweep: replaceState failed:", e.message);
      }

      const totalRemoved = paramsToDelete.length + hashParamsToDelete.length;
      if (totalRemoved > 0) {
        chrome.runtime
          .sendMessage({
            action: "recordStats",
            domain: window.location.hostname,
            count: totalRemoved,
          })
          .catch(() => {
            // Ignore message passing failures (background may be unavailable)
          });
      }
    }
  } catch (e) {
    // Ignore invalid URLs
  }
}

// ============================================================
// Event Listeners
// ============================================================

// Navigation API - modern SPA routing
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

// Popstate event - traditional history API navigation
window.addEventListener("popstate", () => {
  if (!isInitialized) return;
  setTimeout(cleanCurrentUrl, 50);
});

// Hashchange event - catch hash-only navigations
window.addEventListener("hashchange", () => {
  if (!isInitialized || isGloballyDisabled || isAllowedOnDomain) return;
  setTimeout(cleanCurrentUrl, 50);
});

// Page visibility - clean up interval when page is hidden
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    stopUrlChecking();
  } else if (!isGloballyDisabled && !isAllowedOnDomain && isInitialized) {
    // Restart interval when page becomes visible again
    startUrlChecking();
  }
});

// Page unload - clean up interval
window.addEventListener("pagehide", () => {
  stopUrlChecking();
});

// Storage change listener for live settings updates
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  let needsReinit = false;

  if (changes.isGloballyDisabled) {
    isGloballyDisabled = changes.isGloballyDisabled.newValue;
    if (isGloballyDisabled) {
      stopUrlChecking();
    } else if (isInitialized && !isAllowedOnDomain) {
      startUrlChecking();
    }
  }

  if (changes.allowlist) {
    const currentDomain = window.location.hostname;
    const newAllowlist = changes.allowlist.newValue || [];
    isAllowedOnDomain = checkDomainAllowed(currentDomain, newAllowlist);

    if (isAllowedOnDomain) {
      stopUrlChecking();
    } else if (isInitialized && !isGloballyDisabled) {
      startUrlChecking();
    }
  }

  if (changes.upstreamParams || changes.customTrackers) {
    needsReinit = true;
  }

  if (needsReinit) {
    // Use storage change values directly to avoid round-trip to background
    const newUpstream = changes.upstreamParams?.newValue || [];
    const newCustom = changes.customTrackers?.newValue || [];
    trackingParams = new Set([...newUpstream, ...newCustom]);
    cleanCurrentUrl();
  } else {
    cleanCurrentUrl();
  }
});

// ============================================================
// Initialize
// ============================================================

init();
