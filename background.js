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

// DNR priorities
const DNR_PRIORITY_TRACKER = 10;
const DNR_PRIORITY_ALLOWLIST = 100;

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
 */
async function fetchUpstreamRules() {
  try {
    const response = await fetch(CLEARURLS_DATA_URL);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();

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
        if (/^[a-zA-Z0-9_\-\.]+$/.test(rule)) {
          // Additional safety check against generic structural tokens
          if (
            rule.length > 2 &&
            rule !== "amp" &&
            rule !== "html" &&
            rule !== "http"
          ) {
            exactParams.add(rule);
          }
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
    console.error("Failed to fetch ClearURLs data:", error);
    // If we fail, try to read from storage
    const { upstreamParams = [] } =
      await chrome.storage.local.get("upstreamParams");
    return upstreamParams;
  }
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

  // Update cache
  cachedTrackerList = allTrackers;

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);

  let addRules = [];
  let currentId = BASE_TRACKER_RULE_ID_START;

  // If globally disabled, skip creating tracker removal rules
  if (!isGloballyDisabled) {
    // Generate Tracker Removal Rules
    // Split into chunks due to DNR API limit of `removeParams` per rule
    for (let i = 0; i < allTrackers.length; i += CHUNK_SIZE) {
      const chunk = allTrackers.slice(i, i + CHUNK_SIZE);
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
      `Rules synchronized: ${addRules.length} rules total, covering ${allTrackers.length} parameters and ${allowlist.length} allowed domains.`,
    );
  } catch (error) {
    console.error("Failed to update DNR rules:", error);
    // Optionally notify user if rules update fails
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
    return; // Nothing to flush
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

    // Apply buffered per-domain stats
    for (const [domain, count] of Object.entries(statsBuffer)) {
      if (domain === "total" || domain === "inspected") continue;

      stats[dateStr].total += count;
      stats[dateStr].inspected += count;

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

    console.debug("Stats flushed to storage.");
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

  // Accumulate in memory
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

// Flush stats when service worker is about to be suspended
chrome.alarms.create("flushStats", { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flushStats") {
    flushStats();
  }
});

// ============================================================
// Event Listeners
// ============================================================

// Extension install/update
chrome.runtime.onInstalled.addListener(async (details) => {
  // Force clear the tracking dictionary on install/update to ensure fresh data
  if (details.reason === "install" || details.reason === "update") {
    await chrome.storage.local.remove(["upstreamParams", "lastFetchTime"]);
  }

  const data = await chrome.storage.local.get([
    "allowlist",
    "customTrackers",
    "stats",
  ]);

  // Initialize storage with defaults in a single call
  const defaults = {};
  if (!data.allowlist) defaults.allowlist = [];
  if (!data.customTrackers) defaults.customTrackers = [];
  if (!data.stats) defaults.stats = {};

  if (Object.keys(defaults).length > 0) {
    await chrome.storage.local.set(defaults);
  }

  // Create alarm to refresh upstream lists daily
  chrome.alarms.clear("refreshUpstream"); // Prevent duplicates
  chrome.alarms.create("refreshUpstream", {
    periodInMinutes: REFRESH_ALARM_PERIOD_MINUTES,
  });

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
  }
});

// Storage change listener
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (
    namespace === "local" &&
    (changes.allowlist || changes.customTrackers || changes.isGloballyDisabled)
  ) {
    invalidateTrackerCache();
    updateAllRules(false);
  }
});

// Listen to DNR stripped redirects
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    try {
      const origUrl = new URL(details.url);
      const redirUrl = new URL(details.redirectUrl);

      // If host and pathname match, it's likely our parameter strip
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
    } catch (e) {
      // Ignore invalid URLs
    }
  },
  { urls: ["<all_urls>"] },
);

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getState") {
    chrome.storage.local
      .get([
        "upstreamParams",
        "customTrackers",
        "allowlist",
        "isGloballyDisabled",
      ])
      .then((data) => {
        const allTrackers = mergeTrackers(
          data.upstreamParams,
          data.customTrackers,
        );
        const isAllowed = (data.allowlist || []).some((d) =>
          isDomainMatch(request.domain, d),
        );

        sendResponse({
          trackers: allTrackers,
          isAllowed: isAllowed,
          isGloballyDisabled: data.isGloballyDisabled || false,
        });
      });
    return true; // Keep message channel open for async response
  }

  if (request.action === "recordStats") {
    recordStats(request.domain, request.count, 0);
    // Fire-and-forget, no return true needed
  }
});
