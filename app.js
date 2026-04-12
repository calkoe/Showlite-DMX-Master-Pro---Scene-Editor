// Global application state
let proFileData = null;
let currentSceneIndex = 0;
let originalFileName = "modified.PRO";
let scannerClipboard = null;
let displayedChannels = 8;
let selectedScanners = new Set();

// DOM elements
const sceneDisplay = document.getElementById("sceneDisplay");
const errorDiv = document.getElementById("error");
const copyControls = document.getElementById("copyControls");
const controlsBar = document.getElementById("controlsBar");

// --- Error handling ---

let errorTimeoutId = null;

function showError(message) {
  errorDiv.innerHTML = `<div class="error">${message}</div>`;
  if (errorTimeoutId) clearTimeout(errorTimeoutId);
  errorTimeoutId = setTimeout(clearError, 3000);
}

function clearError() {
  errorDiv.innerHTML = "";
  if (errorTimeoutId) {
    clearTimeout(errorTimeoutId);
    errorTimeoutId = null;
  }
}

// --- File handling ---

function loadFileData(data, name) {
  proFileData = new Uint8Array(data);

  if (proFileData.length !== 131584) {
    throw new Error(
      `Invalid file size: ${proFileData.length} bytes (expected 131,584)`,
    );
  }

  originalFileName = name;
  currentSceneIndex = 0;
  clearError();

  controlsBar.style.display = "";
  copyControls.style.display = "grid";

  displayScene();
}

async function loadDemo() {
  try {
    const resp = await fetch("FILE1.PRO");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const arrayBuffer = await resp.arrayBuffer();
    loadFileData(arrayBuffer, "FILE1.PRO");
  } catch (err) {
    showError(`Error loading demo file: ${err.message}`);
  }
}

document
  .getElementById("fileInput")
  .addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const arrayBuffer = await file.arrayBuffer();
      loadFileData(arrayBuffer, file.name);
    } catch (err) {
      showError(`Error loading file: ${err.message}`);
    }
  });

// --- Keyboard navigation ---

document.addEventListener("keydown", (event) => {
  if (!proFileData) return;

  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK);
  const sceneInBank = currentSceneIndex % SCENES_PER_BANK;

  if (event.key === "ArrowRight") {
    event.preventDefault();
    currentSceneIndex =
      currentBank * SCENES_PER_BANK + ((sceneInBank + 1) % SCENES_PER_BANK);
    displayScene();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    currentSceneIndex =
      currentBank * SCENES_PER_BANK +
      ((sceneInBank - 1 + SCENES_PER_BANK) % SCENES_PER_BANK);
    displayScene();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    currentSceneIndex =
      ((currentBank + 1) % NUM_BANKS) * SCENES_PER_BANK + sceneInBank;
    displayScene();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    currentSceneIndex =
      ((currentBank - 1 + NUM_BANKS) % NUM_BANKS) * SCENES_PER_BANK +
      sceneInBank;
    displayScene();
  }
});

// --- Navigation ---

function jumpToScene(sceneIndex) {
  if (!proFileData) return;
  currentSceneIndex = sceneIndex;
  displayScene();
}

function jumpToChannelConfig() {
  jumpToScene(CONFIG_SCENE_INDEX);
}

function jumpToCalibration() {
  jumpToScene(CONFIG_SCENE_INDEX + 1);
}

// --- Bank operations ---

function copyBank() {
  if (!proFileData) return;

  const fromBank = parseInt(document.getElementById("copyFromBank").value);
  const toBank = parseInt(document.getElementById("copyToBank").value);

  if (
    !fromBank ||
    !toBank ||
    fromBank < 1 ||
    fromBank > 30 ||
    toBank < 1 ||
    toBank > 30
  ) {
    showError("Please enter valid bank numbers (1-30)");
    return;
  }

  const bankSize = SCENES_PER_BANK * SCENE_RECORD_SIZE;
  const fromOffset = getSceneBlockOffset((fromBank - 1) * SCENES_PER_BANK);
  const toOffset = getSceneBlockOffset((toBank - 1) * SCENES_PER_BANK);

  proFileData.set(
    proFileData.subarray(fromOffset, fromOffset + bankSize),
    toOffset,
  );
  clearError();

  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK) + 1;
  if (currentBank === toBank) displayScene();
}

function clearScene() {
  if (!proFileData) return;

  const confirmed = confirm(
    "Clear all channel values in this scene? This will set all channels to 0.",
  );
  if (!confirmed) return;

  const offset = getSceneBlockOffset(currentSceneIndex);
  proFileData.fill(0, offset, offset + SCENE_RECORD_SIZE);

  clearError();
  displayScene();
}

function clearBank() {
  if (!proFileData) return;

  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK) + 1;
  const confirmed = confirm(
    `Clear ALL 8 scenes in Bank ${currentBank}? This will set all channels in all scenes to 0.`,
  );
  if (!confirmed) return;

  const firstSceneInBank =
    Math.floor(currentSceneIndex / SCENES_PER_BANK) * SCENES_PER_BANK;

  for (let i = 0; i < SCENES_PER_BANK; i++) {
    const offset = getSceneBlockOffset(firstSceneInBank + i);
    proFileData.fill(0, offset, offset + SCENE_RECORD_SIZE);
  }

  clearError();
  displayScene();
}

function downloadFile() {
  if (!proFileData) return;

  // Recalculate all scene metadata before saving
  for (let i = 0; i < TOTAL_SCENES; i++) {
    updateSceneMetadata(i);
  }

  const blob = new Blob([proFileData], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = originalFileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Scanner copy/paste ---

function flashScannerRow(scanner) {
  const row = document.getElementById(`scanner-row-${scanner}`);
  if (!row) return;
  row.classList.remove("flash");
  void row.offsetWidth; // force reflow to restart animation
  row.classList.add("flash");
  row.addEventListener("animationend", () => row.classList.remove("flash"), {
    once: true,
  });
}

function copyScanner(scanner) {
  if (!proFileData) return;

  const sceneData = getSceneData(currentSceneIndex);
  if (!sceneData) return;

  scannerClipboard = [...sceneData.scanners[scanner]];
  flashScannerRow(scanner);
}

function pasteScanner(scanner) {
  if (!proFileData) return;
  if (!scannerClipboard) {
    showError("⚠️ Clipboard is empty. Copy a scanner first.");
    return;
  }

  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    proFileData[getSceneChannelOffset(currentSceneIndex, scanner, ch)] =
      scannerClipboard[ch];
  }

  updateSceneMetadata(currentSceneIndex);
  displayScene();
  flashScannerRow(scanner);
}

function fillForwardScanner(scanner) {
  if (!proFileData) return;

  const sceneData = getSceneData(currentSceneIndex);
  if (!sceneData) return;

  const currentSceneInBank = currentSceneIndex % SCENES_PER_BANK;
  const bankStart =
    Math.floor(currentSceneIndex / SCENES_PER_BANK) * SCENES_PER_BANK;
  const channelValues = sceneData.scanners[scanner];

  for (let si = currentSceneInBank + 1; si < SCENES_PER_BANK; si++) {
    const targetIndex = bankStart + si;
    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      proFileData[getSceneChannelOffset(targetIndex, scanner, ch)] =
        channelValues[ch];
    }
    updateSceneMetadata(targetIndex);
  }

  displayScene();
  flashScannerRow(scanner);
}

// --- Display settings ---

function updateChannelDisplay(count) {
  const num = parseInt(count);
  if (isNaN(num) || num < 1 || num > 16) {
    showError("Channel count must be between 1 and 16");
    return;
  }
  displayedChannels = num;
  displayScene();
}
