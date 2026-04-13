// Operator Mode: auto-step through scenes with crossfade + live controls
// Controls overlay DMX output without modifying bank/scene data.

// ── State ────────────────────────────────────────────────────────

let operatorRunning = false;
let operatorTimerId = null;
let operatorStepTime = 2.0;
let operatorFadeTime = 1.0;
let operatorPanelOpen = false;
let operatorInitialized = false;

// Crossfade
let fadeActive = false;
let fadeStartTime = 0;
let fadeDuration = 0;
let fadeFromDmx = null;
let fadeToDmx = null;
let fadeNoFadeMask = null;

// Master dimmer
let opMasterDimmer = 255;
let opMasterDimmerEnabled = false;

// Effect buttons — permanent (left-click toggle) + temporary (right-click hold)
let opBlackoutPerm = false,
  opBlackoutTemp = false;
let opStrobePerm = false,
  opStrobeTemp = false;
let opRandomStrobePerm = false,
  opRandomStrobeTemp = false;

// Bank temp switch (right-click)
let opPreviousBank = -1;

// Strobe engine
const STROBE_HZ = 10;
let randomStrobeMask = [];
let randomStrobeLastChange = 0;
const RANDOM_STROBE_CHANGE_MS = 200;

// Tap tempo
let tapTimes = [];
const TAP_RESET_MS = 3000;
const TAP_MAX_SAMPLES = 8;

// Snap channels
const SNAP_ATTRIBUTES = new Set(["GOBO_WHEEL", "COLOR_WHEEL", "WLED_FX_ID"]);

// ── Helpers ──────────────────────────────────────────────────────

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

// ── Strobe engine ────────────────────────────────────────────────

function isStrobeOn() {
  const period = 1000 / STROBE_HZ;
  return performance.now() % period < period * 0.3;
}

function updateRandomStrobeMask() {
  const now = performance.now();
  if (now - randomStrobeLastChange > RANDOM_STROBE_CHANGE_MS) {
    randomStrobeMask = [];
    for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
      randomStrobeMask.push(Math.random() > 0.5);
    }
    randomStrobeLastChange = now;
  }
}

// ── Operator DMX overrides ───────────────────────────────────────

function applyOperatorOverrides(dmx) {
  const blackout = opBlackoutPerm || opBlackoutTemp;
  const strobe = opStrobePerm || opStrobeTemp;
  const randomStrobe = opRandomStrobePerm || opRandomStrobeTemp;

  // 1. Master dimmer scaling
  if (opMasterDimmerEnabled) {
    for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
      const dimCh = getDimmerChannel(s);
      if (dimCh >= 0) {
        const idx = s * CHANNELS_PER_SCANNER + dimCh;
        dmx[idx] = Math.round((dmx[idx] * opMasterDimmer) / 255);
      }
    }
  }

  // 2. Master strobe (all scanners flash together)
  if (strobe && !blackout && !randomStrobe) {
    if (!isStrobeOn()) {
      for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
        const dimCh = getDimmerChannel(s);
        if (dimCh >= 0) dmx[s * CHANNELS_PER_SCANNER + dimCh] = 0;
      }
    }
  }

  // 3. Random strobe (random subset flashes, others off)
  if (randomStrobe && !blackout) {
    updateRandomStrobeMask();
    const on = isStrobeOn();
    for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
      const dimCh = getDimmerChannel(s);
      if (dimCh >= 0) {
        if (!randomStrobeMask[s] || !on) {
          dmx[s * CHANNELS_PER_SCANNER + dimCh] = 0;
        }
      }
    }
  }

  // 4. Blackout (highest priority)
  if (blackout) {
    for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
      const dimCh = getDimmerChannel(s);
      if (dimCh >= 0) dmx[s * CHANNELS_PER_SCANNER + dimCh] = 0;
    }
  }

  return dmx;
}

// Returns current DMX data with crossfade + operator overrides
function getOperatorDmxData() {
  let dmx;

  if (fadeActive && fadeFromDmx && fadeToDmx) {
    const now = performance.now();
    const elapsed = now - fadeStartTime;
    const t = Math.min(1, elapsed / fadeDuration);

    dmx = new Uint8Array(DMX_UNIVERSE_SIZE);
    for (let i = 0; i < DMX_UNIVERSE_SIZE; i++) {
      if (fadeNoFadeMask && fadeNoFadeMask[i]) {
        dmx[i] = fadeToDmx[i];
      } else {
        dmx[i] = Math.round(
          fadeFromDmx[i] + (fadeToDmx[i] - fadeFromDmx[i]) * t,
        );
      }
    }
    if (t >= 1) fadeActive = false;
  } else {
    dmx = getCurrentSceneDmxData();
  }

  return applyOperatorOverrides(dmx);
}

