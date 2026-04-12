// Binary offset helpers

function getBankPadding(bank) {
  let padding = 0;
  for (const segment of BANK_PADDING_SEGMENTS) {
    if (bank >= segment.fromBank) {
      padding += segment.bytes;
    }
  }
  return padding;
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

// Recalculate byte 0 (count of non-zero channel bytes) and metadata bitmasks for a scene
function updateSceneMetadata(sceneIndex) {
  const blockOffset = getSceneBlockOffset(sceneIndex);

  let count = 0;
  for (let i = 1; i <= SCANNER_BYTES_PER_SCENE; i++) {
    if (proFileData[blockOffset + i] !== 0) count++;
  }
  proFileData[blockOffset] = count;

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

// Data access

function getSceneData(sceneIndex) {
  if (!proFileData || sceneIndex < 0 || sceneIndex >= TOTAL_SCENES) {
    return null;
  }

  const bank = Math.floor(sceneIndex / SCENES_PER_BANK) + 1;
  const sceneInBank = (sceneIndex % SCENES_PER_BANK) + 1;
  const offset = getSceneBlockOffset(sceneIndex);

  const scanners = [];
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

// Calibration helpers

function getCalibrationValue(scanner, channel, presetScene) {
  if (!proFileData || presetScene < 2 || presetScene > 8) return 0;
  const calibSceneIndex = CONFIG_SCENE_INDEX + (presetScene - 1);
  return proFileData[getSceneChannelOffset(calibSceneIndex, scanner, channel)];
}

// Convert degree (-90 to +90) to DMX value using 3-point calibration
function degreeToDmx(scanner, channel, degree) {
  const dmxNeg90 = getCalibrationValue(scanner, channel, 2);
  const dmx0 = getCalibrationValue(scanner, channel, 3);
  const dmxPos90 = getCalibrationValue(scanner, channel, 4);

  const deg = Math.max(-90, Math.min(90, degree));

  if (deg <= 0) {
    const t = (deg + 90) / 90;
    return Math.round(dmxNeg90 + t * (dmx0 - dmxNeg90));
  } else {
    const t = deg / 90;
    return Math.round(dmx0 + t * (dmxPos90 - dmx0));
  }
}

// Convert DMX value back to degree (-90 to +90) using 3-point calibration
function dmxToDegree(scanner, channel, dmxValue) {
  const dmxNeg90 = getCalibrationValue(scanner, channel, 2);
  const dmx0 = getCalibrationValue(scanner, channel, 3);
  const dmxPos90 = getCalibrationValue(scanner, channel, 4);

  const inLowerSegment =
    (dmxNeg90 <= dmx0 && dmxValue <= dmx0) ||
    (dmxNeg90 >= dmx0 && dmxValue >= dmx0);

  if (inLowerSegment) {
    const range = dmx0 - dmxNeg90;
    if (range === 0) return -90;
    const t = (dmxValue - dmxNeg90) / range;
    return -90 + t * 90;
  } else {
    const range = dmxPos90 - dmx0;
    if (range === 0) return 90;
    const t = (dmxValue - dmx0) / range;
    return t * 90;
  }
}

// Channel query helpers

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

function getDimmerChannel(scanner) {
  for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
    const attrId = getChannelMapping(scanner, ch);
    const attr = CHANNEL_ATTRIBUTES[attrId];
    if (attr && attr.name === "DIMMER") return ch;
  }
  return -1;
}

function isWheelChannel(scanner, channel) {
  const attrId = getChannelMapping(scanner, channel);
  const attr = CHANNEL_ATTRIBUTES[attrId];
  return attr && (attr.name === "GOBO_WHEEL" || attr.name === "COLOR_WHEEL");
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
