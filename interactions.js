// Drag state
let panTiltDragging = false;
let currentDragData = null;
let colorPickerDragging = false;
let currentColorData = null;

// --- Display update helpers ---

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

  if (panDeg !== undefined && tiltDeg !== undefined) {
    const degSmall = document.getElementById(`pantilt-deg-${s}`);
    if (degSmall)
      degSmall.textContent = `P:${Math.round(panDeg)}° T:${Math.round(tiltDeg)}°`;
    const degOverlay = document.getElementById(`pantilt-deg-overlay-${s}`);
    if (degOverlay)
      degOverlay.textContent = `P:${Math.round(panDeg)}° T:${Math.round(tiltDeg)}°`;
  }

  const label = document.getElementById(`pantilt-label-${s}`);
  if (label) label.textContent = `P:${panValue} T:${tiltValue}`;

  updateSliderDisplay(s, panChannel, panValue, null);
  updateSliderDisplay(s, tiltChannel, tiltValue, null);
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

  const pad = document.querySelector(`.color-picker-pad[data-scanner="${s}"]`);
  if (pad) {
    pad.style.background = hexColor;
    const preview = pad.querySelector(".color-preview");
    if (preview) preview.style.background = hexColor;
  }

  const { x, y } = rgbToColorPickerPosition(r, g, b);
  const posIndicator = document.getElementById(`color-position-${s}`);
  if (posIndicator) {
    posIndicator.style.left = `${x * 100}%`;
    posIndicator.style.top = `${y * 100}%`;
  }

  const label = document.getElementById(`color-label-${s}`);
  if (label)
    label.textContent = `R:${r} G:${g} B:${b}${wChannel >= 0 ? " W:" + w : ""}`;

  updateSliderDisplay(s, rChannel, r, null);
  updateSliderDisplay(s, gChannel, g, null);
  updateSliderDisplay(s, bChannel, b, null);
  if (wChannel >= 0) updateSliderDisplay(s, wChannel, w, null);
}

// --- Refresh helpers (reduce sync duplication) ---

