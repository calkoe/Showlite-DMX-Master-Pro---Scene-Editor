// Operator Mode: auto-step through scenes with crossfade
// Fade interpolates DMX values between scenes; gobo/color wheels and WLED FX ID snap instantly.

let operatorRunning = false;
let operatorTimerId = null;
let operatorStepTime = 2.0; // seconds
let operatorFadeTime = 1.0; // seconds
let operatorPanelOpen = false;

// Crossfade state
let fadeActive = false;
let fadeStartTime = 0;
let fadeDuration = 0; // ms
let fadeFromDmx = null; // Uint8Array snapshot of previous scene
let fadeToDmx = null; // Uint8Array snapshot of next scene
let fadeNoFadeMask = null; // boolean[] - true = snap, don't fade

// Channel attribute names that should snap instead of fade
const SNAP_ATTRIBUTES = new Set(["GOBO_WHEEL", "COLOR_WHEEL", "WLED_FX_ID"]);

function isSnapChannel(scanner, channel) {
  const attrId = getChannelMapping(scanner, channel);
  const attr = CHANNEL_ATTRIBUTES[attrId];
  return attr && SNAP_ATTRIBUTES.has(attr.name);
}

function buildNoFadeMask() {
  const mask = new Array(DMX_UNIVERSE_SIZE).fill(false);
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      if (isSnapChannel(s, ch)) {
        mask[s * CHANNELS_PER_SCANNER + ch] = true;
      }
    }
  }
  return mask;
}

function getSceneDmxSnapshot(sceneIndex) {
  const dmx = new Uint8Array(DMX_UNIVERSE_SIZE);
  if (!proFileData) return dmx;
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      dmx[s * CHANNELS_PER_SCANNER + ch] =
        proFileData[getSceneChannelOffset(sceneIndex, s, ch)];
    }
  }
  return dmx;
}

// Returns the current interpolated DMX data during a fade, or direct scene data if no fade
function getOperatorDmxData() {
  if (!fadeActive || !fadeFromDmx || !fadeToDmx) {
    return getCurrentSceneDmxData();
  }

  const now = performance.now();
  const elapsed = now - fadeStartTime;
  const t = Math.min(1, elapsed / fadeDuration); // 0..1

  const dmx = new Uint8Array(DMX_UNIVERSE_SIZE);
  for (let i = 0; i < DMX_UNIVERSE_SIZE; i++) {
    if (fadeNoFadeMask && fadeNoFadeMask[i]) {
      // Snap channels switch to target immediately
      dmx[i] = fadeToDmx[i];
    } else {
      // Linear interpolation
      dmx[i] = Math.round(fadeFromDmx[i] + (fadeToDmx[i] - fadeFromDmx[i]) * t);
    }
  }

  if (t >= 1) {
    fadeActive = false;
  }

  return dmx;
}

function operatorNextScene() {
  if (!proFileData) return;

  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK);
  const sceneInBank = currentSceneIndex % SCENES_PER_BANK;
  const bankStart = currentBank * SCENES_PER_BANK;

  // Snapshot current DMX before advancing
  fadeFromDmx = getSceneDmxSnapshot(currentSceneIndex);

  // Advance to next scene in bank (wrap around)
  const nextSceneInBank = (sceneInBank + 1) % SCENES_PER_BANK;
  currentSceneIndex = bankStart + nextSceneInBank;

  // Snapshot target scene
  fadeToDmx = getSceneDmxSnapshot(currentSceneIndex);
  fadeNoFadeMask = buildNoFadeMask();

  // Start fade
  const fadeMs = operatorFadeTime * 1000;
  if (fadeMs > 0) {
    fadeActive = true;
    fadeStartTime = performance.now();
    fadeDuration = fadeMs;
  } else {
    fadeActive = false;
  }

  // Update GUI to show the new scene
  displayScene();
  updateOperatorDisplay();
}

function operatorStart() {
  if (operatorRunning) return;
  if (!proFileData) {
    showError("Load a file first");
    return;
  }

  operatorRunning = true;
  scheduleNextStep();
  updateOperatorControls();
}

function operatorStop() {
  operatorRunning = false;
  fadeActive = false;
  if (operatorTimerId !== null) {
    clearTimeout(operatorTimerId);
    operatorTimerId = null;
  }
  updateOperatorControls();
}

function scheduleNextStep() {
  if (!operatorRunning) return;
  operatorTimerId = setTimeout(() => {
    if (!operatorRunning) return;
    operatorNextScene();
    scheduleNextStep();
  }, operatorStepTime * 1000);
}

function toggleOperatorPanel() {
  operatorPanelOpen = !operatorPanelOpen;
  const panel = document.getElementById("operatorPanel");
  if (panel) {
    panel.style.display = operatorPanelOpen ? "block" : "none";
  }
  updateOperatorControls();
}

function updateOperatorStepTime(val) {
  const num = parseFloat(val);
  if (!isNaN(num) && num >= 0.1 && num <= 20) {
    operatorStepTime = num;
  }
}

function updateOperatorFadeTime(val) {
  const num = parseFloat(val);
  if (!isNaN(num) && num >= 0.1 && num <= 20) {
    operatorFadeTime = num;
  }
}

function updateOperatorControls() {
  const startBtn = document.getElementById("operatorStartBtn");
  const stopBtn = document.getElementById("operatorStopBtn");
  const toggleBtn = document.getElementById("operatorToggleBtn");
  const statusEl = document.getElementById("operatorStatus");

  if (toggleBtn) {
    toggleBtn.classList.toggle("operator-active", operatorPanelOpen);
  }
  if (startBtn) {
    startBtn.disabled = operatorRunning;
  }
  if (stopBtn) {
    stopBtn.disabled = !operatorRunning;
  }
  if (statusEl) {
    if (operatorRunning) {
      const bank = Math.floor(currentSceneIndex / SCENES_PER_BANK) + 1;
      const scene = (currentSceneIndex % SCENES_PER_BANK) + 1;
      statusEl.textContent = `▶ Bank ${bank} / Scene ${scene}`;
      statusEl.style.color = "#4ade80";
    } else {
      statusEl.textContent = "⏹ Stopped";
      statusEl.style.color = "#888";
    }
  }
}

function updateOperatorDisplay() {
  updateOperatorControls();
}