// ── Auto-step ────────────────────────────────────────────────────

function operatorNextScene() {
  if (!proFileData) return;

  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK);
  const sceneInBank = currentSceneIndex % SCENES_PER_BANK;

  fadeFromDmx = getSceneDmxSnapshot(currentSceneIndex);

  const nextSceneInBank = (sceneInBank + 1) % SCENES_PER_BANK;
  currentSceneIndex = currentBank * SCENES_PER_BANK + nextSceneInBank;

  fadeToDmx = getSceneDmxSnapshot(currentSceneIndex);
  fadeNoFadeMask = buildNoFadeMask();

  const fadeMs = operatorFadeTime * 1000;
  if (fadeMs > 0) {
    fadeActive = true;
    fadeStartTime = performance.now();
    fadeDuration = fadeMs;
  } else {
    fadeActive = false;
  }

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

// ── Panel ────────────────────────────────────────────────────────

function toggleOperatorPanel() {
  operatorPanelOpen = !operatorPanelOpen;
  const panel = document.getElementById("operatorPanel");
  if (panel) {
    panel.style.display = operatorPanelOpen ? "block" : "none";
    if (operatorPanelOpen && !operatorInitialized) {
      initOperatorControls();
      operatorInitialized = true;
    }
    if (operatorPanelOpen) updateOperatorBankDisplay();
  }
  const toggleBtn = document.getElementById("operatorToggleBtn");
  if (toggleBtn)
    toggleBtn.classList.toggle("operator-active", operatorPanelOpen);
  updateOperatorControls();
}

function initOperatorControls() {
  buildOperatorBankGrid();
  setupEffectButton(
    "opBlackoutBtn",
    () => opBlackoutPerm,
    (v) => {
      opBlackoutPerm = v;
    },
    () => opBlackoutTemp,
    (v) => {
      opBlackoutTemp = v;
    },
  );
  setupEffectButton(
    "opStrobeBtn",
    () => opStrobePerm,
    (v) => {
      opStrobePerm = v;
    },
    () => opStrobeTemp,
    (v) => {
      opStrobeTemp = v;
    },
  );
  setupEffectButton(
    "opRandomBtn",
    () => opRandomStrobePerm,
    (v) => {
      opRandomStrobePerm = v;
    },
    () => opRandomStrobeTemp,
    (v) => {
      opRandomStrobeTemp = v;
    },
  );
}

// ── Bank grid ────────────────────────────────────────────────────

function buildOperatorBankGrid() {
  const grid = document.getElementById("opBankGrid");
  if (!grid) return;
  grid.innerHTML = "";

  for (let b = 1; b <= NUM_BANKS; b++) {
    const btn = document.createElement("button");
    const colorGroup = Math.floor((b - 1) / 5) + 1;
    btn.className = `op-bank-btn cg-${colorGroup}`;
    btn.textContent = b;
    btn.dataset.bank = b;

    // Left click: permanent select
    btn.addEventListener("click", () => operatorSelectBank(b));

    // Right click: temporary (hold)
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
    btn.addEventListener("mousedown", (e) => {
      if (e.button === 2) {
        opPreviousBank = Math.floor(currentSceneIndex / SCENES_PER_BANK) + 1;
        operatorSelectBank(b);
      }
    });
    btn.addEventListener("mouseup", (e) => {
      if (e.button === 2 && opPreviousBank > 0) {
        operatorSelectBank(opPreviousBank);
        opPreviousBank = -1;
      }
    });
    btn.addEventListener("mouseleave", () => {
      if (opPreviousBank > 0) {
        operatorSelectBank(opPreviousBank);
        opPreviousBank = -1;
      }
    });

    grid.appendChild(btn);
  }
}

function operatorSelectBank(bankNum) {
  const bankIndex = bankNum - 1;

  if (operatorRunning) {
    clearTimeout(operatorTimerId);
    fadeActive = false;
    currentSceneIndex =
      bankIndex * SCENES_PER_BANK + (currentSceneIndex % SCENES_PER_BANK);
    displayScene();
    scheduleNextStep();
  } else {
    currentSceneIndex = bankIndex * SCENES_PER_BANK;
    displayScene();
  }
  updateOperatorBankDisplay();
  updateOperatorControls();
}

