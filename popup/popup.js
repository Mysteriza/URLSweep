// popup.js

document.addEventListener("DOMContentLoaded", async () => {
  const btnSettings = document.getElementById("btn-settings");
  const domainNameEl = document.getElementById("domain-name");
  const statusTextEl = document.getElementById("status-text");
  const statusIcon = document.getElementById("status-icon");

  // SVG Icons
  const iconCheck = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const iconCross = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;

  btnSettings.addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
  });

  // Get current active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab || !tab.url || !tab.url.startsWith("http")) {
    domainNameEl.textContent = "Unsupported Page";
    statusTextEl.textContent = "URLSweep does not run here";
    statusIcon.className = "status-circle";
    statusIcon.innerHTML = iconCross;

    const btnToggleSite = document.getElementById("btn-toggle-site");
    const btnToggleGlobal = document.getElementById("btn-toggle-global");

    if (btnToggleSite) {
      btnToggleSite.disabled = true;
      btnToggleSite.style.opacity = "0.5";
      btnToggleSite.style.cursor = "not-allowed";
    }

    if (btnToggleGlobal) {
      btnToggleGlobal.disabled = true;
      btnToggleGlobal.style.opacity = "0.5";
      btnToggleGlobal.style.cursor = "not-allowed";
    }
    return;
  }

  const url = new URL(tab.url);
  const currentDomain = url.hostname;

  domainNameEl.textContent = currentDomain;

  const btnToggleSite = document.getElementById("btn-toggle-site");
  const btnToggleGlobal = document.getElementById("btn-toggle-global");

  // Storage states
  const {
    allowlist = [],
    isGloballyDisabled = false,
    stats = {},
  } = await chrome.storage.local.get([
    "allowlist",
    "isGloballyDisabled",
    "stats",
  ]);
  let isAllowed = allowlist.includes(currentDomain);
  let globalDisabled = isGloballyDisabled;

  // Calculate stats for current site
  let domainTotal = 0;
  for (const dateKey in stats) {
    if (dateKey !== "total" && stats[dateKey][currentDomain]) {
      domainTotal += stats[dateKey][currentDomain];
    }
  }
  document.getElementById("site-stats-counter").textContent = domainTotal;

  const renderState = () => {
    if (globalDisabled) {
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
  };

  renderState();

  // Site-specific toggle
  btnToggleSite.addEventListener("click", async () => {
    const data = await chrome.storage.local.get("allowlist");
    let currentAllowlist = data.allowlist || [];

    if (isAllowed) {
      currentAllowlist = currentAllowlist.filter((d) => d !== currentDomain);
    } else {
      currentAllowlist.push(currentDomain);
    }

    await chrome.storage.local.set({ allowlist: currentAllowlist });
    isAllowed = !isAllowed;
    renderState();
    chrome.tabs.reload(tab.id);
  });

  // Global toggle
  btnToggleGlobal.addEventListener("click", async () => {
    globalDisabled = !globalDisabled;
    await chrome.storage.local.set({ isGloballyDisabled: globalDisabled });

    // We update the DNR rules logic here via setting change triggers in background.js
    renderState();
    chrome.tabs.reload(tab.id);
  });

  // Purifier Logic
  const btnPurify = document.getElementById("btn-purify");
  const purifyInput = document.getElementById("purify-input");

  btnPurify.addEventListener("click", async () => {
    let urlString = purifyInput.value.trim();
    if (!urlString) return;

    // Ensure protocol
    if (!urlString.startsWith("http")) {
      urlString = "https://" + urlString;
    }

    try {
      const url = new URL(urlString);

      const data = await chrome.storage.local.get([
        "upstreamParams",
        "customTrackers",
      ]);
      const allTrackers = new Set([
        ...(data.upstreamParams || []),
        ...(data.customTrackers || []),
      ]);

      const paramsToDelete = [];
      url.searchParams.forEach((value, key) => {
        if (allTrackers.has(key)) {
          paramsToDelete.push(key);
        }
      });

      paramsToDelete.forEach((key) => url.searchParams.delete(key));

      const cleanUrl = url.toString();
      purifyInput.value = cleanUrl;

      await navigator.clipboard.writeText(cleanUrl);

      const originalText = btnPurify.textContent;
      btnPurify.textContent = "Copied!";
      btnPurify.className = "btn btn-success";

      setTimeout(() => {
        btnPurify.textContent = originalText;
        btnPurify.className = "btn btn-secondary";
      }, 2000);
    } catch (e) {
      alert("Invalid URL format");
    }
  });
});
