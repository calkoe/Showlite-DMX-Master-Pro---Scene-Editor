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

// Convert degree (-90 to +90) to DMX value using 3-point calibration
// Scene 2 = -90°, Scene 3 = 0°, Scene 4 = +90°
function degreeToDmx(scanner, channel, degree) {
  const dmxNeg90 = getCalibrationValue(scanner, channel, 2);
  const dmx0 = getCalibrationValue(scanner, channel, 3);
  const dmxPos90 = getCalibrationValue(scanner, channel, 4);

  const deg = Math.max(-90, Math.min(90, degree));

  if (deg <= 0) {
    // Interpolate between -90° and 0°
    const t = (deg + 90) / 90; // 0 at -90°, 1 at 0°
    return Math.round(dmxNeg90 + t * (dmx0 - dmxNeg90));
  } else {
    // Interpolate between 0° and +90°
    const t = deg / 90; // 0 at 0°, 1 at +90°
    return Math.round(dmx0 + t * (dmxPos90 - dmx0));
  }
}

// Convert DMX value back to degree (-90 to +90) using 3-point calibration
function dmxToDegree(scanner, channel, dmxValue) {
  const dmxNeg90 = getCalibrationValue(scanner, channel, 2);
  const dmx0 = getCalibrationValue(scanner, channel, 3);
  const dmxPos90 = getCalibrationValue(scanner, channel, 4);

  // Determine which segment the DMX value falls in
  // Handle both ascending and descending DMX ranges
  const inLowerSegment =
    (dmxNeg90 <= dmx0 && dmxValue <= dmx0) ||
    (dmxNeg90 >= dmx0 && dmxValue >= dmx0);

  if (inLowerSegment) {
    const range = dmx0 - dmxNeg90;
    if (range === 0) return -90;
    const t = (dmxValue - dmxNeg90) / range; // 0 at -90°, 1 at 0°
    return -90 + t * 90;
  } else {
    const range = dmxPos90 - dmx0;
    if (range === 0) return 90;
    const t = (dmxValue - dmx0) / range; // 0 at 0°, 1 at +90°
    return t * 90;
  }
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

function getRGBWChannels(scanner) {
  let red = -1,
    green = -1,
    blue = -1,
    white = -1;

  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    const attrId = getChannelMapping(scanner, ch);
    const attr = CHANNEL_ATTRIBUTES[attrId];
    if (attr) {
      if (attr.name === "RED") red = ch;
      else if (attr.name === "GREEN") green = ch;
      else if (attr.name === "BLUE") blue = ch;
      else if (attr.name === "WHITE") white = ch;
    }
  }

  return { red, green, blue, white };
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
let scannerClipboard = null; // Stores copied scanner channel data
let displayedChannels = 8; // Number of channels to display (default 8, max 16)

// --- DOM elements ---

const fileInput = document.getElementById("fileInput");
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
  let html = `<td class="scanner-header ${isSelected ? "selected" : ""}" onclick="toggleScanner(${s})">
    ${s + 1}
  </td>`;
  html += `<td class="copy-paste-cell">
    <button class="cp-btn" onclick="copyScanner(${s})" title="Copy scanner ${s + 1}">C</button>
    <button class="cp-btn" onclick="pasteScanner(${s})" title="Paste to scanner ${s + 1}">V</button>
  </td>`;
  return html;
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

    // Convert DMX to degrees using calibration
    const panDeg = dmxToDegree(s, ptChannels.pan, panValue);
    const tiltDeg = dmxToDegree(s, ptChannels.tilt, tiltValue);

    // Map degrees (-90..+90) to percent (0..100) for display, clamped to pad bounds
    const panPercent = Math.max(0, Math.min(100, ((panDeg + 90) / 180) * 100));
    const tiltPercent = Math.max(
      0,
      Math.min(100, 100 - ((tiltDeg + 90) / 180) * 100),
    );
    const posStyle = `left: ${panPercent}%; top: ${tiltPercent}%;`;

    // Generate position markers for other scenes in the same bank
    const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK);
    const currentSceneInBank = currentSceneIndex % SCENES_PER_BANK;
    let otherSceneMarkers = "";
    for (let si = 0; si < SCENES_PER_BANK; si++) {
      if (si === currentSceneInBank) continue;
      const otherSceneIndex = currentBank * SCENES_PER_BANK + si;
      const otherPan =
        proFileData[getSceneChannelOffset(otherSceneIndex, s, ptChannels.pan)];
      const otherTilt =
        proFileData[getSceneChannelOffset(otherSceneIndex, s, ptChannels.tilt)];
      if (otherPan === 0 && otherTilt === 0) continue;
      const oPanDeg = dmxToDegree(s, ptChannels.pan, otherPan);
      const oTiltDeg = dmxToDegree(s, ptChannels.tilt, otherTilt);
      const oPanPct = Math.max(0, Math.min(100, ((oPanDeg + 90) / 180) * 100));
      const oTiltPct = Math.max(
        0,
        Math.min(100, 100 - ((oTiltDeg + 90) / 180) * 100),
      );
      otherSceneMarkers += `<span style="position:absolute;left:${oPanPct}%;top:${oTiltPct}%;transform:translate(-50%,-50%);font-size:0.55em;color:#666;pointer-events:none;z-index:1;">${si + 1}</span>`;
    }

    const degreeLabels = `
      <span class="pantilt-deg-label" style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);font-size:0.55em;color:#888;">Pan</span>
      <span class="pantilt-deg-label" style="position:absolute;bottom:-12px;left:0;font-size:0.5em;color:#666;">-90°</span>
      <span class="pantilt-deg-label" style="position:absolute;bottom:-12px;left:50%;transform:translateX(-50%);font-size:0.5em;color:#888;">0°</span>
      <span class="pantilt-deg-label" style="position:absolute;bottom:-12px;right:0;font-size:0.5em;color:#666;">+90°</span>
      <span class="pantilt-deg-label" style="position:absolute;left:-18px;top:50%;transform:translateY(-50%) rotate(-90deg);font-size:0.55em;color:#888;">Tilt</span>
      <span class="pantilt-deg-label" style="position:absolute;right:-16px;top:0;font-size:0.5em;color:#666;">+90°</span>
      <span class="pantilt-deg-label" style="position:absolute;right:-12px;top:50%;transform:translateY(-50%);font-size:0.5em;color:#888;">0°</span>
      <span class="pantilt-deg-label" style="position:absolute;right:-16px;bottom:0;font-size:0.5em;color:#666;">-90°</span>`;

    const crosshairs = `<div class="pantilt-crosshair"></div><div class="pantilt-crosshair horizontal"></div>`;
    const dragArgs = `${s}, ${ptChannels.pan}, ${ptChannels.tilt}`;
    return `<td class="pantilt-cell">
      <div class="pantilt-pad" 
        data-scanner="${s}" 
        data-pan-ch="${ptChannels.pan}" 
        data-tilt-ch="${ptChannels.tilt}"
        onmousedown="startPanTiltDrag(event, ${dragArgs})">
        ${crosshairs}
        ${otherSceneMarkers}
        <div class="pantilt-position" id="pantilt-pos-${s}" style="${posStyle}"></div>
        <div class="pantilt-deg-readout" id="pantilt-deg-${s}" style="position:absolute;bottom:2px;left:2px;font-size:0.5em;color:#4a9eff;pointer-events:none;">P:${panDeg.toFixed(0)}° T:${tiltDeg.toFixed(0)}°</div>
      </div>
      <div class="pantilt-pad-overlay"
        data-scanner="${s}"
        onmousedown="startPanTiltDrag(event, ${dragArgs})">
        ${crosshairs}
        ${degreeLabels}
        ${otherSceneMarkers}
        <div class="pantilt-position" id="pantilt-pos-overlay-${s}" style="${posStyle}"></div>
        <div class="pantilt-deg-readout" id="pantilt-deg-overlay-${s}" style="position:absolute;bottom:4px;left:4px;font-size:0.65em;color:#4ade80;pointer-events:none;">P:${panDeg.toFixed(0)}° T:${tiltDeg.toFixed(0)}°</div>
      </div>
    </td>`;
  }
  return `<td class="pantilt-cell" style="color: #666; font-size: 0.7em;">N/A</td>`;
}

