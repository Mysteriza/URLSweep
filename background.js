// background.js
// Service worker for URLSweep extension - handles DNR rules, stats, and upstream synchronization

// ============================================================
// Constants
// ============================================================

const CLEARURLS_DATA_URL = "https://rules2.clearurls.xyz/data.minify.json";

// DNR rule ID ranges
const BASE_TRACKER_RULE_ID_START = 1;
const ALLOWLIST_RULE_ID_START = 10000;
const CHUNK_SIZE = 100;

// Timing constants
const FETCH_INTERVAL_MS = 604800000; // 7 days in milliseconds
const REFRESH_ALARM_PERIOD_MINUTES = 1440; // 24 hours
const STATS_FLUSH_INTERVAL_MS = 30000; // 30 seconds
const STATS_RETENTION_DAYS = 30;
const FETCH_TIMEOUT_MS = 15000; // 15 second timeout for upstream fetch
const MAX_FETCH_RETRIES = 3;

// DNR priorities
const DNR_PRIORITY_TRACKER = 10;
const DNR_PRIORITY_ALLOWLIST = 100;

// Auth-critical parameters that must never be removed by DNR
// Only parameters that are genuinely part of OAuth/login flows.
// Referral/tracking parameters MUST remain strippable.
const AUTH_SAFE_PARAMS = new Set([
  "code",           // OAuth 2.0 authorization code
  "callback",       // OAuth callback URL
  "session_id",     // Session identifier
  "rtoken",         // Refresh token
  "email_token",    // Email verification token
]);

// Domains excluded from DNR URL stripping (prevents breaking functionality)
const EXCLUDED_DNR_DOMAINS = [
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "gaming.youtube.com",
  "kids.youtube.com",
  "studio.youtube.com",
  "youtu.be",
  "docs.google.com",
  "drive.google.com",
  "calendar.google.com",
  "mail.google.com",
  "accounts.google.com",
];

// ============================================================
// Module-level State
// ============================================================

/** @type {Promise<void>} */
let updateRulesPromise = Promise.resolve();

/** @type {Object<string, number>} */
let statsBuffer = {};

/** @type {number} */
let statsBufferTotal = 0;

/** @type {number} */
let statsBufferInspected = 0;

/** @type {number} */
let lastStatsFlush = 0;

/** @type {string[]|null} */
let cachedTrackerList = null;

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a hostname matches a domain pattern using suffix matching.
 * @param {string} hostname - The full hostname (e.g., "www.example.com")
 * @param {string} pattern - The domain pattern (e.g., "example.com")
 * @returns {boolean}
 */
function isDomainMatch(hostname, pattern) {
  if (!hostname || !pattern) return false;
  return hostname === pattern || hostname.endsWith("." + pattern);
}

/**
 * Merge tracker arrays with deduplication.
 * @param {string[]} upstream
 * @param {string[]} custom
 * @returns {string[]}
 */
function mergeTrackers(upstream, custom) {
  return [...new Set([...(upstream || []), ...(custom || [])])];
}

/**
 * Get cached tracker list or rebuild it.
 * @returns {Promise<string[]>}
 */
async function getCachedTrackers() {
  if (cachedTrackerList === null) {
    const data = await chrome.storage.local.get([
      "upstreamParams",
      "customTrackers",
    ]);
    cachedTrackerList = mergeTrackers(data.upstreamParams, data.customTrackers);
  }
  return cachedTrackerList;
}

/**
 * Invalidate the cached tracker list.
 */
function invalidateTrackerCache() {
  cachedTrackerList = null;
}

// ============================================================
// Upstream Rule Fetching
// ============================================================

/**
 * Fetch and extract the latest tracking parameters from ClearURLs upstream
 * with retry logic and timeout.
 */
async function fetchUpstreamRules() {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_FETCH_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(CLEARURLS_DATA_URL, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (!data || !data.providers) {
        throw new Error("Invalid upstream data format");
      }

      const providers = data.providers;
      const exactParams = new Set();

      for (const provider of Object.values(providers)) {
        const allProviderRules = [];
        if (provider.rules) allProviderRules.push(...provider.rules);
        if (provider.referralMarketing)
          allProviderRules.push(...provider.referralMarketing);

        for (const rule of allProviderRules) {
          // Only accept pure explicit string parameters (e.g., "gclid", "fbclid")
          // Discard any rule that contains Regex structural characters
          if (
            typeof rule === "string" &&
            /^[a-zA-Z0-9_\-\.]+$/.test(rule) &&
            rule.length > 2 &&
            rule !== "amp" &&
            rule !== "html" &&
            rule !== "http"
          ) {
            exactParams.add(rule);
          }
        }
      }

      const upstreamParams = Array.from(exactParams);
      await chrome.storage.local.set({
        upstreamParams,
        lastFetchTime: Date.now(),
      });
      console.log(
        `Successfully fetched ${upstreamParams.length} parameters from ClearURLs.`,
      );
      return upstreamParams;
    } catch (error) {
      lastError = error;
      console.warn(
        `Attempt ${attempt}/${MAX_FETCH_RETRIES} failed:`,
        error.message,
      );

      if (attempt < MAX_FETCH_RETRIES) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * attempt),
        );
      }
    }
  }

  console.error("Failed to fetch ClearURLs data:", lastError);
  // Fallback to cached data
  return getCachedTrackers();
}

