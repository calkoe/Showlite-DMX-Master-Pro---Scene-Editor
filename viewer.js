// Constants from PRO file format
const SCENE_RECORD_SIZE = 256;
const SCENES_PER_BANK = 8;
const NUM_BANKS = 30;
const SCANNERS_PER_SCENE = 12;
const CHANNELS_PER_SCANNER = 16;
const TOTAL_SCENES = NUM_BANKS * SCENES_PER_BANK; // 240
const SCANNER_BYTES_PER_SCENE = SCANNERS_PER_SCENE * CHANNELS_PER_SCANNER; // 192
const SCENE_METADATA_OFFSET = 193;
const SCENE_DATA_START_OFFSET = 3 * SCENE_RECORD_SIZE;
const BANK_RECORD_SIZE = SCENES_PER_BANK * SCENE_RECORD_SIZE;
// Observed scene-area padding in FILE6.PRO: +256 bytes before Bank 7, +128 bytes before Bank 12.
const BANK_PADDING_SEGMENTS = [
  { fromBank: 7, bytes: SCENE_RECORD_SIZE },
  { fromBank: 12, bytes: SCENE_RECORD_SIZE / 2 },
];

// Channel attribute types (stored in Bank 30, Scene 1)
const CHANNEL_ATTRIBUTES = {
  0: { name: "NONE", label: "Not Assigned", color: "#666" },
  1: { name: "PAN", label: "Pan", color: "#4a9eff" },
  2: { name: "PAN_FINE", label: "Pan Fine", color: "#3a8edf" },
  3: { name: "TILT", label: "Tilt", color: "#9d4eff" },
  4: { name: "TILT_FINE", label: "Tilt Fine", color: "#8d3eef" },
  5: { name: "DIMMER", label: "Dimmer", color: "#ffcc00" },
  6: { name: "RED", label: "Red", color: "#ff4444" },
  7: { name: "GREEN", label: "Green", color: "#44ff44" },
  8: { name: "BLUE", label: "Blue", color: "#4444ff" },
  9: { name: "WHITE", label: "White", color: "#ffffff" },
  10: { name: "COLOR_WHEEL", label: "Color Wheel", color: "#ff88cc" },
  11: { name: "GOBO_WHEEL", label: "Gobo Wheel", color: "#88ccff" },
  12: { name: "STROBE", label: "Strobe", color: "#ffaa00" },
  13: { name: "SPEED", label: "Speed", color: "#00ffaa" },
};

// Bank 30, Scene 1 is used for channel mapping metadata
const CONFIG_SCENE_INDEX = (30 - 1) * SCENES_PER_BANK; // Bank 30, Scene 1 = index 232

// Bank 30 calibration scenes
const CALIBRATION_SCENES = {
  2: {
    name: "Pan/Tilt -90° + Gobo/Color Slot 1",
    desc: "Mark -90 degree positions for Pan/Tilt AND first Gobo/Color wheel slot",
  },
  3: {
    name: "Pan/Tilt 0° + Gobo/Color Slot 2",
    desc: "Mark center/home (0°) for Pan/Tilt AND second Gobo/Color wheel slot",
  },
  4: {
    name: "Pan/Tilt +90° + Gobo/Color Slot 3",
    desc: "Mark +90 degree positions for Pan/Tilt AND third Gobo/Color wheel slot",
  },
  5: {
    name: "Gobo/Color Slot 4",
    desc: "DMX values for fourth Gobo and Color wheel slot positions",
  },
  6: {
    name: "Gobo/Color Slot 5",
    desc: "DMX values for fifth Gobo and Color wheel slot positions",
  },
  7: {
    name: "Gobo/Color Slot 6",
    desc: "DMX values for sixth Gobo and Color wheel slot positions",
  },
  8: {
    name: "Gobo/Color Slot 7",
    desc: "DMX values for seventh Gobo and Color wheel slot positions",
  },
};

// Generate a distinct background color for each bank (1-30)
function getBankColor(bank) {
  const hue = ((bank + 12) * 12) % 360;
  return `hsl(${hue}, 40%, 18%)`;
}

// Track selected scanners for synchronized control
let selectedScanners = new Set();

// --- Offset helpers ---