function updateOperatorBankDisplay() {
  const grid = document.getElementById("opBankGrid");
  if (!grid) return;
  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK) + 1;
  for (const btn of grid.children) {
    btn.classList.toggle("active", parseInt(btn.dataset.bank) === currentBank);
  }
}

// ── Timing ───────────────────────────────────────────────────────

function updateOperatorStepTime(val) {
  const num = parseFloat(val);
  if (!isNaN(num) && num >= 0.1 && num <= 20) operatorStepTime = num;
}

function updateOperatorFadeTime(val) {
  const num = parseFloat(val);
  if (!isNaN(num) && num >= 0.1 && num <= 20) operatorFadeTime = num;
}

// ── Tap tempo ────────────────────────────────────────────────────

function operatorTap() {
  const now = performance.now();

  if (
    tapTimes.length > 0 &&
    now - tapTimes[tapTimes.length - 1] > TAP_RESET_MS
  ) {
    tapTimes = [];
  }

  tapTimes.push(now);
  if (tapTimes.length > TAP_MAX_SAMPLES) tapTimes.shift();

  if (tapTimes.length >= 2) {
    let total = 0;
    for (let i = 1; i < tapTimes.length; i++)
      total += tapTimes[i] - tapTimes[i - 1];
    const avgSec = Math.max(
      0.1,
      Math.min(20, total / (tapTimes.length - 1) / 1000),
    );

    operatorStepTime = avgSec;
    operatorFadeTime = avgSec;

    const stepSlider = document.getElementById("operatorStepSlider");
    const fadeSlider = document.getElementById("operatorFadeSlider");
    const stepVal = document.getElementById("operatorStepVal");
    const fadeVal = document.getElementById("operatorFadeVal");

    if (stepSlider) stepSlider.value = operatorStepTime;
    if (fadeSlider) fadeSlider.value = operatorFadeTime;
    if (stepVal) stepVal.textContent = operatorStepTime.toFixed(1) + "s";
    if (fadeVal) fadeVal.textContent = operatorFadeTime.toFixed(1) + "s";
  }

  const btn = document.getElementById("opTapBtn");
  if (btn) {
    btn.classList.add("tap-flash");
    setTimeout(() => btn.classList.remove("tap-flash"), 100);
  }
}

// ── Master dimmer ────────────────────────────────────────────────

function opSetMasterDimmer(val) {
  opMasterDimmer = parseInt(val) || 0;
  const label = document.getElementById("opDimmerVal");
  if (label) label.textContent = opMasterDimmer;
}

function opToggleMasterDimmer(checked) {
  opMasterDimmerEnabled = checked;
  const slider = document.getElementById("opDimmerSlider");
  if (slider) slider.disabled = !checked;
}

// ── Effect buttons (left=toggle, right=momentary) ────────────────

function setupEffectButton(btnId, getPerm, setPerm, getTemp, setTemp) {
  const btn = document.getElementById(btnId);
  if (!btn) return;

  btn.addEventListener("click", () => {
    setPerm(!getPerm());
    updateEffectButtons();
  });

  btn.addEventListener("contextmenu", (e) => e.preventDefault());

  btn.addEventListener("mousedown", (e) => {
    if (e.button === 2) {
      setTemp(true);
      updateEffectButtons();
    }
  });

  btn.addEventListener("mouseup", (e) => {
    if (e.button === 2) {
      setTemp(false);
      updateEffectButtons();
    }
  });

  btn.addEventListener("mouseleave", () => {
    if (getTemp()) {
      setTemp(false);
      updateEffectButtons();
    }
  });
}

function updateEffectButtons() {
  const pairs = [
    ["opBlackoutBtn", opBlackoutPerm || opBlackoutTemp],
    ["opStrobeBtn", opStrobePerm || opStrobeTemp],
    ["opRandomBtn", opRandomStrobePerm || opRandomStrobeTemp],
  ];
  for (const [id, active] of pairs) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle("active", active);
  }
}

// ── UI update ────────────────────────────────────────────────────

function updateOperatorControls() {
  const startBtn = document.getElementById("operatorStartBtn");
  const stopBtn = document.getElementById("operatorStopBtn");
  const statusEl = document.getElementById("operatorStatus");

  if (startBtn) startBtn.disabled = operatorRunning;
  if (stopBtn) stopBtn.disabled = !operatorRunning;

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

  updateOperatorBankDisplay();
}

function updateOperatorDisplay() {
  updateOperatorControls();
}
