// HTML rendering helpers

function renderGrayscaleStyle(value) {
  return `rgb(${value}, ${value}, ${value})`;
}

function renderScannerHeaderCell(s, isSelected, dimmerStyle) {
  const dmxAddr = s * CHANNELS_PER_SCANNER + 1;
  let html = `<td class="scanner-header ${isSelected ? "selected" : ""}" onclick="toggleScanner(${s})">
    ${s + 1}<br><span style="font-size:0.65em;font-weight:normal;color:#888;">Addr <br> ${dmxAddr}</span>
  </td>`;
  html += `<td class="copy-paste-cell">
    <button class="cp-btn" ondblclick="copyScanner(${s})" title="Double-click to copy scanner ${s + 1}">C</button>
    <button class="cp-btn" ondblclick="pasteScanner(${s})" title="Double-click to paste to scanner ${s + 1}">V</button>
    <button class="cp-btn cp-btn-fwd" ondblclick="fillForwardScanner(${s})" title="Double-click to copy scanner ${s + 1} to all following scenes in this bank">→</button>
  </td>`;
  return html;
}

function renderSliderCell(s, ch, value, mapping, presetLabel) {
  const activeClass = value > 0 ? "active" : "";
  const ratio = value / 255;
  return `<td title="${mapping.label}: ${value}" ondblclick="toggleChannel(${s}, ${ch})">
    <div class="slider-container">
      <span class="slider-value ${activeClass}" id="val-${s}-${ch}">${value}</span>
      <div style="font-size: 0.6em; color: ${mapping.color}; margin-bottom: 2px;">${mapping.label}</div>${presetLabel}
      <input type="range" class="${activeClass}" 
        min="0" max="255" value="${value}" 
        data-scanner="${s}" data-channel="${ch}"
        style="--value: ${ratio}"
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
  let options = `<option value="0" ${selectedPreset === 0 ? "selected" : ""}>Default</option>`;
  for (let p = 1; p <= 7; p++) {
    options += `<option value="${p}" ${selectedPreset === p ? "selected" : ""}>#${p}</option>`;
  }
  return `<td title="${mapping.label}: ${value}" ondblclick="toggleChannel(${s}, ${ch})">
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

function renderWledFxCell(s, ch, value, mapping) {
  const activeClass = value > 0 ? "active" : "";
  let options = "";
  const sortedIds = Object.keys(WLED_EFFECTS)
    .map(Number)
    .sort((a, b) => a - b);
  for (const id of sortedIds) {
    const selected = id === value ? "selected" : "";
    options += `<option value="${id}" ${selected}>${id} - ${WLED_EFFECTS[id]}</option>`;
  }
  return `<td title="${mapping.label}: ${value}" ondblclick="toggleChannel(${s}, ${ch})">
    <div class="slider-container">
      <span class="slider-value ${activeClass}" id="val-${s}-${ch}">${value}</span>
      <div style="font-size: 0.6em; color: ${mapping.color}; margin-bottom: 2px;">${mapping.label}</div>
      <select class="wled-fx-dropdown ${activeClass}"
        data-scanner="${s}" data-channel="${ch}"
        onchange="updateChannelValueSlider(${s}, ${ch}, parseInt(this.value), this)">
        ${options}
      </select>
    </div>
  </td>`;
}

function renderPanTiltPad(s, ptChannels, scanners) {
  if (ptChannels.pan < 0 || ptChannels.tilt < 0) {
    return `<td class="pantilt-cell" style="color: #666; font-size: 0.7em;">N/A</td>`;
  }

  const panValue = scanners[s][ptChannels.pan];
  const tiltValue = scanners[s][ptChannels.tilt];

  const panDeg = dmxToDegree(s, ptChannels.pan, panValue);
  const tiltDeg = dmxToDegree(s, ptChannels.tilt, tiltValue);

  const panPercent = Math.max(0, Math.min(100, ((panDeg + 90) / 180) * 100));
  const tiltPercent = Math.max(
    0,
    Math.min(100, 100 - ((tiltDeg + 90) / 180) * 100),
  );
  const posStyle = `left: ${panPercent}%; top: ${tiltPercent}%;`;

  // Position markers for other scenes in the same bank
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

function renderColorPicker(s, rgbwChannels, scanners) {
  if (rgbwChannels.red < 0 || rgbwChannels.green < 0 || rgbwChannels.blue < 0) {
    return `<td class="color-picker-cell" style="color: #666; font-size: 0.7em;">N/A</td>`;
  }

  const r = scanners[s][rgbwChannels.red] || 0;
  const g = scanners[s][rgbwChannels.green] || 0;
  const b = scanners[s][rgbwChannels.blue] || 0;

  const hexColor = `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  const { x, y } = rgbToColorPickerPosition(r, g, b);
  const posStyle = `left: ${x * 100}%; top: ${y * 100}%;`;

  const dragArgs = `${s}, ${rgbwChannels.red}, ${rgbwChannels.green}, ${rgbwChannels.blue}, ${rgbwChannels.white}`;

  // Generate 10x10 HSV color grid (using shared hsvToRgb)
  let gridHtml = "";
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 10; col++) {
      const hue = (col / 9) * 360;
      const val = 1 - row / 9;
      const { r: br, g: bg2, b: bb } = hsvToRgb(hue, 1, val);
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

// Scene bar navigation
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

// Main display dispatcher
function displayScene() {
  const sceneData = getSceneData(currentSceneIndex);
  if (!sceneData) return;

  // Bank 30, Scene 1: channel configuration (unique layout)
  if (sceneData.bank === 30 && sceneData.sceneInBank === 1) {
    displayConfigScene(sceneData);
    return;
  }

  const isCalibration = sceneData.bank === 30 && sceneData.sceneInBank >= 2;

  // Title
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

    const copyToBankInput = document.getElementById("copyToBank");
    if (copyToBankInput) copyToBankInput.value = sceneData.bank;
  }

  // Scene bar + header
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

  // Table header
  html += "<table>";
  html +=
    '<tr><th class="scanner-header" onclick="toggleAllScanners()" title="Click to select/deselect all">#</th>';
  html += '<th class="channel-label" style="padding: 2px;"></th>';

  for (let ch = 0; ch < displayedChannels; ch++) {
    const attrId = getChannelMapping(0, ch);
    const attr = CHANNEL_ATTRIBUTES[attrId] || CHANNEL_ATTRIBUTES[0];
    html += `<th class="channel-label" title="${attr.label}">CH ${ch + 1}</th>`;
  }

  html += '<th class="channel-label">Pan/Tilt</th>';
  html += '<th class="channel-label">Color</th>';
  html +=
    '<th class="channel-label" style="width: 10px; padding: 2px;">💡</th>';
  html += "</tr>";

  // Scanner rows
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    const isSelected = selectedScanners.has(s);
    const ptChannels = getPanTiltChannels(s);
    const rgbwChannels = getRGBWChannels(s);
    const dimmerStyle = getScannerDimmerStyle(s, sceneData);
    const isCalibScene = isCalibration;
    const presetNumber = isCalibScene ? sceneData.sceneInBank - 1 : 0;

    html += `<tr id="scanner-row-${s}">`;
    html += renderScannerHeaderCell(s, isSelected, dimmerStyle);

    for (let ch = 0; ch < displayedChannels; ch++) {
      const value = sceneData.scanners[s][ch];
      const mappingId = getChannelMapping(s, ch);
      const mapping = CHANNEL_ATTRIBUTES[mappingId] || CHANNEL_ATTRIBUTES[0];

      let presetLabel = "";
      if (isCalibScene) {
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

      if (!isCalibScene && isWheelChannel(s, ch)) {
        html += renderWheelCell(s, ch, value, mapping);
      } else if (!isCalibScene && mapping.name === "WLED_FX_ID") {
        html += renderWledFxCell(s, ch, value, mapping);
      } else {
        html += renderSliderCell(s, ch, value, mapping, presetLabel);
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

// Display configuration scene (Bank 30, Scene 1)
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
  html +=
    '<tr><th class="scanner-header" onclick="toggleAllScanners()" title="Click to select/deselect all">All</th>';
  html +=
    '<th class="channel-label" style="width: 30px; padding: 2px;">C/V</th>';
  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    html += `<th class="channel-label" style="min-width: 100px;">CH ${ch + 1}</th>`;
  }
  html += "</tr>";

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
