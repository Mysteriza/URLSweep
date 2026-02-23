// options.js

document.addEventListener("DOMContentLoaded", async () => {
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

  let currentAllowlist = [...allowlist];
  let currentCustomTrackers = [...customTrackers];

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

  const renderStats = () => {
    const elUpdated = document.getElementById("stat-updated");
    const elElements = document.getElementById("stat-elements");
    const elBlocked = document.getElementById("stat-blocked");
    const elPct = document.getElementById("stat-pct");
    const barBlocked = document.getElementById("progress-blocked");
    const barElements = document.getElementById("progress-elements");

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
    const tInspected = stats.inspected || 0;
    const tBlocked = stats.total || 0;

    if (elElements) elElements.textContent = tInspected.toLocaleString();
    if (elBlocked) elBlocked.textContent = tBlocked.toLocaleString();

    if (tInspected > 0) {
      const pctValue = (tBlocked / tInspected) * 100;
      if (elPct) elPct.textContent = `${pctValue.toFixed(3)}%`;

      if (barBlocked && barElements) {
        // ClearURLs style bar logic: Blocked grows from the left, Elements fills the rest
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
  };

  const saveState = async () => {
    await chrome.storage.local.set({
      allowlist: currentAllowlist,
      customTrackers: currentCustomTrackers,
    });
    renderLists();
    renderStats();
  };

  // Add Handlers
  allowlistForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    let domain = allowlistInput.value.trim().toLowerCase();

    // Simple domain extraction if user pastes full URL
    try {
      if (domain.includes("http")) {
        const url = new URL(domain);
        domain = url.hostname;
      }
    } catch (e) {}

    if (domain && !currentAllowlist.includes(domain)) {
      currentAllowlist.push(domain);
      await saveState();
      allowlistInput.value = "";
    }
  });

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

  // Remove Handlers
  const removeAllowlist = async (domain) => {
    currentAllowlist = currentAllowlist.filter((d) => d !== domain);
    await saveState();
  };

  const removeCustomParam = async (param) => {
    currentCustomTrackers = currentCustomTrackers.filter((p) => p !== param);
    await saveState();
  };

  // Backup & Restore
  btnExport.addEventListener("click", () => {
    const backupData = {
      allowlist: currentAllowlist,
      customTrackers: currentCustomTrackers,
      stats: stats,
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

  btnImport.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (Array.isArray(importedData.allowlist)) {
          currentAllowlist = [
            ...new Set([...currentAllowlist, ...importedData.allowlist]),
          ];
        }
        if (Array.isArray(importedData.customTrackers)) {
          currentCustomTrackers = [
            ...new Set([
              ...currentCustomTrackers,
              ...importedData.customTrackers,
            ]),
          ];
        }

        // Merge stats if existing
        if (importedData.stats && typeof importedData.stats === "object") {
          let updatedStats = { ...stats };
          for (const key in importedData.stats) {
            if (typeof importedData.stats[key] === "number") {
              // Primitive sum like "total" or "inspected"
              updatedStats[key] =
                (updatedStats[key] || 0) + importedData.stats[key];
            } else if (typeof importedData.stats[key] === "object") {
              // Deep merge for date objects
              if (!updatedStats[key]) updatedStats[key] = {};
              for (const subKey in importedData.stats[key]) {
                updatedStats[key][subKey] =
                  (updatedStats[key][subKey] || 0) +
                  importedData.stats[key][subKey];
              }
            }
          }
          await chrome.storage.local.set({ stats: updatedStats });
          // Must re-pull the global stats reference before updating view
          const freshData = await chrome.storage.local.get("stats");
          Object.assign(stats, freshData.stats);
        }

        await saveState();
        alert("Backup successfully imported!");
      } catch (error) {
        alert("Invalid backup file formatting.");
      }
      e.target.value = ""; // Reset file input
    };
    reader.readAsText(file);
  });

  // Reset Stats Modal
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
      await chrome.storage.local.set({ stats: { total: 0 } });
      window.location.reload();
    });

  // Initial render
  renderLists();
  renderStats();
});