// ============================================================
// DNR Rule Management
// ============================================================

/**
 * Re-evaluate and apply all dynamic rules based on custom params, upstream params, and allowlist.
 */
async function _updateAllRules(forceFetch = false) {
  const data = await chrome.storage.local.get([
    "allowlist",
    "customTrackers",
    "upstreamParams",
    "lastFetchTime",
    "isGloballyDisabled",
  ]);

  let upstreamParams = data.upstreamParams || [];

  // Fetch upstream if empty, forced, or older than retention period
  const shouldFetch =
    forceFetch ||
    upstreamParams.length === 0 ||
    Date.now() - (data.lastFetchTime || 0) > FETCH_INTERVAL_MS;

  if (shouldFetch) {
    upstreamParams = await fetchUpstreamRules();
  }

  const customTrackers = data.customTrackers || [];
  const allowlist = data.allowlist || [];
  const isGloballyDisabled = data.isGloballyDisabled || false;

  // Combine custom trackers with upstream, ensuring uniqueness
  const allTrackers = mergeTrackers(upstreamParams, customTrackers);

  // Filter out auth-critical parameters that would break logins
  const safeTrackers = allTrackers.filter((p) => !AUTH_SAFE_PARAMS.has(p));

  // Update cache
  cachedTrackerList = safeTrackers;

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);

  let addRules = [];
  let currentId = BASE_TRACKER_RULE_ID_START;

  // If globally disabled, skip creating tracker removal rules
  if (!isGloballyDisabled && safeTrackers.length > 0) {
    // Generate Tracker Removal Rules
    // Split into chunks due to DNR API limit of `removeParams` per rule
    for (let i = 0; i < safeTrackers.length; i += CHUNK_SIZE) {
      const chunk = safeTrackers.slice(i, i + CHUNK_SIZE);
      addRules.push({
        id: currentId++,
        priority: DNR_PRIORITY_TRACKER,
        action: {
          type: "redirect",
          redirect: {
            transform: { queryTransform: { removeParams: chunk } },
          },
        },
        condition: {
          resourceTypes: ["main_frame", "sub_frame"],
          excludedRequestDomains: EXCLUDED_DNR_DOMAINS,
        },
      });
    }
  }

  // Generate Allowlist Exclusion Rules (higher priority to override block rules)
  allowlist.forEach((domain, index) => {
    addRules.push({
      id: ALLOWLIST_RULE_ID_START + index,
      priority: DNR_PRIORITY_ALLOWLIST,
      action: { type: "allowAllRequests" },
      condition: {
        requestDomains: [domain],
        resourceTypes: ["main_frame", "sub_frame"],
      },
    });
  });

  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds,
      addRules,
    });
    console.log(
      `Rules synchronized: ${addRules.length} rules total, covering ${safeTrackers.length} parameters (filtered ${allTrackers.length - safeTrackers.length} auth-safe) and ${allowlist.length} allowed domains.`,
    );
  } catch (error) {
    console.error("Failed to update DNR rules:", error);
    if (chrome.runtime.lastError) {
      console.error("DNR API error:", chrome.runtime.lastError.message);
    }
  }
}

/**
 * Thread-safe wrapper for updateAllRules to prevent concurrent executions.
 * @param {boolean} forceFetch
 */
function updateAllRules(forceFetch = false) {
  updateRulesPromise = updateRulesPromise
    .then(() => _updateAllRules(forceFetch))
    .catch((error) => {
      console.error("Error in updateAllRules queue:", error);
    });
  return updateRulesPromise;
}

// ============================================================
// Statistics Engine with Buffered Writes
// ============================================================

/**
 * Flush buffered stats to storage with retention policy.
 */
