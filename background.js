// background.js

const CLEARURLS_DATA_URL = "https://rules2.clearurls.xyz/data.minify.json";

// Constants for rule IDs to avoid collision
const BASE_TRACKER_RULE_ID_START = 1;
const CUSTOM_TRACKER_RULE_ID = 5000;
const ALLOWLIST_RULE_ID_START = 10000;
const CHUNK_SIZE = 100; // Chrome limit is 100 query params per rule

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

    for (const [key, provider] of Object.entries(providers)) {
      const allProviderRules = [];
      if (provider.rules) allProviderRules.push(...provider.rules);
      if (provider.referralMarketing)
        allProviderRules.push(...provider.referralMarketing);

      for (const rule of allProviderRules) {
        // Many ClearURLs rules contain regex like (?:&|[/?#&])(?:tracking=)([^&]*)
        // Or simply `fbclid`. Chrome DNR `removeParams` expects an array of simple string parameters.
        // We extract any sequence of valid parameter name characters.

        // Match words that look like URL parameters (alphanumeric with underscores/dashes)
        // Some rules might be very complex, but the parameter name itself is usually a literal in the regex.
        // e.g., 'referral_code', 'utm_source', 'fbclid'
        const matches = rule.match(/[a-zA-Z0-9_\-\.]+/g);

        if (matches) {
          for (const match of matches) {
            // Filter out generic regex tokens that might get matched as words or short meaningless letters
            if (
              match.length > 2 &&
              match !== "amp" &&
              match !== "html" &&
              match !== "http"
            ) {
              exactParams.add(match);
            }
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

/**
 * Re-evaluate and apply all dynamic rules based on custom params, upstream params, and allowlist.
 */
async function updateAllRules(forceFetch = false) {
  const data = await chrome.storage.local.get([
    "allowlist",
    "customTrackers",
    "upstreamParams",
    "lastFetchTime",
  ]);

  let upstreamParams = data.upstreamParams || [];

  // Fetch upstream if empty, forced, or older than 7 days (604800000 ms)
  const shouldFetch =
    forceFetch ||
    upstreamParams.length === 0 ||
    Date.now() - (data.lastFetchTime || 0) > 604800000;

  if (shouldFetch) {
    upstreamParams = await fetchUpstreamRules();
  }

  const customTrackers = data.customTrackers || [];
  const allowlist = data.allowlist || [];

  // Combine custom trackers with upstream, ensuring uniqueness
  const allTrackers = [...new Set([...upstreamParams, ...customTrackers])];

  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existingRules.map((rule) => rule.id);

  let addRules = [];
  let currentId = BASE_TRACKER_RULE_ID_START;

  // 1. Generate Tracker Removal Rules (Priority 10)
  // Split into chunks due to DNR API limit of `removeParams` per rule
  for (let i = 0; i < allTrackers.length; i += CHUNK_SIZE) {
    const chunk = allTrackers.slice(i, i + CHUNK_SIZE);
    addRules.push({
      id: currentId++,
      priority: 10,
      action: {
        type: "redirect",
        redirect: {
          transform: { queryTransform: { removeParams: chunk } },
        },
      },
      condition: {
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "xmlhttprequest",
          "ping",
          "script",
          "image",
          "stylesheet",
          "font",
          "object",
          "websocket",
          "other",
        ],
      },
    });
  }

  // 2. Generate Allowlist Exclusion Rules (Priority 100)
  allowlist.forEach((domain, index) => {
    addRules.push({
      id: ALLOWLIST_RULE_ID_START + index,
      priority: 100, // Higher priority to override block rules
      action: { type: "allowAllRequests" },
      condition: {
        requestDomains: [domain],
        resourceTypes: [
          "main_frame",
          "sub_frame",
          "xmlhttprequest",
          "ping",
          "script",
          "image",
          "stylesheet",
          "font",
          "object",
          "websocket",
          "other",
        ],
      },
    });
  });

  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds,
    addRules,
  });

  console.log(
    `Rules synchronized: ${addRules.length} rules total, covering ${allTrackers.length} parameters and ${allowlist.length} allowed domains.`,
  );
}

// Ensure settings and stats exist on Install/Start
chrome.runtime.onInstalled.addListener(async () => {
  const data = await chrome.storage.local.get([
    "allowlist",
    "customTrackers",
    "stats",
  ]);
  if (!data.allowlist) await chrome.storage.local.set({ allowlist: [] });
  if (!data.customTrackers)
    await chrome.storage.local.set({ customTrackers: [] });
  if (!data.stats) await chrome.storage.local.set({ stats: {} });

  // Create alarm to refresh upstream lists daily
  chrome.alarms.create("refreshUpstream", { periodInMinutes: 1440 }); // 24 hours

  await updateAllRules(true);
});

chrome.runtime.onStartup.addListener(() => {
  updateAllRules(false);
});

// Periodic fetching
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "refreshUpstream") {
    updateAllRules(true);
  }
});