function renderColorPicker(s, rgbwChannels, scanners) {
  if (
    rgbwChannels.red >= 0 &&
    rgbwChannels.green >= 0 &&
    rgbwChannels.blue >= 0
  ) {
    const r = scanners[s][rgbwChannels.red] || 0;
    const g = scanners[s][rgbwChannels.green] || 0;
    const b = scanners[s][rgbwChannels.blue] || 0;
    const w =
      rgbwChannels.white >= 0 ? scanners[s][rgbwChannels.white] || 0 : 0;

    const hexColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

    // Calculate position from RGB values for discrete 16x16 grid
    const { x, y } = rgbToColorPickerPosition(r, g, b);
    const posStyle = `left: ${x * 100}%; top: ${y * 100}%;`;

    const dragArgs = `${s}, ${rgbwChannels.red}, ${rgbwChannels.green}, ${rgbwChannels.blue}, ${rgbwChannels.white}`;

    // Generate 10x10 grid of discrete color blocks
    let gridHtml = "";
    for (let row = 0; row < 10; row++) {
      for (let col = 0; col < 10; col++) {
        const hue = (col / 9) * 360;
        const val = 1 - row / 9;
        const sat = 1;
        const c2 = val * sat;
        const x2 = c2 * (1 - Math.abs(((hue / 60) % 2) - 1));
        const m2 = val - c2;
        let cr, cg, cb;
        if (hue < 60) {
          cr = c2;
          cg = x2;
          cb = 0;
        } else if (hue < 120) {
          cr = x2;
          cg = c2;
          cb = 0;
        } else if (hue < 180) {
          cr = 0;
          cg = c2;
          cb = x2;
        } else if (hue < 240) {
          cr = 0;
          cg = x2;
          cb = c2;
        } else if (hue < 300) {
          cr = x2;
          cg = 0;
          cb = c2;
        } else {
          cr = c2;
          cg = 0;
          cb = x2;
        }
        const br = Math.round((cr + m2) * 255);
        const bg2 = Math.round((cg + m2) * 255);
        const bb = Math.round((cb + m2) * 255);
        gridHtml += `<div class="color-block" style="background:rgb(${br},${bg2},${bb})"></div>`;
      }
    }

    return `<td class="color-picker-cell">
      <div class="color-picker-pad" 
        data-scanner="${s}" 
        data-r-ch="${rgbwChannels.red}" 
        data-g-ch="${rgbwChannels.green}" 
        data-b-ch="${rgbwChannels.blue}"
        data-w-ch="${rgbwChannels.white}"
        onmousedown="startColorPick(event, ${dragArgs})"
        style="background: ${hexColor};">
        <div class="color-preview" style="background: ${hexColor};"></div>
      </div>
      <div class="color-picker-overlay"
        data-scanner="${s}"
        onmousedown="startColorPick(event, ${dragArgs})">
        <div class="color-gradient" id="color-gradient-${s}">${gridHtml}</div>
        <div class="color-position" id="color-position-${s}" style="${posStyle}"></div>
      </div>
    </td>`;
  }
  return `<td class="color-picker-cell" style="color: #666; font-size: 0.7em;">N/A</td>`;
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

  // --- Title ---
  let titleHtml = "";
  if (isCalibration) {
    const calibInfo = CALIBRATION_SCENES[sceneData.sceneInBank];
    titleHtml = `
      <span style="color: #ff9900;">⚙️ Bank ${sceneData.bank} / Scene ${sceneData.sceneInBank} - ${calibInfo.name}</span>
      <span style="color: #888; font-size: 0.9em; margin-left: 10px;">
          (Scene ${currentSceneIndex + 1} of ${TOTAL_SCENES})
      </span>`;
  } else {
    const emptyIndicator = sceneData.isEmpty
      ? '<span class="empty-indicator">(Empty)</span>'
      : "";
    titleHtml = `
      <span>Bank ${sceneData.bank} / Scene ${sceneData.sceneInBank} ${emptyIndicator}</span>
      <span style="color: #888; font-size: 0.9em; margin-left: 10px;">
          (Scene ${currentSceneIndex + 1} of ${TOTAL_SCENES})
      </span>`;

    // Auto-populate copy controls
    const copyFromBankInput = document.getElementById("copyFromBank");
    const copyToBankInput = document.getElementById("copyToBank");

    if (copyToBankInput) copyToBankInput.value = sceneData.bank;
  }

  // --- Scene bar + Calibration banner ---
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 6px 0;"><h2 style="margin:0;font-size:1.1em;">${titleHtml}</h2><span style="color:#888;font-size:0.75em;white-space:nowrap;">← → scenes (1-8) &nbsp;|&nbsp; ↑ ↓ banks</span></div>`;
  html += renderSceneBar(sceneData.bank, sceneData.sceneInBank);
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
    '<tr><th class="scanner-header" onclick="toggleAllScanners()" title="Click to select/deselect all">#</th>';
  html += '<th class="channel-label" style="padding: 2px;"></th>';

  for (let ch = 0; ch < displayedChannels; ch++) {
    const attrId = getChannelMapping(0, ch);
    const attr = CHANNEL_ATTRIBUTES[attrId] || CHANNEL_ATTRIBUTES[0];

    html += `<th class="channel-label" title="${attr.label}">CH ${ch + 1}</th>`;
  }

  html +=
    '<th class="channel-label">Pan/Tilt<br><span style="font-size: 0.65em; color: #9d4eff;">2D Pad</span></th>';
  html +=
    '<th class="channel-label">Color<br><span style="font-size: 0.65em; color: #ff4444;">RGBW</span></th>';
  html +=
    '<th class="channel-label" style="width: 10px; padding: 2px;">💡</th>';
  html += "</tr>";

  // --- Scanner rows ---
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    const isSelected = selectedScanners.has(s);
    const ptChannels = getPanTiltChannels(s);
    const rgbwChannels = getRGBWChannels(s);
    const dimmerStyle = getScannerDimmerStyle(s, sceneData);

    html += "<tr>";
    html += renderScannerHeaderCell(s, isSelected, dimmerStyle);

    for (let ch = 0; ch < displayedChannels; ch++) {
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
    html += renderColorPicker(s, rgbwChannels, sceneData.scanners);
    html += `<td class="dimmer-cell" id="dimmer-${s}" onclick="toggleDimmer(${s})" style="background: ${renderGrayscaleStyle(dimmerStyle.value)};" title="Dimmer: ${dimmerStyle.value} (Click to toggle)"></td>`;
    html += "</tr>";
  }

  html += "</table>";
  sceneDisplay.innerHTML = html;
}