async function flushStats() {
  if (
    statsBufferTotal === 0 &&
    statsBufferInspected === 0 &&
    Object.keys(statsBuffer).length === 0
  ) {
    return;
  }

  try {
    const data = await chrome.storage.local.get("stats");
    const stats = data.stats || {};

    // Init Global counters
    if (!stats.total) stats.total = 0;
    if (!stats.inspected) stats.inspected = 0;

    // Apply buffered totals
    stats.total += statsBufferTotal;
    stats.inspected += statsBufferInspected;

    // Merge per-domain stats
    const dateStr = new Date().toLocaleDateString("en-CA");
    if (!stats[dateStr]) stats[dateStr] = { total: 0, inspected: 0 };

    // Apply buffered per-domain stats (count = blocked count per domain)
    for (const [domain, count] of Object.entries(statsBuffer)) {
      if (domain === "total" || domain === "inspected") continue;

      if (!stats[dateStr][domain]) stats[dateStr][domain] = 0;
      stats[dateStr][domain] += count;
    }

    // Retention policy: prune entries older than retention period
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - STATS_RETENTION_DAYS);
    const cutoffStr = cutoffDate.toLocaleDateString("en-CA");

    for (const key of Object.keys(stats)) {
      if (key !== "total" && key !== "inspected" && key < cutoffStr) {
        delete stats[key];
      }
    }

    await chrome.storage.local.set({ stats });

    // Clear buffer
    statsBuffer = {};
    statsBufferTotal = 0;
    statsBufferInspected = 0;
    lastStatsFlush = Date.now();
  } catch (error) {
    console.error("Failed to flush stats:", error);
  }
}

/**
 * Buffer stats updates instead of writing to storage immediately.
 * @param {string} domain
 * @param {number} blockedCount
 * @param {number} inspectedCount
 */
function recordStats(domain, blockedCount = 0, inspectedCount = 0) {
  if (!domain && inspectedCount === 0) return;

  statsBufferTotal += blockedCount;
  statsBufferInspected += inspectedCount;

  if (domain && blockedCount > 0) {
    statsBuffer[domain] = (statsBuffer[domain] || 0) + blockedCount;
  }

  // Debounced flush to storage
  const now = Date.now();
  if (now - lastStatsFlush > STATS_FLUSH_INTERVAL_MS) {
    flushStats();
  }
}

// ============================================================
// Event Listeners
// ============================================================

// Extension install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    await chrome.storage.local.remove(["upstreamParams", "lastFetchTime"]);
    const stored = await chrome.storage.local.get("stats");
    if (stored.stats) {
      await chrome.storage.local.set({ stats: { total: 0, inspected: 0 } });
    }
  }

  const data = await chrome.storage.local.get(["allowlist", "customTrackers", "stats"]);

  const defaults = {};
  if (!data.allowlist) defaults.allowlist = [];
  if (!data.customTrackers) defaults.customTrackers = [];
  if (!data.stats) defaults.stats = { total: 0, inspected: 0 };

  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }

  chrome.alarms.clear("refreshUpstream");
  chrome.alarms.create("refreshUpstream", { periodInMinutes: REFRESH_ALARM_PERIOD_MINUTES });

  chrome.alarms.clear("flushStats");
  chrome.alarms.create("flushStats", { periodInMinutes: 5 });

  await updateAllRules(true);
});

// Extension startup
chrome.runtime.onStartup.addListener(() => {
  updateAllRules(false);
});

// Alarm handler
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshUpstream") {
    updateAllRules(true);
  } else if (alarm.name === "flushStats") {
    flushStats();
  }
});

// Storage change listener - debounced
let storageChangeTimer = null;
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace !== "local") return;

  clearTimeout(storageChangeTimer);
  storageChangeTimer = setTimeout(() => {
    if (changes.allowlist || changes.customTrackers || changes.isGloballyDisabled) {
      invalidateTrackerCache();
      updateAllRules(false);
    }
  }, 200);
});

// Listen to DNR stripped redirects for stats
// Requires "webRequest" permission in manifest and "<all_urls>" in host_permissions
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    try {
      const origUrl = new URL(details.url);
      const redirUrl = new URL(details.redirectUrl);

      if (
        origUrl.hostname === redirUrl.hostname &&
        origUrl.pathname === redirUrl.pathname
      ) {
        const origParams = Array.from(origUrl.searchParams.keys());
        const redirParams = Array.from(redirUrl.searchParams.keys());
        const removedCount = origParams.length - redirParams.length;
        if (removedCount > 0) {
          recordStats(origUrl.hostname, removedCount, 0);
        }
      }
    } catch (_e) {
      // Ignore invalid URLs
    }
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

// Message handler
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === "getState") {
    chrome.storage.local
      .get(["upstreamParams", "customTrackers", "allowlist", "isGloballyDisabled"])
      .then((data) => {
        const allTrackers = mergeTrackers(data.upstreamParams, data.customTrackers);
        const isAllowed = (data.allowlist || []).some((d) =>
          isDomainMatch(request.domain, d),
        );

        sendResponse({
          trackers: allTrackers,
          isAllowed: isAllowed,
          isGloballyDisabled: data.isGloballyDisabled || false,
        });
      })
      .catch((_error) => {
        sendResponse({
          trackers: [],
          isAllowed: false,
          isGloballyDisabled: false,
        });
      });
    return true;
  }

  if (request.action === "recordStats") {
    recordStats(request.domain, request.count || 0, 0);
    return true;
  }

  return false;
});