function refreshPanTiltDisplay(scanner) {
  const ptChannels = getPanTiltChannels(scanner);
  if (ptChannels.pan < 0 || ptChannels.tilt < 0) return;

  const panValue =
    proFileData[
      getSceneChannelOffset(currentSceneIndex, scanner, ptChannels.pan)
    ];
  const tiltValue =
    proFileData[
      getSceneChannelOffset(currentSceneIndex, scanner, ptChannels.tilt)
    ];
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

function refreshColorDisplay(scanner) {
  const rgbwChannels = getRGBWChannels(scanner);
  if (rgbwChannels.red < 0 || rgbwChannels.green < 0 || rgbwChannels.blue < 0)
    return;

  const r =
    proFileData[
      getSceneChannelOffset(currentSceneIndex, scanner, rgbwChannels.red)
    ];
  const g =
    proFileData[
      getSceneChannelOffset(currentSceneIndex, scanner, rgbwChannels.green)
    ];
  const b =
    proFileData[
      getSceneChannelOffset(currentSceneIndex, scanner, rgbwChannels.blue)
    ];
  const w =
    rgbwChannels.white >= 0
      ? proFileData[
          getSceneChannelOffset(currentSceneIndex, scanner, rgbwChannels.white)
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

// Sync a channel value change to all selected scanners (except source)
function syncToSelectedScanners(sourceScanner, channel, value) {
  if (selectedScanners.size <= 1 || !selectedScanners.has(sourceScanner))
    return;

  const mappingId = getChannelMapping(sourceScanner, channel);
  const mapping = CHANNEL_ATTRIBUTES[mappingId];

  selectedScanners.forEach((s) => {
    if (s === sourceScanner) return;

    proFileData[getSceneChannelOffset(currentSceneIndex, s, channel)] = value;

    const syncSlider = document.querySelector(
      `input[data-scanner="${s}"][data-channel="${channel}"]`,
    );
    updateSliderDisplay(s, channel, value, syncSlider || null);

    if (mapping && mapping.name === "DIMMER") {
      updateDimmerIndicator(s, value);
    }

    const ptChannels = getPanTiltChannels(s);
    if (
      channel === ptChannels.pan ||
      channel === ptChannels.tilt ||
      channel === ptChannels.panFine ||
      channel === ptChannels.tiltFine
    ) {
      refreshPanTiltDisplay(s);
    }

    const rgbwChannels = getRGBWChannels(s);
    if (
      channel === rgbwChannels.red ||
      channel === rgbwChannels.green ||
      channel === rgbwChannels.blue ||
      channel === rgbwChannels.white
    ) {
      refreshColorDisplay(s);
    }
  });
}

// --- Channel value updates ---

function updateChannelValueSlider(scanner, channel, value, sliderElement) {
  if (!proFileData) return;

  const numValue = parseInt(value);
  if (isNaN(numValue) || numValue < 0 || numValue > 255) return;

  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, channel)] =
    numValue;
  updateSliderDisplay(scanner, channel, numValue, sliderElement);

  const mappingId = getChannelMapping(scanner, channel);
  const mapping = CHANNEL_ATTRIBUTES[mappingId];
  if (mapping && mapping.name === "DIMMER") {
    updateDimmerIndicator(scanner, numValue);
  }

  // Refresh composite controls for the primary scanner
  const ptChannels = getPanTiltChannels(scanner);
  if (
    channel === ptChannels.pan ||
    channel === ptChannels.tilt ||
    channel === ptChannels.panFine ||
    channel === ptChannels.tiltFine
  ) {
    refreshPanTiltDisplay(scanner);
  }

  const rgbwChannels = getRGBWChannels(scanner);
  if (
    channel === rgbwChannels.red ||
    channel === rgbwChannels.green ||
    channel === rgbwChannels.blue ||
    channel === rgbwChannels.white
  ) {
    refreshColorDisplay(scanner);
  }

  syncToSelectedScanners(scanner, channel, numValue);
  updateSceneMetadata(currentSceneIndex);
  clearError();
}

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

// --- Pan/Tilt 2D pad ---

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

function updatePanTiltFromMouse(event) {
  if (!currentDragData || !proFileData) return;

  const { scanner, panChannel, tiltChannel, pad } = currentDragData;
  const rect = pad.getBoundingClientRect();

  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

  const panDeg = -90 + x * 180;
  const tiltDeg = 90 - y * 180;
  const panValue = degreeToDmx(scanner, panChannel, panDeg);
  const tiltValue = degreeToDmx(scanner, tiltChannel, tiltDeg);
  const xPercent = x * 100;
  const yPercent = y * 100;

  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, panChannel)] =
    panValue;
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, tiltChannel)] =
    tiltValue;
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

  // Sync to selected scanners (per-scanner calibration)
  if (selectedScanners.size > 1 && selectedScanners.has(scanner)) {
    selectedScanners.forEach((s) => {
      if (s !== scanner) {
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

// --- Color picker ---

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

function updateColorFromMouse(event) {
  if (!currentColorData || !proFileData) return;

  const { scanner, rChannel, gChannel, bChannel, wChannel, pad } =
    currentColorData;
  const rect = pad.getBoundingClientRect();

  let x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  let y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

  // Snap to 10x10 grid
  const gridSize = 10;
  x = Math.round(x * (gridSize - 1)) / (gridSize - 1);
  y = Math.round(y * (gridSize - 1)) / (gridSize - 1);

  const { r, g, b } = hsvToRgb(x * 360, 1, 1 - y);
  const w =
    wChannel >= 0
      ? proFileData[getSceneChannelOffset(currentSceneIndex, scanner, wChannel)]
      : 0;

  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, rChannel)] = r;
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, gChannel)] = g;
  proFileData[getSceneChannelOffset(currentSceneIndex, scanner, bChannel)] = b;

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

// --- Toggle functions ---

function toggleScanner(scanner) {
  if (selectedScanners.has(scanner)) {
    selectedScanners.delete(scanner);
  } else {
    selectedScanners.add(scanner);
  }
  displayScene();
}

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
  updateSliderDisplay(scanner, dimmerCh, newValue, null);
  updateDimmerIndicator(scanner, newValue);

  updateSceneMetadata(currentSceneIndex);
  clearError();
}