// Recalculate byte 0 (count of non-zero channel bytes) and metadata bitmasks for a scene
function updateSceneMetadata(sceneIndex) {
  const blockOffset = getSceneBlockOffset(sceneIndex);

  // Recalculate count byte (byte 0 = number of non-zero bytes in scanner data area)
  let count = 0;
  for (let i = 1; i <= SCANNER_BYTES_PER_SCENE; i++) {
    if (proFileData[blockOffset + i] !== 0) count++;
  }
  proFileData[blockOffset] = count;

  // Recalculate per-scanner channel bitmasks in metadata area
  // Metadata starts at byte 193 of the scene record, odd-indexed bytes are Page A bitmasks.
  const metaBase = blockOffset + SCENE_METADATA_OFFSET;
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    let bitmask = 0;
    for (let ch = 0; ch < 8; ch++) {
      const val = proFileData[getSceneChannelOffset(sceneIndex, s, ch)];
      if (val !== 0) bitmask |= 1 << ch;
    }
    proFileData[metaBase + s * 2] = bitmask;
  }
}

function getBankPadding(bank) {
  let padding = 0;
  for (const segment of BANK_PADDING_SEGMENTS) {
    if (bank >= segment.fromBank) {
      padding += segment.bytes;
    }
  }
  return padding;
}

function getSceneChannelOffset(sceneIndex, scanner, channel) {
  // Byte 0 of each scene record is a count byte (number of non-zero channel bytes).
  // Scanner data starts at byte 1.
  return (
    getSceneBlockOffset(sceneIndex) +
    1 +
    scanner * CHANNELS_PER_SCANNER +
    channel
  );
}

function getSceneBlockOffset(sceneIndex) {
  const bank = Math.floor(sceneIndex / SCENES_PER_BANK) + 1;
  const sceneInBank = sceneIndex % SCENES_PER_BANK;
  return (
    SCENE_DATA_START_OFFSET +
    (bank - 1) * BANK_RECORD_SIZE +
    getBankPadding(bank) +
    sceneInBank * SCENE_RECORD_SIZE
  );
}

// --- Channel mapping helpers ---

function getPanTiltChannels(scanner) {
  let pan = -1,
    panFine = -1,
    tilt = -1,
    tiltFine = -1;

  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    const attrId = getChannelMapping(scanner, ch);
    const attr = CHANNEL_ATTRIBUTES[attrId];
    if (attr) {
      if (attr.name === "PAN") pan = ch;
      else if (attr.name === "PAN_FINE") panFine = ch;
      else if (attr.name === "TILT") tilt = ch;
      else if (attr.name === "TILT_FINE") tiltFine = ch;
    }
  }

  return { pan, panFine, tilt, tiltFine };
}

function getCalibrationValue(scanner, channel, presetScene) {
  if (!proFileData || presetScene < 2 || presetScene > 8) return 0;
  const calibSceneIndex = CONFIG_SCENE_INDEX + (presetScene - 1);
  return proFileData[getSceneChannelOffset(calibSceneIndex, scanner, channel)];
}

function isWheelChannel(scanner, channel) {
  const attrId = getChannelMapping(scanner, channel);
  const attr = CHANNEL_ATTRIBUTES[attrId];
  return attr && (attr.name === "GOBO_WHEEL" || attr.name === "COLOR_WHEEL");
}

function getDimmerChannel(scanner) {
  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    const attrId = getChannelMapping(scanner, ch);
    const attr = CHANNEL_ATTRIBUTES[attrId];
    if (attr && attr.name === "DIMMER") return ch;
  }
  return -1;
}

function getScannerDimmerStyle(scanner, sceneData) {
  const dimmerCh = getDimmerChannel(scanner);
  if (dimmerCh >= 0) {
    const dimmerValue = sceneData.scanners[scanner][dimmerCh];
    const intensity = dimmerValue / 255;
    return {
      bgColor: `rgba(255, 204, 0, ${intensity * 0.6})`,
      brightness: Math.round(intensity * 100),
      value: dimmerValue,
    };
  }
  return { bgColor: "transparent", brightness: 0, value: 0 };
}

// --- Global state ---

let proFileData = null;
let currentSceneIndex = 0; // 0-239
let originalFileName = "modified.PRO";

// --- DOM elements ---

const fileInput = document.getElementById("fileInput");
const sceneInfo = document.getElementById("sceneInfo");
const sceneTitle = document.getElementById("sceneTitle");
const sceneDisplay = document.getElementById("sceneDisplay");
const errorDiv = document.getElementById("error");
const copyControls = document.getElementById("copyControls");
const actionButtons = document.getElementById("actionButtons");

