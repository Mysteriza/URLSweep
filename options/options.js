// options.js

document.addEventListener("DOMContentLoaded", async () => {
  // ============================================================
  // DOM Elements
  // ============================================================

  const allowlistInput = document.getElementById("allowlist-input");
  const allowlistForm = document.getElementById("allowlist-form");
  const allowlistEl = document.getElementById("allowlist");
  const allowlistEmpty = document.getElementById("allowlist-empty");

  const customParamsInput = document.getElementById("custom-params-input");
  const customParamsForm = document.getElementById("custom-params-form");
  const customParamsListEl = document.getElementById("custom-params-list");
  const customParamsEmpty = document.getElementById("custom-params-empty");

  const btnExport = document.getElementById("btn-export");
  const btnImport = document.getElementById("btn-import");

  const template = document.getElementById("list-item-template");

  // ============================================================
  // Initial Data Load
  // ============================================================

  // Dynamically set version badge
  const manifest = chrome.runtime.getManifest();
  document.getElementById("version-badge").textContent = `v${manifest.version}`;

  // Load Initial Data
  const {
    allowlist = [],
    customTrackers = [],
    stats = {},
    upstreamParams = [],
    lastFetchTime = null,
  } = await chrome.storage.local.get([
    "allowlist",
    "customTrackers",
    "stats",
    "upstreamParams",
    "lastFetchTime",
  ]);

  // Local state (mutable)
  let currentAllowlist = [...allowlist];
  let currentCustomTrackers = [...customTrackers];
  let currentStats = { ...stats };

  // ============================================================
  // Render Functions
  // ============================================================

  /**
   * Render allowlist and custom tracker lists.
   */
  const renderLists = () => {
    // Render Allowlist
    allowlistEl.innerHTML = "";
    if (currentAllowlist.length === 0) {
      allowlistEmpty.classList.remove("hidden");
    } else {
      allowlistEmpty.classList.add("hidden");
      currentAllowlist.forEach((domain) => {
        const row = template.content.cloneNode(true);
        row.querySelector(".item-text").textContent = domain;
        row
          .querySelector(".btn-delete")
          .addEventListener("click", () => removeAllowlist(domain));
        allowlistEl.appendChild(row);
      });
    }

    // Render Custom Params
    customParamsListEl.innerHTML = "";
    if (currentCustomTrackers.length === 0) {
      customParamsEmpty.classList.remove("hidden");
    } else {
      customParamsEmpty.classList.add("hidden");
      currentCustomTrackers.forEach((param) => {
        const row = template.content.cloneNode(true);
        row.querySelector(".item-text").textContent = param;
        row
          .querySelector(".btn-delete")
          .addEventListener("click", () => removeCustomParam(param));
        customParamsListEl.appendChild(row);
      });
    }
  };

  /**
   * Render statistics dashboard.
   */
  const renderStats = () => {
    const elUpdated = document.getElementById("stat-updated");
    const elElements = document.getElementById("stat-elements");
    const elBlocked = document.getElementById("stat-blocked");
    const elPct = document.getElementById("stat-pct");
    const barBlocked = document.getElementById("progress-blocked");
    const barElements = document.getElementById("progress-elements");

    // Legacy Stats Variables
    const elTotal = document.getElementById("stat-total");
    const elToday = document.getElementById("stat-today");
    const elWeek = document.getElementById("stat-week");

    // Last Updated Format (24H)
    if (lastFetchTime && elUpdated) {
      const d = new Date(lastFetchTime);
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      elUpdated.textContent = `Last updated: ${hh}:${mm}`;
    } else if (elUpdated) {
      elUpdated.textContent = `Last updated: Unknown`;
    }

    // Dynamic Stats Logic
    const tInspected = currentStats.inspected || 0;
    const tBlocked = currentStats.total || 0;

    if (elElements) elElements.textContent = tInspected.toLocaleString();
    if (elBlocked) elBlocked.textContent = tBlocked.toLocaleString();

    if (tInspected > 0) {
      const pctValue = (tBlocked / tInspected) * 100;
      if (elPct) elPct.textContent = `${pctValue.toFixed(3)}%`;

      if (barBlocked && barElements) {
        barBlocked.style.width = `${pctValue}%`;
        barElements.style.width = `${100 - pctValue}%`;
      }
    } else {
      if (elPct) elPct.textContent = "0.000%";
      if (barBlocked && barElements) {
        barBlocked.style.width = "0%";
        barElements.style.width = "100%";
      }
    }

    // --- Legacy Historic Stats ---
    if (elTotal) elTotal.textContent = tBlocked.toLocaleString();

    // Today
    const todayStr = new Date().toLocaleDateString("en-CA");
    if (elToday)
      elToday.textContent = (
        currentStats[todayStr] ? currentStats[todayStr].total : 0
      ).toLocaleString();

    // Past 7 Days
    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = d.toLocaleDateString("en-CA");
      if (currentStats[dStr]) {
        weekTotal += currentStats[dStr].total;
      }
    }
    if (elWeek) elWeek.textContent = weekTotal.toLocaleString();
  };

  /**
   * Save current state to storage.
   */
  const saveState = async () => {
    await chrome.storage.local.set({
      allowlist: currentAllowlist,
      customTrackers: currentCustomTrackers,
    });
    renderLists();
    renderStats();
  };

  // ============================================================
  // Event Handlers
  // ============================================================

  /**
   * Add domain to allowlist.
   */
  allowlistForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    let domain = allowlistInput.value.trim().toLowerCase();

    // Simple domain extraction if user pastes full URL
    try {
      if (domain.includes("http")) {
        const url = new URL(domain);
        domain = url.hostname;
      }
    } catch (e) {
      // Invalid URL, use as-is
    }

    if (domain && !currentAllowlist.includes(domain)) {
      currentAllowlist.push(domain);
      await saveState();
      allowlistInput.value = "";
    }
  });

  /**
   * Add custom tracker parameters.
   */
  customParamsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const rawVal = customParamsInput.value;
    // Split by commas or newlines, sanitize, and remove empty entries
    const params = rawVal
      .split(/[\n,]+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    let added = false;
    params.forEach((param) => {
      if (!currentCustomTrackers.includes(param)) {
        currentCustomTrackers.push(param);
        added = true;
      }
    });

    if (added) {
      await saveState();
      customParamsInput.value = "";
    }
  });

  /**
   * Remove domain from allowlist.
   */
  const removeAllowlist = async (domain) => {
    currentAllowlist = currentAllowlist.filter((d) => d !== domain);
    await saveState();
  };

  /**
   * Remove custom tracker parameter.
   */
  const removeCustomParam = async (param) => {
    currentCustomTrackers = currentCustomTrackers.filter((p) => p !== param);
    await saveState();
  };

  // ============================================================
  // Backup & Restore with Validation
  // ============================================================

  /**
   * Export backup file.
   */
  btnExport.addEventListener("click", () => {
    const backupData = {
      allowlist: currentAllowlist,
      customTrackers: currentCustomTrackers,
      stats: currentStats,
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(backupData, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `cleanurls_backup_${new Date().toISOString().split("T")[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  /**
   * Import backup file with validation.
   */
  btnImport.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      // Modern File API
      const text = await file.text();
      const importedData = JSON.parse(text);

      // Validate and filter allowlist
      if (Array.isArray(importedData.allowlist)) {
        const validDomains = importedData.allowlist.filter(
          (d) => typeof d === "string" && d.length > 0,
        );
        currentAllowlist = [...new Set([...currentAllowlist, ...validDomains])];
      }

      // Validate and filter custom trackers
      if (Array.isArray(importedData.customTrackers)) {
        const validParams = importedData.customTrackers.filter(
          (p) => typeof p === "string" && p.length > 0,
        );
        currentCustomTrackers = [
          ...new Set([...currentCustomTrackers, ...validParams]),
        ];
      }

      // Validate and merge stats
      if (importedData.stats && typeof importedData.stats === "object") {
        const mergedStats = { ...currentStats };

        for (const key in importedData.stats) {
          if (typeof importedData.stats[key] === "number") {
            // Primitive sum like "total" or "inspected"
            mergedStats[key] =
              (mergedStats[key] || 0) + importedData.stats[key];
          } else if (
            typeof importedData.stats[key] === "object" &&
            importedData.stats[key] !== null
          ) {
            // Deep merge for date objects
            if (!mergedStats[key]) mergedStats[key] = {};
            for (const subKey in importedData.stats[key]) {
              if (typeof importedData.stats[key][subKey] === "number") {
                mergedStats[key][subKey] =
                  (mergedStats[key][subKey] || 0) +
                  importedData.stats[key][subKey];
              }
            }
          }
        }

        await chrome.storage.local.set({ stats: mergedStats });
        currentStats = mergedStats;
      }

      await saveState();
      alert("Backup successfully imported!");
    } catch (error) {
      console.error("Import error:", error);
      alert("Invalid backup file formatting.");
    } finally {
      e.target.value = ""; // Reset file input
    }
  });

  // ============================================================
  // Storage Change Listener (sync across tabs/popup)
  // ============================================================

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace !== "local") return;

    if (changes.allowlist) {
      currentAllowlist = [...(changes.allowlist.newValue || [])];
      renderLists();
    }

    if (changes.customTrackers) {
      currentCustomTrackers = [...(changes.customTrackers.newValue || [])];
      renderLists();
    }

    if (changes.stats) {
      currentStats = { ...(changes.stats.newValue || {}) };
      renderStats();
    }
  });

  // ============================================================
  // Reset Stats Modal
  // ============================================================

  const resetModal = document.getElementById("reset-modal");

  document.getElementById("btn-reset-stats").addEventListener("click", () => {
    resetModal.classList.add("active");
  });

  document.getElementById("btn-modal-cancel").addEventListener("click", () => {
    resetModal.classList.remove("active");
  });

  resetModal.addEventListener("click", (e) => {
    if (e.target === resetModal) {
      resetModal.classList.remove("active");
    }
  });

  document
    .getElementById("btn-modal-confirm")
    .addEventListener("click", async () => {
      await chrome.storage.local.set({ stats: { total: 0, inspected: 0 } });
      currentStats = { total: 0, inspected: 0 };
      resetModal.classList.remove("active");
      renderStats();
    });

  // ============================================================
  // Initial Render
  // ============================================================

  renderLists();
  renderStats();
});