// Listen for Option/Popup UI changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (
    namespace === "local" &&
    (changes.allowlist || changes.customTrackers || changes.isGloballyDisabled)
  ) {
    updateAllRules(false);
  }
});

// --- Statistics Engine ---

/**
 * Log stripped parameters to storage grouped by date and domain.
 * Format: { "YYYY-MM-DD": { "example.com": 5, "total": 12 }, "total": 200 }
 */
async function recordStats(domain, blockedCount = 0, inspectedCount = 0) {
  if (!domain && inspectedCount === 0) return;

  // Use local timezone date string
  const dateStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD format

  const data = await chrome.storage.local.get("stats");
  const stats = data.stats || {};

  // Init Global
  if (!stats.total) stats.total = 0;
  if (!stats.inspected) stats.inspected = 0;

  stats.total += blockedCount;
  stats.inspected += inspectedCount;

  // Init Date
  if (!stats[dateStr]) stats[dateStr] = { total: 0, inspected: 0 };
  stats[dateStr].total += blockedCount;
  stats[dateStr].inspected += inspectedCount;

  if (domain && blockedCount > 0) {
    // Init Domain for Date
    if (!stats[dateStr][domain]) stats[dateStr][domain] = 0;
    stats[dateStr][domain] += blockedCount;
  }

  await chrome.storage.local.set({ stats });
}

// 0. Track total inspected requests without blocking them
chrome.webRequest.onBeforeRequest.addListener(
  () => {
    // We increment 'inspected' globally for any request made
    recordStats(null, 0, 1);
  },
  { urls: ["<all_urls>"] },
);

// 1. Listen to declarativeNetRequest stripped redirects
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    // We only care if the extension caused the redirect (DNR action)
    // Unfortunately Chrome doesn't explicitly flag DNR redirects in webRequest,
    // but we can infer it if the redirectUrl is simply the stripped version of the original url.
    try {
      const origUrl = new URL(details.url);
      const redirUrl = new URL(details.redirectUrl);

      // If host and pathname match, it's highly likely our parameter strip
      if (
        origUrl.hostname === redirUrl.hostname &&
        origUrl.pathname === redirUrl.pathname
      ) {
        // Calculate how many parameters were removed
        const origParams = Array.from(origUrl.searchParams.keys());
        const redirParams = Array.from(redirUrl.searchParams.keys());

        const removedCount = origParams.length - redirParams.length;
        if (removedCount > 0) {
          recordStats(origUrl.hostname, removedCount, 0);
        }
      }
    } catch (e) {
      // Ignore
    }
  },
  { urls: ["<all_urls>"] },
);

// 2. Serve state and handle explicit stats from content scripts
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
        const allTrackers = [
          ...new Set([
            ...(data.upstreamParams || []),
            ...(data.customTrackers || []),
          ]),
        ];
        const isAllowed = (data.allowlist || []).includes(request.domain);

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
    return true;
  }
});