// --- Event handlers ---

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    proFileData = new Uint8Array(arrayBuffer);

    if (proFileData.length !== 131584) {
      throw new Error(
        `Invalid file size: ${proFileData.length} bytes (expected 131,584)`,
      );
    }

    originalFileName = file.name;
    currentSceneIndex = 0;
    clearError();

    copyControls.style.display = "grid";
    actionButtons.style.display = "flex";

    displayScene();
  } catch (err) {
    showError(`Error loading file: ${err.message}`);
  }
});

document.addEventListener("keydown", (event) => {
  if (!proFileData) return;

  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK);
  const sceneInBank = currentSceneIndex % SCENES_PER_BANK;

  if (event.key === "ArrowRight") {
    event.preventDefault();
    const nextScene = (sceneInBank + 1) % SCENES_PER_BANK;
    currentSceneIndex = currentBank * SCENES_PER_BANK + nextScene;
    displayScene();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    const prevScene = (sceneInBank - 1 + SCENES_PER_BANK) % SCENES_PER_BANK;
    currentSceneIndex = currentBank * SCENES_PER_BANK + prevScene;
    displayScene();
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    const nextBank = (currentBank + 1) % NUM_BANKS;
    currentSceneIndex = nextBank * SCENES_PER_BANK + sceneInBank;
    displayScene();
  } else if (event.key === "ArrowDown") {
    event.preventDefault();
    const prevBank = (currentBank - 1 + NUM_BANKS) % NUM_BANKS;
    currentSceneIndex = prevBank * SCENES_PER_BANK + sceneInBank;
    displayScene();
  }
});

// --- Data access ---

function getSceneData(sceneIndex) {
  if (!proFileData || sceneIndex < 0 || sceneIndex >= TOTAL_SCENES) {
    return null;
  }

  const bank = Math.floor(sceneIndex / SCENES_PER_BANK) + 1;
  const sceneInBank = (sceneIndex % SCENES_PER_BANK) + 1;
  const offset = getSceneBlockOffset(sceneIndex);

  const scanners = [];
  // Byte 0 is a count byte; scanner data starts at byte 1
  const dataStart = offset + 1;
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    scanners.push(
      Array.from(
        proFileData.subarray(
          dataStart + s * CHANNELS_PER_SCANNER,
          dataStart + (s + 1) * CHANNELS_PER_SCANNER,
        ),
      ),
    );
  }

  const isEmpty = scanners.every((scanner) =>
    scanner.every((value) => value === 0),
  );

  return { bank, sceneInBank, scanners, isEmpty };
}

function getChannelMapping(scanner, channel) {
  if (!proFileData) return 0;
  return proFileData[
    getSceneChannelOffset(CONFIG_SCENE_INDEX, scanner, channel)
  ];
}

function setChannelMapping(scanner, channel, attributeId) {
  if (!proFileData) return;
  proFileData[getSceneChannelOffset(CONFIG_SCENE_INDEX, scanner, channel)] =
    attributeId;
}

// --- Rendering helpers ---

function renderGrayscaleStyle(value) {
  return `rgb(${value}, ${value}, ${value})`;
}

function renderScannerHeaderCell(s, isSelected, dimmerStyle) {
  return `<td class="scanner-header ${isSelected ? "selected" : ""}" onclick="toggleScanner(${s})">
    ${s + 1}
  </td>
  <td id="dimmer-${s}" style="background: ${renderGrayscaleStyle(dimmerStyle.value)}; width: 15px; padding: 2px;" title="Dimmer: ${dimmerStyle.value}"></td>`;
}

function renderSliderCell(s, ch, value, mapping, stepSize, presetLabel) {
  const activeClass = value > 0 ? "active" : "";
  const percentage = (value / 255) * 100;
  return `<td title="${mapping.label}: ${value}">
    <div class="slider-container">
      <span class="slider-value ${activeClass}" id="val-${s}-${ch}">${value}</span>
      <div style="font-size: 0.6em; color: ${mapping.color}; margin-bottom: 2px;">${mapping.label}</div>${presetLabel}
      <input type="range" class="${activeClass}" 
        min="0" max="255" step="${stepSize}" value="${value}" 
        data-scanner="${s}" data-channel="${ch}"
        style="--value: ${percentage}%"
        oninput="updateChannelValueSlider(${s}, ${ch}, this.value, this)">
    </div>
  </td>`;
}

