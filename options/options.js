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

  // Load Initial Data
  const { allowlist = [], customTrackers = [] } =
    await chrome.storage.local.get(["allowlist", "customTrackers"]);

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

  const saveState = async () => {
    await chrome.storage.local.set({
      allowlist: currentAllowlist,
      customTrackers: currentCustomTrackers,
    });
    renderLists();
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
    const param = customParamsInput.value.trim();
    if (param && !currentCustomTrackers.includes(param)) {
      currentCustomTrackers.push(param);
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
        await saveState();
        alert("Backup successfully imported!");
      } catch (error) {
        alert("Invalid backup file formatting.");
      }
      e.target.value = ""; // Reset file input
    };
    reader.readAsText(file);
  });

  // Initial render
  renderLists();
});