// Display configuration scene (Bank 30, Scene 1) with attribute dropdowns
function displayConfigScene(sceneData) {
  let html = `<div style="display:flex;justify-content:space-between;align-items:center;margin:0 0 6px 0;"><h2 style="margin:0;font-size:1.1em;">
    <span style="color: #ff9900;">⚙️ Bank ${sceneData.bank} / Scene ${sceneData.sceneInBank} - CHANNEL CONFIGURATION</span>
    <span style="color: #888; font-size: 0.9em; margin-left: 10px;">
        Define what each channel does for each scanner
    </span>
  </h2><span style="color:#888;font-size:0.75em;white-space:nowrap;">← → scenes (1-8) &nbsp;|&nbsp; ↑ ↓ banks</span></div>`;

  html += renderSceneBar(sceneData.bank, sceneData.sceneInBank);

  html +=
    '<div style="padding: 8px 12px; background: #333; border-radius: 4px; margin-bottom: 10px; color: #ffcc00; font-size: 0.85em;">';
  html +=
    "⚠️ <strong>Configuration Mode:</strong> This scene stores channel attribute mappings. ";
  html +=
    "Set what each channel controls (Pan, Tilt, Dimmer, Color, etc.). These mappings are used when editing other scenes.</div>";

  html += "<table>";

  // Header row - channel numbers
  html +=
    '<tr><th class="scanner-header" onclick="toggleAllScanners()" title="Click to select/deselect all">All</th>';
  html +=
    '<th class="channel-label" style="width: 30px; padding: 2px;">C/V</th>';
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

  // Update Pan/Tilt pad if this is a pan or tilt channel
  const ptChannels = getPanTiltChannels(scanner);
  if (
    channel === ptChannels.pan ||
    channel === ptChannels.tilt ||
    channel === ptChannels.panFine ||
    channel === ptChannels.tiltFine
  ) {
    const panValue =
      ptChannels.pan >= 0
        ? proFileData[
            getSceneChannelOffset(currentSceneIndex, scanner, ptChannels.pan)
          ]
        : 0;
    const tiltValue =
      ptChannels.tilt >= 0
        ? proFileData[
            getSceneChannelOffset(currentSceneIndex, scanner, ptChannels.tilt)
          ]
        : 0;
    const panDeg = dmxToDegree(scanner, ptChannels.pan, panValue);
    const tiltDeg = dmxToDegree(scanner, ptChannels.tilt, tiltValue);
    const xPercent = ((panDeg + 90) / 180) * 100;
    const yPercent = 100 - ((tiltDeg + 90) / 180) * 100;
    updateScannerPanTiltDisplay(
      scanner,
      ptChannels.pan,
      ptChannels.tilt,
      panValue,
      tiltValue,
      xPercent,
      yPercent,
      panDeg,
      tiltDeg,
    );
  }

  // Update Color picker if this is an RGB channel
  const rgbwChannels = getRGBWChannels(scanner);
  if (
    channel === rgbwChannels.red ||
    channel === rgbwChannels.green ||
    channel === rgbwChannels.blue ||
    channel === rgbwChannels.white
  ) {
    const r =
      rgbwChannels.red >= 0
        ? proFileData[
            getSceneChannelOffset(currentSceneIndex, scanner, rgbwChannels.red)
          ]
        : 0;
    const g =
      rgbwChannels.green >= 0
        ? proFileData[
            getSceneChannelOffset(
              currentSceneIndex,
              scanner,
              rgbwChannels.green,
            )
          ]
        : 0;
    const b =
      rgbwChannels.blue >= 0
        ? proFileData[
            getSceneChannelOffset(currentSceneIndex, scanner, rgbwChannels.blue)
          ]
        : 0;
    const w =
      rgbwChannels.white >= 0
        ? proFileData[
            getSceneChannelOffset(
              currentSceneIndex,
              scanner,
              rgbwChannels.white,
            )
          ]
        : 0;
    updateScannerColorDisplay(
      scanner,
      rgbwChannels.red,
      rgbwChannels.green,
      rgbwChannels.blue,
      rgbwChannels.white,
      r,
      g,
      b,
      w,
    );
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

        // Update Pan/Tilt pad for synced scanner
        const sPtChannels = getPanTiltChannels(s);
        if (
          channel === sPtChannels.pan ||
          channel === sPtChannels.tilt ||
          channel === sPtChannels.panFine ||
          channel === sPtChannels.tiltFine
        ) {
          const sPanValue =
            sPtChannels.pan >= 0
              ? proFileData[
                  getSceneChannelOffset(currentSceneIndex, s, sPtChannels.pan)
                ]
              : 0;
          const sTiltValue =
            sPtChannels.tilt >= 0
              ? proFileData[
                  getSceneChannelOffset(currentSceneIndex, s, sPtChannels.tilt)
                ]
              : 0;
          const sPanDeg = dmxToDegree(s, sPtChannels.pan, sPanValue);
          const sTiltDeg = dmxToDegree(s, sPtChannels.tilt, sTiltValue);
          const sXPercent = ((sPanDeg + 90) / 180) * 100;
          const sYPercent = 100 - ((sTiltDeg + 90) / 180) * 100;
          updateScannerPanTiltDisplay(
            s,
            sPtChannels.pan,
            sPtChannels.tilt,
            sPanValue,
            sTiltValue,
            sXPercent,
            sYPercent,
            sPanDeg,
            sTiltDeg,
          );
        }

        // Update Color picker for synced scanner
        const sRgbwChannels = getRGBWChannels(s);
        if (
          channel === sRgbwChannels.red ||
          channel === sRgbwChannels.green ||
          channel === sRgbwChannels.blue ||
          channel === sRgbwChannels.white
        ) {
          const sR =
            sRgbwChannels.red >= 0
              ? proFileData[
                  getSceneChannelOffset(currentSceneIndex, s, sRgbwChannels.red)
                ]
              : 0;
          const sG =
            sRgbwChannels.green >= 0
              ? proFileData[
                  getSceneChannelOffset(
                    currentSceneIndex,
                    s,
                    sRgbwChannels.green,
                  )
                ]
              : 0;
          const sB =
            sRgbwChannels.blue >= 0
              ? proFileData[
                  getSceneChannelOffset(
                    currentSceneIndex,
                    s,
                    sRgbwChannels.blue,
                  )
                ]
              : 0;
          const sW =
            sRgbwChannels.white >= 0
              ? proFileData[
                  getSceneChannelOffset(
                    currentSceneIndex,
                    s,
                    sRgbwChannels.white,
                  )
                ]
              : 0;
          updateScannerColorDisplay(
            s,
            sRgbwChannels.red,
            sRgbwChannels.green,
            sRgbwChannels.blue,
            sRgbwChannels.white,
            sR,
            sG,
            sB,
            sW,
          );
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
    el.value = value;
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
  panDeg,
  tiltDeg,
) {
  // Update position indicators by ID
  const posSmall = document.getElementById(`pantilt-pos-${s}`);
  if (posSmall) {
    posSmall.style.left = `${xPercent}%`;
    posSmall.style.top = `${yPercent}%`;
  }

  const posOverlay = document.getElementById(`pantilt-pos-overlay-${s}`);
  if (posOverlay) {
    posOverlay.style.left = `${xPercent}%`;
    posOverlay.style.top = `${yPercent}%`;
  }

  // Update degree readouts
  if (panDeg !== undefined && tiltDeg !== undefined) {
    const degSmall = document.getElementById(`pantilt-deg-${s}`);
    if (degSmall)
      degSmall.textContent = `P:${Math.round(panDeg)}° T:${Math.round(tiltDeg)}°`;
    const degOverlay = document.getElementById(`pantilt-deg-overlay-${s}`);
    if (degOverlay)
      degOverlay.textContent = `P:${Math.round(panDeg)}° T:${Math.round(tiltDeg)}°`;
  }

  // Update the label
  const label = document.getElementById(`pantilt-label-${s}`);
  if (label) {
    label.textContent = `P:${panValue} T:${tiltValue}`;
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

  // Convert mouse position to degrees: x: 0=left=-90°, 1=right=+90°; y: 0=top=+90°, 1=bottom=-90°
  const panDeg = -90 + x * 180;
  const tiltDeg = 90 - y * 180;

  // Convert degrees to DMX using 3-point calibration
  const panValue = degreeToDmx(scanner, panChannel, panDeg);
  const tiltValue = degreeToDmx(scanner, tiltChannel, tiltDeg);

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
    panDeg,
    tiltDeg,
  );

  // Sync to selected scanners
  if (selectedScanners.size > 1 && selectedScanners.has(scanner)) {
    selectedScanners.forEach((s) => {
      if (s !== scanner) {
        // Each scanner may have different calibration, so convert degrees to DMX per scanner
        const sPanValue = degreeToDmx(s, panChannel, panDeg);
        const sTiltValue = degreeToDmx(s, tiltChannel, tiltDeg);
        proFileData[getSceneChannelOffset(currentSceneIndex, s, panChannel)] =
          sPanValue;
        proFileData[getSceneChannelOffset(currentSceneIndex, s, tiltChannel)] =
          sTiltValue;
        updateScannerPanTiltDisplay(
          s,
          panChannel,
          tiltChannel,
          sPanValue,
          sTiltValue,
          xPercent,
          yPercent,
          panDeg,
          tiltDeg,
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

// --- Copy/Paste functions ---

function copyScanner(scanner) {
  if (!proFileData) return;

  const sceneData = getSceneData(currentSceneIndex);
  if (!sceneData) return;

  scannerClipboard = [...sceneData.scanners[scanner]];
}

function pasteScanner(scanner) {
  if (!proFileData) return;
  if (!scannerClipboard) {
    showError("⚠️ Clipboard is empty. Copy a scanner first.");
    setTimeout(clearError, 2000);
    return;
  }

  // Paste all 16 channels from clipboard
  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    proFileData[getSceneChannelOffset(currentSceneIndex, scanner, ch)] =
      scannerClipboard[ch];
  }

  updateSceneMetadata(currentSceneIndex);
  displayScene();
}

// --- Color picker functions ---

let colorPickerDragging = false;
let currentColorData = null;

function startColorPick(
  event,
  scanner,
  rChannel,
  gChannel,
  bChannel,
  wChannel,
) {
  event.preventDefault();
  colorPickerDragging = true;
  currentColorData = {
    scanner,
    rChannel,
    gChannel,
    bChannel,
    wChannel,
    pad: event.currentTarget,
  };

  updateColorFromMouse(event);

  document.addEventListener("mousemove", handleColorDrag);
  document.addEventListener("mouseup", stopColorDrag);
}

function handleColorDrag(event) {
  if (!colorPickerDragging || !currentColorData) return;
  updateColorFromMouse(event);
}

function stopColorDrag() {
  colorPickerDragging = false;
  currentColorData = null;
  document.removeEventListener("mousemove", handleColorDrag);
  document.removeEventListener("mouseup", stopColorDrag);
}

function rgbToColorPickerPosition(r, g, b) {
  // Convert RGB to HSV
  const r1 = r / 255;
  const g1 = g / 255;
  const b1 = b / 255;

  const max = Math.max(r1, g1, b1);
  const min = Math.min(r1, g1, b1);
  const delta = max - min;

  let hue = 0;
  if (delta !== 0) {
    if (max === r1) hue = ((g1 - b1) / delta) % 6;
    else if (max === g1) hue = (b1 - r1) / delta + 2;
    else hue = (r1 - g1) / delta + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  const value = max;

  // Snap to the same 10x10 grid used for display and input
  const gridSize = 10;
  const xIndex = Math.round((hue / 360) * (gridSize - 1));
  const yIndex = Math.round((1 - value) * (gridSize - 1));

  return {
    x: xIndex / (gridSize - 1),
    y: yIndex / (gridSize - 1),
  };
}

function updateScannerColorDisplay(
  s,
  rChannel,
  gChannel,
  bChannel,
  wChannel,
  r,
  g,
  b,
  w,
) {
  const hexColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;

  // Update the color picker pad background
  const pad = document.querySelector(`.color-picker-pad[data-scanner="${s}"]`);
  if (pad) {
    pad.style.background = hexColor;
    const preview = pad.querySelector(".color-preview");
    if (preview) preview.style.background = hexColor;
  }

  // Update position indicator
  const { x, y } = rgbToColorPickerPosition(r, g, b);
  const posIndicator = document.getElementById(`color-position-${s}`);
  if (posIndicator) {
    posIndicator.style.left = `${x * 100}%`;
    posIndicator.style.top = `${y * 100}%`;
  }

  // Update the label
  const label = document.getElementById(`color-label-${s}`);
  if (label) {
    label.textContent = `R:${r} G:${g} B:${b}${wChannel >= 0 ? " W:" + w : ""}`;
  }

  updateSliderDisplay(s, rChannel, r, null);
  updateSliderDisplay(s, gChannel, g, null);
  updateSliderDisplay(s, bChannel, b, null);
  if (wChannel >= 0) {
    updateSliderDisplay(s, wChannel, w, null);
  }
}

function updateColorFromMouse(event) {
  if (!currentColorData || !proFileData) return;

  const { scanner, rChannel, gChannel, bChannel, wChannel, pad } =
    currentColorData;
  const rect = pad.getBoundingClientRect();

  let x = (event.clientX - rect.left) / rect.width;
  let y = (event.clientY - rect.top) / rect.height;
  x = Math.max(0, Math.min(1, x));
  y = Math.max(0, Math.min(1, y));

  // Snap to 10x10 grid (100 colors)
  const gridSize = 10;
  const xIndex = Math.round(x * (gridSize - 1));
  const yIndex = Math.round(y * (gridSize - 1));
  x = xIndex / (gridSize - 1);
  y = yIndex / (gridSize - 1);

  // Use HSV color space for better color picking
  // x = hue (0-360), y = value/brightness (0-1), saturation = 1
  const hue = x * 360;
  const value = 1 - y;
  const saturation = 1;

  // Convert HSV to RGB
  const c = value * saturation;
  const x1 = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = value - c;

  let r1, g1, b1;
  if (hue < 60) {
    r1 = c;
    g1 = x1;
    b1 = 0;
  } else if (hue < 120) {
    r1 = x1;
    g1 = c;
    b1 = 0;
  } else if (hue < 180) {
    r1 = 0;
    g1 = c;
    b1 = x1;
  } else if (hue < 240) {
    r1 = 0;
    g1 = x1;
    b1 = c;
  } else if (hue < 300) {
    r1 = x1;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x1;
  }

  const r = Math.round((r1 + m) * 255);
  const g = Math.round((g1 + m) * 255);
  const b = Math.round((b1 + m) * 255);
  const w =
    wChannel >= 0
      ? proFileData[getSceneChannelOffset(currentSceneIndex, scanner, wChannel)]
      : 0;

  // Update data for primary scanner
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, rChannel)] = r;
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, gChannel)] = g;
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, bChannel)] = b;

  // Update display for primary scanner
  updateScannerColorDisplay(
    scanner,
    rChannel,
    gChannel,
    bChannel,
    wChannel,
    r,
    g,
    b,
    w,
  );

  // Sync to selected scanners
  if (selectedScanners.size > 1 && selectedScanners.has(scanner)) {
    selectedScanners.forEach((s) => {
      if (s !== scanner) {
        const sRGBW = getRGBWChannels(s);
        if (sRGBW.red >= 0 && sRGBW.green >= 0 && sRGBW.blue >= 0) {
          proFileData[getSceneChannelOffset(currentSceneIndex, s, sRGBW.red)] =
            r;
          proFileData[
            getSceneChannelOffset(currentSceneIndex, s, sRGBW.green)
          ] = g;
          proFileData[getSceneChannelOffset(currentSceneIndex, s, sRGBW.blue)] =
            b;
          const sW =
            sRGBW.white >= 0
              ? proFileData[
                  getSceneChannelOffset(currentSceneIndex, s, sRGBW.white)
                ]
              : 0;
          updateScannerColorDisplay(
            s,
            sRGBW.red,
            sRGBW.green,
            sRGBW.blue,
            sRGBW.white,
            r,
            g,
            b,
            sW,
          );
        }
      }
    });
  }

  updateSceneMetadata(currentSceneIndex);
  clearError();
}

// --- Channel display setting ---

function updateChannelDisplay(count) {
  const num = parseInt(count);
  if (isNaN(num) || num < 1 || num > 16) {
    showError("Channel count must be between 1 and 16");
    setTimeout(clearError, 2000);
    return;
  }
  displayedChannels = num;
  displayScene();
}

// --- Dimmer toggle ---

function toggleDimmer(scanner) {
  if (!proFileData) return;

  const dimmerCh = getDimmerChannel(scanner);
  if (dimmerCh < 0) {
    showError(`⚠️ Scanner ${scanner + 1} has no dimmer channel configured`);
    setTimeout(clearError, 2000);
    return;
  }

  const currentValue =
    proFileData[getSceneChannelOffset(currentSceneIndex, scanner, dimmerCh)];
  const newValue = currentValue > 0 ? 0 : 255;

  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, dimmerCh)] =
    newValue;

  // Update display
  updateSliderDisplay(scanner, dimmerCh, newValue, null);
  updateDimmerIndicator(scanner, newValue);

  updateSceneMetadata(currentSceneIndex);
  clearError();
}