function renderWheelCell(s, ch, value, mapping) {
  const activeClass = value > 0 ? "active" : "";
  let selectedPreset = 0;
  for (let preset = 1; preset <= 7; preset++) {
    if (getCalibrationValue(s, ch, preset + 1) === value && value !== 0) {
      selectedPreset = preset;
      break;
    }
  }
  let options = `<option value="0" ${selectedPreset === 0 ? "selected" : ""}>Manual</option>`;
  for (let p = 1; p <= 7; p++) {
    options += `<option value="${p}" ${selectedPreset === p ? "selected" : ""}>#${p}</option>`;
  }
  return `<td title="${mapping.label}: ${value}">
    <div class="slider-container">
      <span class="slider-value ${activeClass}" id="val-${s}-${ch}">${value}</span>
      <div style="font-size: 0.6em; color: ${mapping.color}; margin-bottom: 2px;">${mapping.label}</div>
      <select class="preset-dropdown ${activeClass}" 
        data-scanner="${s}" data-channel="${ch}"
        onchange="applyWheelPreset(${s}, ${ch}, this.value)">
        ${options}
      </select>
    </div>
  </td>`;
}

function renderPanTiltPad(s, ptChannels, scanners) {
  if (ptChannels.pan >= 0 && ptChannels.tilt >= 0) {
    const panValue = scanners[s][ptChannels.pan];
    const tiltValue = scanners[s][ptChannels.tilt];
    const panPercent = (panValue / 255) * 100;
    const tiltPercent = 100 - (tiltValue / 255) * 100;
    const posStyle = `left: ${panPercent}%; top: ${tiltPercent}%;`;
    const crosshairs = `<div class="pantilt-crosshair"></div><div class="pantilt-crosshair horizontal"></div>`;
    const dragArgs = `${s}, ${ptChannels.pan}, ${ptChannels.tilt}`;
    return `<td class="pantilt-cell">
      <div class="pantilt-pad" 
        data-scanner="${s}" 
        data-pan-ch="${ptChannels.pan}" 
        data-tilt-ch="${ptChannels.tilt}"
        onmousedown="startPanTiltDrag(event, ${dragArgs})">
        ${crosshairs}
        <div class="pantilt-position" style="${posStyle}"></div>
      </div>
      <div class="pantilt-pad-overlay"
        data-scanner="${s}"
        onmousedown="startPanTiltDrag(event, ${dragArgs})">
        ${crosshairs}
        <div class="pantilt-position" style="${posStyle}"></div>
      </div>
      <div class="pantilt-label">P:${panValue} T:${tiltValue}</div>
    </td>`;
  }
  return `<td class="pantilt-cell" style="color: #666; font-size: 0.7em;">N/A</td>`;
}

// --- Display functions ---

function renderSceneBar(bank, activeScene) {
  let html = '<div class="scene-bar">';
  const bankStart = (bank - 1) * SCENES_PER_BANK;
  for (let s = 1; s <= SCENES_PER_BANK; s++) {
    const sceneIndex = bankStart + (s - 1);
    const isActive = s === activeScene;
    const sceneData = getSceneData(sceneIndex);
    const hasData = sceneData && !sceneData.isEmpty;
    const classes = `scene-bar-item${isActive ? " active" : ""}${hasData ? " has-data" : ""}`;
    html += `<div class="${classes}" onclick="jumpToScene(${sceneIndex})" title="Scene ${s}${hasData ? "" : " (Empty)"}">${s}</div>`;
  }
  html += "</div>";
  return html;
}

