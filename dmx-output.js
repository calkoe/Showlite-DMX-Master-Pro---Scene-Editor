// DMX Output via Web Serial API
// Supports: Raw USB-RS485 adapters and ENTTEC DMX USB Pro
// DMX512 spec: 250kbaud, 8N2, ~44 Hz max for full 512-ch universe; default 40 Hz

const DMX_UNIVERSE_SIZE = 512;
const DMX_DEFAULT_HZ = 20;
const DMX_BREAK_MS = 1; // DMX break >= 88µs; 1ms is safe and within spec

// Protocol modes
const DMX_MODE_RAW = "raw"; // USB-to-RS485 adapter (250000 baud, manual break)
const DMX_MODE_ENTTEC = "enttec"; // ENTTEC DMX USB Pro (57600 baud, framed packets)

let dmxPort = null;
let dmxWriter = null;
let dmxRunning = false;
let dmxIntervalId = null;
let dmxHz = DMX_DEFAULT_HZ;
let dmxMode = DMX_MODE_RAW;
let dmxSending = false; // lock to prevent overlapping serial writes

// --- Raw DMX (USB-to-RS485) ---

function buildRawDmxFrame(channelData) {
  // Start code (0x00) + 512 channel bytes
  const frame = new Uint8Array(1 + channelData.length);
  frame[0] = 0x00; // DMX start code
  frame.set(channelData, 1);
  return frame;
}

async function sendRawDmxFrame(data) {
  // 1. Assert BREAK (TX held low >= 88µs)
  await dmxPort.setSignals({ break: true });
  await sleep(DMX_BREAK_MS);
  // 2. Release BREAK → MAB (Mark After Break, TX goes high >= 8µs)
  await dmxPort.setSignals({ break: false });
  // 3. Send start code + channel data
  const frame = buildRawDmxFrame(data);
  await dmxWriter.write(frame);
}

// --- ENTTEC DMX USB Pro ---

function buildEnttecDmxPacket(channelData) {
  const dmxLen = channelData.length + 1; // +1 for DMX start code
  const packet = new Uint8Array(4 + dmxLen + 1);
  packet[0] = 0x7e; // Start
  packet[1] = 0x06; // Label: Send DMX
  packet[2] = dmxLen & 0xff; // Length LSB
  packet[3] = (dmxLen >> 8) & 0xff; // Length MSB
  packet[4] = 0x00; // DMX start code
  packet.set(channelData, 5);
  packet[4 + dmxLen] = 0xe7; // End
  return packet;
}

async function sendEnttecDmxFrame(data) {
  const packet = buildEnttecDmxPacket(data);
  await dmxWriter.write(packet);
}

// --- Shared ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getCurrentSceneDmxData() {
  if (!proFileData) return new Uint8Array(DMX_UNIVERSE_SIZE);

  const dmx = new Uint8Array(DMX_UNIVERSE_SIZE);
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      const dmxChannel = s * CHANNELS_PER_SCANNER + ch;
      dmx[dmxChannel] =
        proFileData[getSceneChannelOffset(currentSceneIndex, s, ch)];
    }
  }
  return dmx;
}

async function dmxConnect() {
  if (!("serial" in navigator)) {
    showError("Web Serial API not supported. Use Chrome or Edge.");
    return;
  }

  try {
    dmxPort = await navigator.serial.requestPort();

    if (dmxMode === DMX_MODE_RAW) {
      await dmxPort.open({
        baudRate: 250000,
        dataBits: 8,
        stopBits: 2,
        parity: "none",
        flowControl: "none",
      });
    } else {
      await dmxPort.open({
        baudRate: 57600,
        dataBits: 8,
        stopBits: 1,
        parity: "none",
        flowControl: "none",
      });
    }

    dmxWriter = dmxPort.writable.getWriter();
    dmxStart();
    updateDmxButton(true);
  } catch (err) {
    if (err.name !== "NotFoundError") {
      showError(`DMX connection failed: ${err.message}`);
    }
    dmxPort = null;
    dmxWriter = null;
  }
}

async function dmxDisconnect() {
  dmxStop();
  try {
    if (dmxWriter) {
      await dmxWriter.releaseLock();
      dmxWriter = null;
    }
    if (dmxPort) {
      await dmxPort.close();
      dmxPort = null;
    }
  } catch (err) {
    console.warn("DMX disconnect:", err);
  }
  updateDmxButton(false);
}

function dmxStart() {
  if (dmxRunning) return;
  dmxRunning = true;
  dmxIntervalId = setInterval(dmxSendFrame, 1000 / dmxHz);
}

function dmxStop() {
  dmxRunning = false;
  if (dmxIntervalId !== null) {
    clearInterval(dmxIntervalId);
    dmxIntervalId = null;
  }
}

async function dmxSendFrame() {
  if (!dmxWriter || !dmxRunning || dmxSending) return;
  dmxSending = true;
  try {
    // Use operator fade data if running, otherwise direct scene data
    const data =
      typeof getOperatorDmxData === "function" && operatorRunning
        ? getOperatorDmxData().slice()
        : getCurrentSceneDmxData().slice();
    if (dmxMode === DMX_MODE_RAW) {
      await sendRawDmxFrame(data);
    } else {
      await sendEnttecDmxFrame(data);
    }
  } catch (err) {
    console.error("DMX send error:", err);
    dmxDisconnect();
    showError(`DMX output lost: ${err.message}`);
  } finally {
    dmxSending = false;
  }
}

function toggleDmxOutput() {
  if (dmxPort && dmxRunning) {
    dmxDisconnect();
  } else {
    dmxConnect();
  }
}

function setDmxMode(mode) {
  const wasRunning = dmxRunning;
  if (wasRunning) dmxDisconnect();
  dmxMode = mode;
  updateDmxModeButton();
}

function toggleDmxMode() {
  setDmxMode(dmxMode === DMX_MODE_RAW ? DMX_MODE_ENTTEC : DMX_MODE_RAW);
}

function updateDmxModeButton() {
  const btn = document.getElementById("dmxModeBtn");
  if (!btn) return;
  btn.textContent = dmxMode === DMX_MODE_RAW ? "📡 Raw RS485" : "📡 ENTTEC Pro";
  btn.title =
    dmxMode === DMX_MODE_RAW
      ? "Mode: Raw USB-to-RS485 (250kbaud). Click to switch to ENTTEC Pro."
      : "Mode: ENTTEC DMX USB Pro (57600 baud). Click to switch to Raw RS485.";
}

function updateDmxButton(connected) {
  const btn = document.getElementById("dmxPlayBtn");
  if (!btn) return;
  if (connected) {
    btn.classList.add("dmx-active");
    btn.textContent = "🔴 DMX Stop";
  } else {
    btn.classList.remove("dmx-active");
    btn.textContent = "▶️ DMX Output";
  }
}
