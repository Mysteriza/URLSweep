// popup.js
// Popup UI for URLSweep extension

// ============================================================
// Safe Parameters (never strip these)
// ============================================================
const SAFE_PARAMS = Object.freeze(
  new Set([
    "code", "state", "scope", "redirect_uri", "response_type",
    "client_id", "client_secret", "grant_type", "access_token",
    "token_type", "refresh_token", "expires_in", "id_token",
    "session", "token", "auth", "callback", "return_to",
    "next", "continue", "destination",
    "goto", "username", "password", "twoFA", "mfa", "verify",
    "reset_token", "resetToken", "verification_code",
  ])
);

// ============================================================
// Utilities
// ============================================================

function isSafeParam(param) {
  return SAFE_PARAMS.has(param.toLowerCase());
}

function isDomainMatch(hostname, pattern) {
  if (!hostname || !pattern) return false;
  return hostname === pattern || hostname.endsWith("." + pattern);
}

function checkDomainAllowed(domain, allowlist) {
  if (!allowlist || allowlist.length === 0) return false;
  return allowlist.some((d) => isDomainMatch(domain, d));
}

function purifyUrl(urlString, trackers) {
  if (!urlString || !trackers?.size) return null;

  if (!urlString.startsWith("http")) {
    urlString = "https://" + urlString;
  }

  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (
      urlString.startsWith("javascript:") ||
      urlString.startsWith("data:") ||
      urlString.startsWith("vbscript:")
    ) {
      return null;
    }

    const toDelete = [];
    url.searchParams.forEach((_v, key) => {
      if (trackers.has(key) && !isSafeParam(key)) toDelete.push(key);
    });
    toDelete.forEach((k) => url.searchParams.delete(k));
    return url.toString();
  } catch (_e) {
    return null;
  }
}

function showToast(message, type) {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = "toast toast-" + (type || "info");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    toast.className = "toast";
  }, 2500);
}

// ============================================================
// Main
// ============================================================
document.addEventListener("DOMContentLoaded", async () => {
  const btnSettings = document.getElementById("btn-settings");
  const domainNameEl = document.getElementById("domain-name");
  const statusTextEl = document.getElementById("status-text");
  const statusIcon = document.getElementById("status-icon");
  const btnToggleSite = document.getElementById("btn-toggle-site");
  const btnToggleGlobal = document.getElementById("btn-toggle-global");
  const btnPurify = document.getElementById("btn-purify");
  const purifyInput = document.getElementById("purify-input");

  const iconCheck =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  const iconCross =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>';

  btnSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Get current active tab
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_e) {
    domainNameEl.textContent = "Error";
    statusTextEl.textContent = "Failed to load";
    statusIcon.innerHTML = iconCross;
    return;
  }

  if (!tab || !tab.url || !tab.url.startsWith("http")) {
    domainNameEl.textContent = "Unsupported Page";
    statusTextEl.textContent = "URLSweep does not run here";
    statusIcon.innerHTML = iconCross;
    btnToggleSite.disabled = true;
    btnToggleGlobal.disabled = true;
    return;
  }

  const currentDomain = new URL(tab.url).hostname;
  domainNameEl.textContent = currentDomain;

  // Load state from storage
  let allowlist = [];
  let isGloballyDisabled = false;
  let stats = {};
  let allTrackers = new Set();

  try {
    const data = await chrome.storage.local.get([
      "allowlist",
      "isGloballyDisabled",
      "stats",
      "upstreamParams",
      "customTrackers",
    ]);
    allowlist = data.allowlist || [];
    isGloballyDisabled = !!data.isGloballyDisabled;
    stats = data.stats || {};

    // Populate tracker set for purifier
    (data.upstreamParams || []).forEach((x) => allTrackers.add(x));
    (data.customTrackers || []).forEach((x) => allTrackers.add(x));
  } catch (_e) {
    showToast("Failed to load settings", "error");
  }

  const isAllowed = checkDomainAllowed(currentDomain, allowlist);

  // Calculate domain stats
  let domainTotal = 0;
  try {
    for (const dk in stats) {
      if (
        dk !== "total" &&
        dk !== "inspected" &&
        stats[dk]?.[currentDomain]
      ) {
        domainTotal += stats[dk][currentDomain];
      }
    }
  } catch (_e) {
    /* ignore */
  }
  document.getElementById("site-stats-counter").textContent = domainTotal;

  function renderState() {
    if (isGloballyDisabled) {
      statusIcon.className = "status-circle inactive";
      statusIcon.innerHTML = iconCross;
      statusTextEl.textContent = "Extension is disabled everywhere";
      btnToggleGlobal.textContent = "Resume Extension";
      btnToggleGlobal.className = "btn btn-block btn-success";
      btnToggleSite.style.display = "none";
    } else if (isAllowed) {
      statusIcon.className = "status-circle inactive";
      statusIcon.innerHTML = iconCross;
      statusTextEl.textContent = "Filter disabled for this site";
      btnToggleSite.textContent = "Enable for this website";
      btnToggleGlobal.textContent = "Pause Extension";
      btnToggleGlobal.className = "btn btn-block btn-primary";
      btnToggleSite.style.display = "block";
    } else {
      statusIcon.className = "status-circle active";
      statusIcon.innerHTML = iconCheck;
      statusTextEl.textContent = "Active on this site";
      btnToggleSite.textContent = "Disable for this website";
      btnToggleGlobal.textContent = "Pause Extension";
      btnToggleGlobal.className = "btn btn-block btn-primary";
      btnToggleSite.style.display = "block";
    }
  }

  renderState();

  // Enable/disable purify button based on tracker availability
  btnPurify.disabled = allTrackers.size === 0;

  // Site toggle
  btnToggleSite.addEventListener("click", async () => {
    try {
      const d = await chrome.storage.local.get("allowlist");
      let curr = d.allowlist || [];
      if (isAllowed) {
        curr = curr.filter((x) => x !== currentDomain);
      } else {
        curr.push(currentDomain);
      }
      await chrome.storage.local.set({ allowlist: curr });
      isAllowed = !isAllowed;
      renderState();
      chrome.tabs.reload(tab.id);
    } catch (_e) {
      showToast("Failed to toggle site filter", "error");
    }
  });

  // Global toggle
  btnToggleGlobal.addEventListener("click", async () => {
    try {
      isGloballyDisabled = !isGloballyDisabled;
      await chrome.storage.local.set({ isGloballyDisabled });
      renderState();
      chrome.tabs.reload(tab.id);
    } catch (_e) {
      showToast("Failed to toggle extension state", "error");
    }
  });

  // Purify handler
  btnPurify.addEventListener("click", async () => {
    const raw = purifyInput.value.trim();
    if (!raw) {
      showToast("Please enter a URL", "info");
      return;
    }

    btnPurify.disabled = true;
    btnPurify.textContent = "Processing...";

    try {
      const clean = purifyUrl(raw, allTrackers);
      if (clean === null) {
        showToast("Invalid URL format", "error");
        return;
      }

      // Sanitize for input display (prevent XSS)
      const safe = clean.replace(/[<>"']/g, (c) => {
        const map = {
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        };
        return map[c] || c;
      });
      purifyInput.value = safe;

      try {
        await navigator.clipboard.writeText(clean);
        showToast("URL purified and copied!", "success");
      } catch (_e) {
        showToast("URL purified (copy failed)", "info");
      }
    } catch (_e) {
      showToast("An error occurred", "error");
    } finally {
      btnPurify.disabled = allTrackers.size === 0;
      btnPurify.textContent = "Purify";
    }
  });
});