// Main display dispatcher — renders normal scenes and calibration scenes (Bank 30, Scenes 2-8).
// Config scene (Bank 30, Scene 1) has a unique layout and is handled separately.
function displayScene() {
  const sceneData = getSceneData(currentSceneIndex);
  if (!sceneData) return;

  // Bank 30, Scene 1: channel configuration (unique layout with attribute dropdowns)
  if (sceneData.bank === 30 && sceneData.sceneInBank === 1) {
    displayConfigScene(sceneData);
    return;
  }

  const isCalibration = sceneData.bank === 30 && sceneData.sceneInBank >= 2;

  // Apply bank color to scene-info header
  sceneInfo.style.background = getBankColor(sceneData.bank);

  // --- Title ---
  if (isCalibration) {
    const calibInfo = CALIBRATION_SCENES[sceneData.sceneInBank];
    sceneTitle.innerHTML = `
      <span style="color: #ff9900;">⚙️ Bank ${sceneData.bank} / Scene ${sceneData.sceneInBank} - ${calibInfo.name}</span>
      <span style="color: #888; font-size: 0.9em; margin-left: 10px;">
          (Scene ${currentSceneIndex + 1} of ${TOTAL_SCENES})
      </span>`;
  } else {
    const emptyIndicator = sceneData.isEmpty
      ? '<span class="empty-indicator">(Empty)</span>'
      : "";
    sceneTitle.innerHTML = `
      <span>Bank ${sceneData.bank} / Scene ${sceneData.sceneInBank} ${emptyIndicator}</span>
      <span style="color: #888; font-size: 0.9em; margin-left: 10px;">
          (Scene ${currentSceneIndex + 1} of ${TOTAL_SCENES})
      </span>`;

    // Auto-populate copy controls
    const copyFromSceneInput = document.getElementById("copyFromScene");
    const copyToSceneInput = document.getElementById("copyToScene");
    const copyFromBankInput = document.getElementById("copyFromBank");
    const copyToBankInput = document.getElementById("copyToBank");

    if (copyToSceneInput) copyToSceneInput.value = currentSceneIndex + 1;
    if (copyToBankInput) copyToBankInput.value = sceneData.bank;
  }

  // --- Scene bar + Calibration banner ---
  let html = renderSceneBar(sceneData.bank, sceneData.sceneInBank);
  if (isCalibration) {
    const calibInfo = CALIBRATION_SCENES[sceneData.sceneInBank];
    html +=
      '<div style="padding: 8px 12px; background: #333; border-radius: 4px; margin-bottom: 10px; color: #ffcc00; font-size: 0.85em;">';
    html += `📐 <strong>Calibration Mode:</strong> ${calibInfo.desc}<br>`;
    if (sceneData.sceneInBank <= 4) {
      html += `💡 <em>You are editing <strong>Preset ${sceneData.sceneInBank - 1}</strong> for Gobo/Color wheels. Set Pan/Tilt calibration values AND gobo/color preset values that can be recalled in any normal scene.</em>`;
    } else {
      html += `💡 <em>You are editing <strong>Preset ${sceneData.sceneInBank - 1}</strong> for Gobo/Color wheels. These values can be instantly recalled in any normal scene via dropdown.</em>`;
    }
    html += "</div>";
  }

  const stepSize = sceneData.bank === 30 ? 1 : 51;
  const presetNumber = isCalibration ? sceneData.sceneInBank - 1 : 0;

  // --- Table header ---
  html += "<table>";
  html +=
    '<tr><th class="scanner-header" onclick="toggleAllScanners()" title="Click to select/deselect all">All</th>';
  html += '<th class="channel-label" style="width: 15px; padding: 2px;"></th>';

  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    const attrId = getChannelMapping(0, ch);
    const attr = CHANNEL_ATTRIBUTES[attrId] || CHANNEL_ATTRIBUTES[0];

    html += `<th class="channel-label" title="${attr.label}">CH ${ch + 1}</th>`;
  }

  html +=
    '<th class="channel-label">Pan/Tilt<br><span style="font-size: 0.65em; color: #9d4eff;">2D Pad</span></th>';
  html += "</tr>";

  // --- Scanner rows ---
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    const isSelected = selectedScanners.has(s);
    const ptChannels = getPanTiltChannels(s);
    const dimmerStyle = getScannerDimmerStyle(s, sceneData);

    html += "<tr>";
    html += renderScannerHeaderCell(s, isSelected, dimmerStyle);

    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      const value = sceneData.scanners[s][ch];
      const mappingId = getChannelMapping(s, ch);
      const mapping = CHANNEL_ATTRIBUTES[mappingId] || CHANNEL_ATTRIBUTES[0];

      let presetLabel = "";
      if (isCalibration) {
        if (
          sceneData.sceneInBank <= 4 &&
          (mapping.name === "PAN" ||
            mapping.name === "PAN_FINE" ||
            mapping.name === "TILT" ||
            mapping.name === "TILT_FINE")
        ) {
          const calibAngle =
            sceneData.sceneInBank === 2
              ? "-90°"
              : sceneData.sceneInBank === 3
                ? "0°"
                : "+90°";
          presetLabel = `<span style="font-size: 0.6em; color: #ffff88;">📍 Calib ${calibAngle}</span>`;
        } else if (
          mapping.name === "GOBO_WHEEL" ||
          mapping.name === "COLOR_WHEEL"
        ) {
          presetLabel = `<span style="font-size: 0.6em; color: #88ffff;">🎨 Preset ${presetNumber}</span>`;
        }
      }

      if (!isCalibration && isWheelChannel(s, ch)) {
        html += renderWheelCell(s, ch, value, mapping);
      } else {
        html += renderSliderCell(s, ch, value, mapping, stepSize, presetLabel);
      }
    }

    html += renderPanTiltPad(s, ptChannels, sceneData.scanners);
    html += "</tr>";
  }

  html += "</table>";
  sceneDisplay.innerHTML = html;
}

// Display configuration scene (Bank 30, Scene 1) with attribute dropdowns
function displayConfigScene(sceneData) {
  sceneInfo.style.background = getBankColor(sceneData.bank);

  sceneTitle.innerHTML = `
    <span style="color: #ff9900;">⚙️ Bank ${sceneData.bank} / Scene ${sceneData.sceneInBank} - CHANNEL CONFIGURATION</span>
    <span style="color: #888; font-size: 0.9em; margin-left: 10px;">
        Define what each channel does for each scanner
    </span>
  `;

  let html =
    '<div style="padding: 8px 12px; background: #333; border-radius: 4px; margin-bottom: 10px; color: #ffcc00; font-size: 0.85em;">';
  html +=
    "⚠️ <strong>Configuration Mode:</strong> This scene stores channel attribute mappings. ";
  html +=
    "Set what each channel controls (Pan, Tilt, Dimmer, Color, etc.). These mappings are used when editing other scenes.</div>";

  html += renderSceneBar(sceneData.bank, sceneData.sceneInBank);

  html += "<table>";

  // Header row - channel numbers
  html +=
    '<tr><th class="scanner-header" onclick="toggleAllScanners()" title="Click to select/deselect all">All</th>';
  html += '<th class="channel-label" style="width: 15px; padding: 2px;"></th>';
  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    html += `<th class="channel-label" style="min-width: 100px;">CH ${ch + 1}</th>`;
  }
  html += "</tr>";

  // Scanner rows with dropdowns
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    const isSelected = selectedScanners.has(s);
    const dimmerStyle = getScannerDimmerStyle(s, sceneData);

    html += "<tr>";
    html += renderScannerHeaderCell(s, isSelected, dimmerStyle);

    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      const attrId = sceneData.scanners[s][ch];
      const attr = CHANNEL_ATTRIBUTES[attrId] || CHANNEL_ATTRIBUTES[0];

      html += `<td><select class="attr-select" data-scanner="${s}" data-channel="${ch}" 
                onchange="updateChannelAttribute(${s}, ${ch}, this.value)" 
                style="background: ${attr.color}; color: ${attrId === 9 ? "#000" : "#fff"}; width: 100%; padding: 5px; border: 1px solid #444; border-radius: 3px; font-size: 0.85em;">`;

      for (let optAttrId in CHANNEL_ATTRIBUTES) {
        const optAttr = CHANNEL_ATTRIBUTES[optAttrId];
        const selected = parseInt(optAttrId) === attrId ? "selected" : "";
        html += `<option value="${optAttrId}" ${selected}>${optAttr.label}</option>`;
      }

      html += `</select></td>`;
    }

    html += "</tr>";
  }

  html += "</table>";
  sceneDisplay.innerHTML = html;
}

// Toggle scanner selection for synchronized control
function toggleScanner(scanner) {
  if (selectedScanners.has(scanner)) {
    selectedScanners.delete(scanner);
  } else {
    selectedScanners.add(scanner);
  }
  displayScene();
}

// Toggle all scanners
function toggleAllScanners() {
  if (selectedScanners.size === SCANNERS_PER_SCENE) {
    selectedScanners.clear();
  } else {
    for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
      selectedScanners.add(s);
    }
  }
  displayScene();
}

// --- Channel value updates ---

// Update channel value from slider (live update without full refresh)
function updateChannelValueSlider(scanner, channel, value, sliderElement) {
  if (!proFileData) return;

  const numValue = parseInt(value);
  if (isNaN(numValue) || numValue < 0 || numValue > 255) return;

  // Update the current scanner
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, channel)] =
    numValue;

  // Update the value display for current scanner
  updateSliderDisplay(scanner, channel, numValue, sliderElement);

  // Check if this is a dimmer channel and update dimmer indicator
  const mappingId = getChannelMapping(scanner, channel);
  const mapping = CHANNEL_ATTRIBUTES[mappingId];
  if (mapping && mapping.name === "DIMMER") {
    updateDimmerIndicator(scanner, numValue);
  }

  // If synchronized mode is active, update all selected scanners
  if (selectedScanners.size > 1 && selectedScanners.has(scanner)) {
    selectedScanners.forEach((s) => {
      if (s !== scanner) {
        proFileData[getSceneChannelOffset(currentSceneIndex, s, channel)] =
          numValue;

        // Update display for synchronized scanners
        const syncSlider = document.querySelector(
          `input[data-scanner="${s}"][data-channel="${channel}"]`,
        );
        if (syncSlider) {
          syncSlider.value = numValue;
          updateSliderDisplay(s, channel, numValue, syncSlider);
        }

        if (mapping && mapping.name === "DIMMER") {
          updateDimmerIndicator(s, numValue);
        }
      }
    });
  }

  updateSceneMetadata(currentSceneIndex);
  clearError();
}

function updateSliderDisplay(scanner, channel, value, sliderElement) {
  const valueDisplay = document.getElementById(`val-${scanner}-${channel}`);
  if (valueDisplay) {
    valueDisplay.textContent = value;
    valueDisplay.className = `slider-value ${value > 0 ? "active" : ""}`;
  }

  const el =
    sliderElement ||
    document.querySelector(
      `input[type="range"][data-scanner="${scanner}"][data-channel="${channel}"]`,
    );
  if (el) {
    el.style.setProperty("--value", `${(value / 255) * 100}%`);
    el.className = value > 0 ? "active" : "";
  }
}

function updateDimmerIndicator(scanner, value) {
  const dimmerCell = document.getElementById(`dimmer-${scanner}`);
  if (dimmerCell) {
    dimmerCell.style.background = renderGrayscaleStyle(value);
    dimmerCell.title = `Dimmer: ${value}`;
  }
}

// Update a channel attribute mapping (for config scene)
function updateChannelAttribute(scanner, channel, attributeId) {
  if (!proFileData) return;

  const attrId = parseInt(attributeId);
  if (isNaN(attrId) || attrId < 0 || attrId > 13) {
    showError("Invalid attribute ID");
    displayScene();
    return;
  }

  setChannelMapping(scanner, channel, attrId);
  clearError();
  displayScene();
}

// --- Copy / Clear / Download ---

function copyScene() {
  if (!proFileData) return;

  const fromScene = parseInt(document.getElementById("copyFromScene").value);
  const toScene = parseInt(document.getElementById("copyToScene").value);

  if (
    !fromScene ||
    !toScene ||
    fromScene < 1 ||
    fromScene > 240 ||
    toScene < 1 ||
    toScene > 240
  ) {
    showError("Please enter valid scene numbers (1-240)");
    return;
  }

  const fromOffset = getSceneBlockOffset(fromScene - 1);
  const toOffset = getSceneBlockOffset(toScene - 1);

  proFileData.set(
    proFileData.subarray(fromOffset, fromOffset + SCENE_RECORD_SIZE),
    toOffset,
  );

  clearError();

  if (currentSceneIndex === toScene - 1) {
    displayScene();
  }
}

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
  if (currentBank === toBank) {
    displayScene();
  }

  showSuccess(`✅ Bank ${fromBank} (8 scenes) copied to Bank ${toBank}`);
}

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
  showSuccess(`✅ Bank ${currentBank} (all 8 scenes) cleared successfully!`);
}

function downloadFile() {
  if (!proFileData) return;

  // Recalculate all scene metadata (count bytes and bitmasks) before saving
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

  showSuccess("✅ File downloaded successfully!");
}

// --- Wheel presets ---

function applyWheelPreset(scanner, channel, presetIndex) {
  if (!proFileData) return;

  const preset = parseInt(presetIndex);
  if (preset === 0) {
    displayScene();
    return;
  }

  const value = getCalibrationValue(scanner, channel, preset + 1);

  if (value === 0) {
    showError(
      `⚠️ Preset ${preset} has no calibration data for Scanner ${scanner + 1} CH${channel + 1}. Set values in Bank 30, Scene ${preset + 1} first.`,
    );
    setTimeout(clearError, 4000);
  }

  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, channel)] =
    value;

  updateSliderDisplay(scanner, channel, value, null);

  const dropdown = document.querySelector(
    `select[data-scanner="${scanner}"][data-channel="${channel}"]`,
  );
  if (dropdown) {
    dropdown.className =
      value > 0 ? "preset-dropdown active" : "preset-dropdown";
  }

  // Sync to selected scanners
  if (selectedScanners.size > 1 && selectedScanners.has(scanner)) {
    selectedScanners.forEach((s) => {
      if (s !== scanner) {
        const syncValue = getCalibrationValue(s, channel, preset + 1);
        proFileData[getSceneChannelOffset(currentSceneIndex, s, channel)] =
          syncValue;
        updateSliderDisplay(s, channel, syncValue, null);

        const syncDropdown = document.querySelector(
          `select[data-scanner="${s}"][data-channel="${channel}"]`,
        );
        if (syncDropdown) {
          syncDropdown.value = preset;
          syncDropdown.className =
            syncValue > 0 ? "preset-dropdown active" : "preset-dropdown";
        }
      }
    });
  }

  updateSceneMetadata(currentSceneIndex);
  clearError();
}

// --- Pan/Tilt 2D pad ---

let panTiltDragging = false;
let currentDragData = null;

function startPanTiltDrag(event, scanner, panChannel, tiltChannel) {
  event.preventDefault();
  panTiltDragging = true;
  currentDragData = {
    scanner,
    panChannel,
    tiltChannel,
    pad: event.currentTarget,
  };

  updatePanTiltFromMouse(event);

  document.addEventListener("mousemove", handlePanTiltDrag);
  document.addEventListener("mouseup", stopPanTiltDrag);
}

function handlePanTiltDrag(event) {
  if (!panTiltDragging || !currentDragData) return;
  updatePanTiltFromMouse(event);
}

function stopPanTiltDrag() {
  panTiltDragging = false;
  currentDragData = null;
  document.removeEventListener("mousemove", handlePanTiltDrag);
  document.removeEventListener("mouseup", stopPanTiltDrag);
}

// Update pan/tilt pad visuals and slider displays for a single scanner
function updateScannerPanTiltDisplay(
  s,
  panChannel,
  tiltChannel,
  panValue,
  tiltValue,
  xPercent,
  yPercent,
) {
  // Update both the small pad and the hover overlay
  const pads = document.querySelectorAll(
    `.pantilt-pad[data-scanner="${s}"], .pantilt-pad-overlay[data-scanner="${s}"]`,
  );
  pads.forEach((pad) => {
    const position = pad.querySelector(".pantilt-position");
    if (position) {
      position.style.left = `${xPercent}%`;
      position.style.top = `${yPercent}%`;
    }
  });

  // Update the label (sibling after the overlay)
  const overlay = document.querySelector(
    `.pantilt-pad-overlay[data-scanner="${s}"]`,
  );
  if (overlay) {
    const label = overlay.nextElementSibling;
    if (label && label.classList.contains("pantilt-label")) {
      label.textContent = `P:${panValue} T:${tiltValue}`;
    }
  }

  updateSliderDisplay(s, panChannel, panValue, null);
  updateSliderDisplay(s, tiltChannel, tiltValue, null);
}

function updatePanTiltFromMouse(event) {
  if (!currentDragData || !proFileData) return;

  const { scanner, panChannel, tiltChannel, pad } = currentDragData;
  const rect = pad.getBoundingClientRect();

  let x = (event.clientX - rect.left) / rect.width;
  let y = (event.clientY - rect.top) / rect.height;
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));

  const panValue = Math.round(x * 255);
  const tiltValue = Math.round((1 - y) * 255);
  const xPercent = x * 100;
  const yPercent = y * 100;

  // Update data for primary scanner
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, panChannel)] =
    panValue;
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, tiltChannel)] =
    tiltValue;

  // Update display for primary scanner
  updateScannerPanTiltDisplay(
    scanner,
    panChannel,
    tiltChannel,
    panValue,
    tiltValue,
    xPercent,
    yPercent,
  );

  // Sync to selected scanners
  if (selectedScanners.size > 1 && selectedScanners.has(scanner)) {
    selectedScanners.forEach((s) => {
      if (s !== scanner) {
        proFileData[getSceneChannelOffset(currentSceneIndex, s, panChannel)] =
          panValue;
        proFileData[getSceneChannelOffset(currentSceneIndex, s, tiltChannel)] =
          tiltValue;
        updateScannerPanTiltDisplay(
          s,
          panChannel,
          tiltChannel,
          panValue,
          tiltValue,
          xPercent,
          yPercent,
        );
      }
    });
  }

  updateSceneMetadata(currentSceneIndex);
  clearError();
}

// --- Error handling ---

function showError(message) {
  errorDiv.innerHTML = `<div class="error">${message}</div>`;
}

function showSuccess(message) {
  showError(message);
  setTimeout(clearError, 3000);
}

function clearError() {
  errorDiv.innerHTML = "";
}
