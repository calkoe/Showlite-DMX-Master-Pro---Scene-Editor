// ─── AI Lighting Agent ──────────────────────────────────────────────
// Browser-side OpenAI integration for creative DMX light show generation.
// Reuses existing globals: proFileData, currentSceneIndex, displayScene(),
// getSceneData(), getSceneChannelOffset(), updateSceneMetadata(), etc.

let aiChatOpen = false;
let aiConversation = []; // {role, content} history
let aiStreaming = false;
let aiToolCounter = 0;
let aiToolCounterDiv = null;
let aiUndoSnapshot = null; // Uint8Array copy of proFileData before last AI operation

// ─── Chat Panel UI ──────────────────────────────────────────────────

function toggleAiChat() {
  const panel = document.getElementById("aiChatPanel");
  const btn = document.getElementById("aiChatToggleBtn");
  aiChatOpen = !aiChatOpen;
  panel.classList.toggle("open", aiChatOpen);
  btn.classList.toggle("ai-active", aiChatOpen);
  if (aiChatOpen) {
    // Populate model selector once
    const sel = document.getElementById("aiModelSelect");
    if (sel && sel.options.length === 0) {
      const current = aiGetModel();
      for (const m of AI_MODELS) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        if (m === current) opt.selected = true;
        sel.appendChild(opt);
      }
    }
    document.getElementById("aiChatInput").focus();
    if (document.getElementById("aiChatMessages").children.length === 0) {
      aiAddMessage(
        "system",
        'Hi! I\'m your AI lighting designer. Tell me what kind of light show you\'d like and I\'ll program all 8 scenes of your current bank.\n\nExamples:\n• "Create a chill blue-purple ambient show"\n• "Party strobe sequence with rainbow colors"\n• "Slow warm candlelight mood"',
      );
    }
  }
}

function aiResetConversation() {
  if (aiStreaming) return;
  aiConversation = [];
  aiUndoSnapshot = null;
  const container = document.getElementById("aiChatMessages");
  container.innerHTML = "";
  aiAddMessage(
    "system",
    "Conversation reset.\n\nDescribe a light show and I'll program it for you.",
  );
}

function aiRevertLastChange() {
  if (aiStreaming) return;
  if (!aiUndoSnapshot) {
    aiAddMessage("system", "Nothing to revert.");
    return;
  }
  proFileData.set(aiUndoSnapshot);
  aiUndoSnapshot = null;
  displayScene();
  aiAddMessage("system", "Reverted to the state before the last AI change.");
}

function toggleCopyBankPopover() {
  const pop = document.getElementById("copyBankPopover");
  pop.style.display = pop.style.display === "none" ? "flex" : "none";
}

function aiAddMessage(role, text) {
  const container = document.getElementById("aiChatMessages");
  const div = document.createElement("div");
  div.className = `ai-msg ${role}`;
  div.textContent = text;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function aiAddStreamingMessage() {
  const container = document.getElementById("aiChatMessages");
  const div = document.createElement("div");
  div.className = "ai-msg assistant";
  div.innerHTML = '<span class="ai-typing"></span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function aiUpdateToolCounter() {
  const container = document.getElementById("aiChatMessages");
  if (!aiToolCounterDiv) {
    aiToolCounterDiv = document.createElement("div");
    aiToolCounterDiv.className = "ai-msg tool-counter";
    container.appendChild(aiToolCounterDiv);
  }
  aiToolCounterDiv.innerHTML = `<span class="tool-counter-icon">⚙</span> ${aiToolCounter} tool call${aiToolCounter !== 1 ? "s" : ""} completed…`;
  container.scrollTop = container.scrollHeight;
}

function aiFinalizeToolCounter() {
  if (aiToolCounterDiv && aiToolCounter > 0) {
    aiToolCounterDiv.innerHTML = `<span class="tool-counter-icon">✓</span> ${aiToolCounter} tool call${aiToolCounter !== 1 ? "s" : ""} completed`;
    aiToolCounterDiv.classList.add("done");
  }
  aiToolCounterDiv = null;
}

// Flash a scene-bar item to indicate AI modification
function aiFlashScene(sceneNum) {
  const items = document.querySelectorAll(".scene-bar-item");
  const item = items[sceneNum - 1];
  if (!item) return;
  item.classList.remove("ai-flash");
  void item.offsetWidth;
  item.classList.add("ai-flash");
  item.addEventListener(
    "animationend",
    () => item.classList.remove("ai-flash"),
    { once: true },
  );
}

// Flash a specific slider cell to indicate AI modification
function aiFlashSlider(scannerZeroBased, channel) {
  const slider = document.querySelector(
    `input[type="range"][data-scanner="${scannerZeroBased}"][data-channel="${channel}"]`,
  );
  if (!slider) return;
  const cell = slider.closest("td");
  if (!cell) return;
  cell.classList.remove("ai-flash-slider");
  void cell.offsetWidth;
  cell.classList.add("ai-flash-slider");
  cell.addEventListener(
    "animationend",
    () => cell.classList.remove("ai-flash-slider"),
    { once: true },
  );
}

// ─── API Key Management ─────────────────────────────────────────────

const AI_MODELS = ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini"];

function aiGetApiKey() {
  return localStorage.getItem("openai_api_key") || "";
}

function aiSetApiKey(key) {
  localStorage.setItem("openai_api_key", key);
}

function aiGetModel() {
  return localStorage.getItem("openai_model") || "gpt-4o";
}

function aiSetModel(model) {
  localStorage.setItem("openai_model", model);
}

function aiAgentChangeApiKey() {
  const current = aiGetApiKey();
  aiPromptForApiKey(current);
}

function aiPromptForApiKey(prefill) {
  const container = document.getElementById("aiChatMessages");
  const div = document.createElement("div");
  div.className = "ai-msg system";

  const wrapper = document.createElement("div");
  wrapper.className = "ai-key-prompt";

  const label = document.createElement("span");
  label.textContent = "Enter your OpenAI API key:";
  wrapper.appendChild(label);

  const input = document.createElement("input");
  input.type = "password";
  input.placeholder = "sk-...";
  input.value = prefill || "";
  wrapper.appendChild(input);

  const btn = document.createElement("button");
  btn.textContent = "Save Key";
  btn.onclick = () => {
    const key = input.value.trim();
    if (!key.startsWith("sk-")) {
      label.textContent = "Invalid key format. Must start with sk-";
      label.style.color = "#ff6b6b";
      return;
    }
    aiSetApiKey(key);
    div.remove();
    aiAddMessage("system", "API key saved. You can now chat!");
  };
  wrapper.appendChild(btn);

  div.appendChild(wrapper);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  input.focus();
}

// ─── System Prompt & Context ────────────────────────────────────────

function aiBuildSystemPrompt() {
  const currentBank = Math.floor(currentSceneIndex / SCENES_PER_BANK) + 1;
  const currentSceneInBank = (currentSceneIndex % SCENES_PER_BANK) + 1;

  // Channel config summary (group identical scanners)
  const scannerConfigs = {};
  for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
    const channels = [];
    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      const attrId = getChannelMapping(s, ch);
      if (attrId !== 0) {
        const attr = CHANNEL_ATTRIBUTES[attrId];
        channels.push(`ch${ch}=${attr ? attr.name : "?"}`);
      }
    }
    if (channels.length > 0) {
      const key = channels.join(", ");
      if (!scannerConfigs[key]) scannerConfigs[key] = [];
      scannerConfigs[key].push(s + 1);
    }
  }
  let configSummary = "";
  for (const [cfg, scanners] of Object.entries(scannerConfigs)) {
    const label =
      scanners.length > 1
        ? `Scanners ${scanners.join(",")}`
        : `Scanner ${scanners[0]}`;
    configSummary += `  ${label}: ${cfg}\n`;
  }

  // Bank overview
  let bankOverview = "";
  const bankStart = (currentBank - 1) * SCENES_PER_BANK;
  for (let i = 0; i < SCENES_PER_BANK; i++) {
    const sd = getSceneData(bankStart + i);
    bankOverview += `  Scene ${i + 1}: ${sd && !sd.isEmpty ? "has data" : "empty"}\n`;
  }

  return `
  
Lighting assistant for Showlite DMX Master Pro. Be CONCISE — act first, minimal text.

DATA MODEL (do NOT confuse these):
- BANK (1-30): A group of 8 scenes. Bank 30 = config, PROTECTED. Current bank: ${currentBank}.
- SCENE (1-8): One lighting look within a bank. Current scene: ${currentSceneInBank}. Scenes play in loop 1→2→…→8→1.
- SCANNER/DEVICE (1-12): A physical light fixture / device. Each scene has 12 scanners.
- CHANNEL (0-15): A single DMX parameter of one scanner (e.g. dimmer, red, pan). Each scanner has 16 channels.
Hierarchy: Bank → Scene → Scanner → Channel. "ch5" means channel index 5 of a specific scanner — do NOT confuse channel numbers with scanner numbers or scene numbers.

TOOL SELECTION:
- ONE channel: set_channel.
- RGB colors (1 or many scanners): set_colors_batch.
- Pan/tilt: set_position.
- Any other channel changes (single scanner, multiple scanners, full scene): set_scene_batch.
- When user says "all lights/lamps/scanners" → apply to scanners 1-12.
- When user mentions MULTIPLE channels → change ALL of them in one set_scene_batch call.
Rules: DIMMER>0 or lights stay dark.
Reply shortly. No explanations before tool calls.

CRITICAL — SCENE SCOPE (important!):
- If user does NOT mention a specific scene → apply changes to ALL 8 scenes (the whole bank).
- Scenes depend on each other and together form a flow — editing only one scene breaks the show.
- Only target a single scene if the user explicitly says "scene 3" or "this szene" or "here".

LIGHT SHOW DESIGN GUIDE:
A bank is ONE complete show. The 8 scenes are frames in an endless loop: 1→2→3→4→5→6→7→8→1→2→…
Scene speed and transition time depend on the music and are set at playback — you only control the 8 frames.
Design tips for great shows:
- SMOOTH LOOPS: Scene 8 must transition cleanly back to Scene 1. Avoid hard jumps — end where you began.
- CONTRAST & DYNAMICS: Alternate between intense and calm scenes. E.g. bright scene → dark scene → color burst.
- COLOR PROGRESSION: Use gradual color shifts across scenes (e.g. warm→cool→warm) rather than random colors.
- USE ALL SCANNERS: Spread different colors/positions across scanners for depth. Not all lights the same.
- BLACKOUT FRAMES: A short blackout (dimmer=0) scene creates powerful dramatic pauses.
- ODD/EVEN PATTERNS: Alternate scanner groups (odd vs even) for chase effects across frames.

MOTION PATTERNS (pan/tilt) — CRITICAL:
- Motion is ESPECIALLY dependent on the 1→2→…→8→1 loop order.
- Plan the full 8-step trajectory BEFORE setting values. E.g. for a circle: distribute 8 evenly-spaced points around the circle.
- Scene 8→Scene 1 must continue the motion smoothly, not snap back.
- Example circle (pan,tilt): (0,90)→(64,64)→(90,0)→(64,-64)→(0,-90)→(-64,-64)→(-90,0)→(-64,64) — returns to start.
- For sweeps: reverse direction at midpoint (scenes 4-5) so the loop flows back and forth naturally.

COLOR/GOBO WHEELS — CALIBRATION:
- Color Wheel and Gobo Wheel channels have presets calibrated in Bank 30 (Scenes 2-8).
- Use get_wheel_presets to read the calibrated DMX values BEFORE setting these channels.
- ALWAYS use the calibrated preset values — do NOT guess arbitrary DMX values for wheel channels.
- Each scanner may have different calibration values (mixed fixtures).

DATA:
Channel config per scanner: ${configSummary || "(No config)"}
currentBank: ${currentBank}
currentSceneInBank: ${currentSceneInBank}
All scenes of this bank:
${bankOverview}
`;
}

// ─── OpenAI Tool Definitions ────────────────────────────────────────

const AI_TOOLS = [
  {
    type: "function",
    function: {
      name: "get_channel_config",
      description: "Get channel mappings for all scanners.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_wheel_presets",
      description:
        "Get calibrated Color Wheel and Gobo Wheel preset DMX values from Bank 30. MUST call before setting wheel channels.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_scene_info",
      description: "Read all channel values for a scene (1-8).",
      parameters: {
        type: "object",
        properties: {
          scene: { type: "number", description: "1-8" },
        },
        required: ["scene"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_scene_batch",
      description:
        'PREFERRED: Set multiple scanners in one scene at once. Data is {"scanner_1": {"0": 128, "3": 255}, "scanner_2": {...}}. Keys are scanner_N (1-12), values are channel:dmxValue objects. Most efficient way to program a full scene.',
      parameters: {
        type: "object",
        properties: {
          scene: { type: "number", description: "1-8" },
          data: {
            type: "object",
            description:
              'Map of "scanner_N" to {channelIndex: dmxValue}. E.g. {"scanner_1": {"0": 255, "3": 128}, "scanner_2": {"0": 100}}',
          },
        },
        required: ["scene", "data"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_colors_batch",
      description:
        "Set RGB(W)+dimmer for one or many scanners in one scene. Array of {scanner, red, green, blue, white?, dimmer?}.",
      parameters: {
        type: "object",
        properties: {
          scene: { type: "number", description: "1-8" },
          colors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                scanner: { type: "number", description: "1-12" },
                red: { type: "number" },
                green: { type: "number" },
                blue: { type: "number" },
                white: { type: "number" },
                dimmer: { type: "number" },
              },
              required: ["scanner", "red", "green", "blue"],
            },
          },
        },
        required: ["scene", "colors"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_position",
      description: "Set pan/tilt in degrees (-90 to +90) for a scanner.",
      parameters: {
        type: "object",
        properties: {
          scene: { type: "number", description: "1-8" },
          scanner: { type: "number", description: "1-12" },
          pan: { type: "number" },
          tilt: { type: "number" },
        },
        required: ["scene", "scanner", "pan", "tilt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "set_channel",
      description: "Set a SINGLE channel value for one scanner in a scene.",
      parameters: {
        type: "object",
        properties: {
          scene: { type: "number", description: "1-8" },
          scanner: { type: "number", description: "1-12" },
          channel: { type: "number", description: "0-15" },
          value: { type: "number", description: "0-255" },
        },
        required: ["scene", "scanner", "channel", "value"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "clear_scene",
      description: "Zero all channels in a scene.",
      parameters: {
        type: "object",
        properties: {
          scene: { type: "number", description: "1-8" },
        },
        required: ["scene"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "jump_to_scene",
      description: "Navigate editor to a scene.",
      parameters: {
        type: "object",
        properties: {
          scene: { type: "number", description: "1-8" },
        },
        required: ["scene"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_scene",
      description: "Copy scene to another scene in current bank.",
      parameters: {
        type: "object",
        properties: {
          from_scene: { type: "number", description: "1-8" },
          to_scene: { type: "number", description: "1-8" },
        },
        required: ["from_scene", "to_scene"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "copy_bank_to",
      description: "Copy current bank to another (1-29).",
      parameters: {
        type: "object",
        properties: {
          target_bank: { type: "number", description: "1-29" },
        },
        required: ["target_bank"],
      },
    },
  },
];

// ─── Tool Execution ─────────────────────────────────────────────────

function aiGetCurrentBank() {
  return Math.floor(currentSceneIndex / SCENES_PER_BANK) + 1;
}

function aiSceneIndex(sceneNum) {
  const bank = aiGetCurrentBank();
  return (bank - 1) * SCENES_PER_BANK + (sceneNum - 1);
}

function aiValidateScene(sceneNum) {
  if (sceneNum < 1 || sceneNum > 8) return "Scene must be 1-8.";
  return null;
}

function aiChannelAttrName(scanner, channel) {
  const attrId = getChannelMapping(scanner, channel);
  const attr = CHANNEL_ATTRIBUTES[attrId];
  return attr ? attr.name : "NONE";
}

function aiExecuteTool(name, args) {
  if (!proFileData) return { error: "No .PRO file loaded." };

  const bank = aiGetCurrentBank();

  switch (name) {
    case "get_channel_config": {
      const result = {};
      for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
        const channels = {};
        for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
          const attrName = aiChannelAttrName(s, ch);
          if (attrName !== "NONE") {
            channels[`ch${ch}`] = attrName;
          }
        }
        if (Object.keys(channels).length > 0) {
          result[`scanner_${s + 1}`] = channels;
        }
      }
      return result;
    }

    case "get_wheel_presets": {
      const result = {};
      for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
        const wheelChannels = [];
        for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
          const attrId = getChannelMapping(s, ch);
          const attr = CHANNEL_ATTRIBUTES[attrId];
          if (
            attr &&
            (attr.name === "COLOR_WHEEL" || attr.name === "GOBO_WHEEL")
          ) {
            wheelChannels.push({ ch, name: attr.name });
          }
        }
        if (wheelChannels.length === 0) continue;
        const scannerPresets = {};
        for (const { ch, name } of wheelChannels) {
          const presets = {};
          for (let p = 2; p <= 8; p++) {
            const val = getCalibrationValue(s, ch, p);
            if (val > 0) presets[`preset_${p - 1}`] = val;
          }
          if (Object.keys(presets).length > 0) {
            scannerPresets[`ch${ch}_${name}`] = presets;
          }
        }
        if (Object.keys(scannerPresets).length > 0) {
          result[`scanner_${s + 1}`] = scannerPresets;
        }
      }
      return Object.keys(result).length > 0
        ? result
        : { info: "No wheel presets calibrated in Bank 30." };
    }

    case "set_scene_batch": {
      const err = aiValidateScene(args.scene);
      if (err) return { error: err };
      const sceneIdx = aiSceneIndex(args.scene);
      const results = [];
      for (const [scannerKey, channels] of Object.entries(args.data || {})) {
        const sNum = parseInt(scannerKey.replace("scanner_", ""), 10);
        const s = sNum - 1;
        if (s < 0 || s >= SCANNERS_PER_SCENE) continue;
        for (const [chStr, val] of Object.entries(channels)) {
          const ch = parseInt(chStr, 10);
          if (ch >= 0 && ch <= 15 && val >= 0 && val <= 255) {
            proFileData[getSceneChannelOffset(sceneIdx, s, ch)] = val;
          }
        }
        // Flash modified channels on current scene
        if (sceneIdx === currentSceneIndex) {
          for (const chStr of Object.keys(channels)) {
            const ch = parseInt(chStr, 10);
            if (ch >= 0 && ch <= 15) aiFlashSlider(s, ch);
          }
        }
        results.push(`s${sNum}:${Object.keys(channels).length}ch`);
      }
      updateSceneMetadata(sceneIdx);
      if (sceneIdx === currentSceneIndex) displayScene();
      aiFlashScene(args.scene);
      return { ok: true, scene: args.scene, set: results };
    }

    case "get_scene_info": {
      const err = aiValidateScene(args.scene);
      if (err) return { error: err };
      const sceneIdx = aiSceneIndex(args.scene);
      const data = getSceneData(sceneIdx);
      if (!data) return { error: "Could not read scene." };

      const result = {
        bank,
        scene: args.scene,
        isEmpty: data.isEmpty,
        scanners: {},
      };
      for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
        const channels = {};
        for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
          const attrName = aiChannelAttrName(s, ch);
          const val = data.scanners[s][ch];
          if (attrName !== "NONE") {
            channels[`ch${ch}_${attrName}`] = val;
          } else if (val !== 0) {
            channels[`ch${ch}`] = val;
          }
        }
        if (Object.keys(channels).length > 0) {
          result.scanners[`scanner_${s + 1}`] = channels;
        }
      }
      return result;
    }

    case "set_colors_batch": {
      const err = aiValidateScene(args.scene);
      if (err) return { error: err };
      const sceneIdx = aiSceneIndex(args.scene);
      const results = [];
      for (const entry of args.colors || []) {
        const s = entry.scanner - 1;
        if (s < 0 || s >= SCANNERS_PER_SCENE) continue;
        const rgbw = getRGBWChannels(s);
        const set = [];
        if (rgbw.red >= 0) {
          proFileData[getSceneChannelOffset(sceneIdx, s, rgbw.red)] = entry.red;
          set.push(`R=${entry.red}`);
          if (sceneIdx === currentSceneIndex) aiFlashSlider(s, rgbw.red);
        }
        if (rgbw.green >= 0) {
          proFileData[getSceneChannelOffset(sceneIdx, s, rgbw.green)] =
            entry.green;
          set.push(`G=${entry.green}`);
          if (sceneIdx === currentSceneIndex) aiFlashSlider(s, rgbw.green);
        }
        if (rgbw.blue >= 0) {
          proFileData[getSceneChannelOffset(sceneIdx, s, rgbw.blue)] =
            entry.blue;
          set.push(`B=${entry.blue}`);
          if (sceneIdx === currentSceneIndex) aiFlashSlider(s, rgbw.blue);
        }
        const w = entry.white ?? 0;
        if (rgbw.white >= 0) {
          proFileData[getSceneChannelOffset(sceneIdx, s, rgbw.white)] = w;
          set.push(`W=${w}`);
          if (sceneIdx === currentSceneIndex) aiFlashSlider(s, rgbw.white);
        }
        const dim = entry.dimmer ?? 255;
        const dimCh = getDimmerChannel(s);
        if (dimCh >= 0) {
          proFileData[getSceneChannelOffset(sceneIdx, s, dimCh)] = dim;
          set.push(`DIM=${dim}`);
          if (sceneIdx === currentSceneIndex) aiFlashSlider(s, dimCh);
        }
        results.push(`s${entry.scanner}:${set.join(",")}`);
      }
      updateSceneMetadata(sceneIdx);
      if (sceneIdx === currentSceneIndex) displayScene();
      aiFlashScene(args.scene);
      return { ok: true, scene: args.scene, set: results };
    }

    case "set_position": {
      const err = aiValidateScene(args.scene);
      if (err) return { error: err };
      const sceneIdx = aiSceneIndex(args.scene);
      const s = args.scanner - 1;
      if (s < 0 || s >= SCANNERS_PER_SCENE)
        return { error: "Scanner must be 1-12." };

      const pt = getPanTiltChannels(s);
      const set = [];
      if (pt.pan >= 0) {
        const dmx = degreeToDmx(s, pt.pan, args.pan);
        proFileData[getSceneChannelOffset(sceneIdx, s, pt.pan)] = dmx;
        set.push(`Pan=${args.pan}° (DMX ${dmx})`);
      }
      if (pt.tilt >= 0) {
        const dmx = degreeToDmx(s, pt.tilt, args.tilt);
        proFileData[getSceneChannelOffset(sceneIdx, s, pt.tilt)] = dmx;
        set.push(`Tilt=${args.tilt}° (DMX ${dmx})`);
      }
      updateSceneMetadata(sceneIdx);
      if (sceneIdx === currentSceneIndex) displayScene();
      aiFlashScene(args.scene);
      if (pt.pan >= 0) aiFlashSlider(s, pt.pan);
      if (pt.tilt >= 0) aiFlashSlider(s, pt.tilt);
      return { ok: true, scanner: args.scanner, set };
    }

    case "set_channel": {
      const err = aiValidateScene(args.scene);
      if (err) return { error: err };
      const sceneIdx = aiSceneIndex(args.scene);
      const s = args.scanner - 1;
      if (s < 0 || s >= SCANNERS_PER_SCENE)
        return { error: "Scanner must be 1-12." };
      if (args.channel < 0 || args.channel > 15)
        return { error: "Channel must be 0-15." };
      if (args.value < 0 || args.value > 255)
        return { error: "Value must be 0-255." };

      proFileData[getSceneChannelOffset(sceneIdx, s, args.channel)] =
        args.value;
      updateSceneMetadata(sceneIdx);
      if (sceneIdx === currentSceneIndex) displayScene();
      aiFlashScene(args.scene);
      aiFlashSlider(s, args.channel);
      return {
        ok: true,
        scanner: args.scanner,
        channel: args.channel,
        name: aiChannelAttrName(s, args.channel),
        value: args.value,
      };
    }

    case "clear_scene": {
      const err = aiValidateScene(args.scene);
      if (err) return { error: err };
      const sceneIdx = aiSceneIndex(args.scene);
      const offset = getSceneBlockOffset(sceneIdx);
      proFileData.fill(0, offset, offset + SCENE_RECORD_SIZE);
      updateSceneMetadata(sceneIdx);
      if (sceneIdx === currentSceneIndex) displayScene();
      aiFlashScene(args.scene);
      return { ok: true, scene: args.scene, cleared: true };
    }

    case "jump_to_scene": {
      const err = aiValidateScene(args.scene);
      if (err) return { error: err };
      const sceneIdx = aiSceneIndex(args.scene);
      jumpToScene(sceneIdx);
      return { ok: true, jumped_to: `Bank ${bank} Scene ${args.scene}` };
    }

    case "copy_scene": {
      const err1 = aiValidateScene(args.from_scene);
      if (err1) return { error: `from_scene: ${err1}` };
      const err2 = aiValidateScene(args.to_scene);
      if (err2) return { error: `to_scene: ${err2}` };
      const srcIdx = aiSceneIndex(args.from_scene);
      const dstIdx = aiSceneIndex(args.to_scene);
      const srcOffset = getSceneBlockOffset(srcIdx);
      const dstOffset = getSceneBlockOffset(dstIdx);
      const srcData = proFileData.slice(
        srcOffset,
        srcOffset + SCENE_RECORD_SIZE,
      );
      proFileData.set(srcData, dstOffset);
      updateSceneMetadata(dstIdx);
      if (dstIdx === currentSceneIndex) displayScene();
      aiFlashScene(args.to_scene);
      return {
        ok: true,
        copied: `Scene ${args.from_scene} → Scene ${args.to_scene}`,
      };
    }

    case "copy_bank_to": {
      const target = args.target_bank;
      if (target < 1 || target > 29)
        return { error: "Target bank must be 1-29." };
      const srcBankStart = (bank - 1) * SCENES_PER_BANK;
      const dstBankStart = (target - 1) * SCENES_PER_BANK;
      for (let i = 0; i < SCENES_PER_BANK; i++) {
        const srcOffset = getSceneBlockOffset(srcBankStart + i);
        const dstOffset = getSceneBlockOffset(dstBankStart + i);
        const srcData = proFileData.slice(
          srcOffset,
          srcOffset + SCENE_RECORD_SIZE,
        );
        proFileData.set(srcData, dstOffset);
        updateSceneMetadata(dstBankStart + i);
      }
      return { ok: true, copied: `Bank ${bank} → Bank ${target}` };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

// ─── OpenAI API Communication ───────────────────────────────────────

async function aiCallOpenAI(messages, retryCount = 0) {
  const apiKey = aiGetApiKey();
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: aiGetModel(),
      messages,
      tools: AI_TOOLS,
      tool_choice: "auto",
      stream: true,
    }),
  });

  if (!resp.ok) {
    const errBody = await resp.text();
    let errMsg = `API error ${resp.status}`;
    let retryMs = 0;
    try {
      const errJson = JSON.parse(errBody);
      errMsg = errJson.error?.message || errMsg;
      // Parse retry-after from error message (e.g. "Please try again in 966ms")
      const msMatch = errMsg.match(/try again in (\d+)ms/i);
      const sMatch = errMsg.match(/try again in ([\d.]+)s/i);
      if (msMatch) retryMs = parseInt(msMatch[1], 10);
      else if (sMatch) retryMs = Math.ceil(parseFloat(sMatch[1]) * 1000);
    } catch (_) {}

    // Auto-retry on rate limit (429) up to 3 times
    if (resp.status === 429 && retryCount < 3) {
      const waitMs = Math.max(retryMs || 2000, 1000) + retryCount * 1000;
      aiAddMessage(
        "system",
        `Rate limited. Retrying in ${(waitMs / 1000).toFixed(1)}s...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
      return aiCallOpenAI(messages, retryCount + 1);
    }
    throw new Error(errMsg);
  }

  return resp.body;
}

async function aiProcessStream(stream, msgDiv) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let textContent = "";
  let toolCalls = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;

      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch (_) {
        continue;
      }

      const delta = parsed.choices?.[0]?.delta;
      if (!delta) continue;

      // Text content
      if (delta.content) {
        textContent += delta.content;
        msgDiv.textContent = textContent;
        document.getElementById("aiChatMessages").scrollTop =
          document.getElementById("aiChatMessages").scrollHeight;
      }

      // Tool calls (streamed incrementally)
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          if (!toolCalls[idx]) {
            toolCalls[idx] = {
              id: tc.id || "",
              function: { name: "", arguments: "" },
            };
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name)
            toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments)
            toolCalls[idx].function.arguments += tc.function.arguments;
        }
      }
    }
  }

  return { textContent, toolCalls: toolCalls.filter(Boolean) };
}

// ─── Main Send Logic ────────────────────────────────────────────────

async function aiAgentSend() {
  if (aiStreaming) return;

  const input = document.getElementById("aiChatInput");
  const text = input.value.trim();
  if (!text) return;

  // Check for API key
  if (!aiGetApiKey()) {
    aiPromptForApiKey("");
    return;
  }

  // Check for loaded file
  if (!proFileData) {
    aiAddMessage(
      "system",
      "Please load a .PRO file first before using the AI agent.",
    );
    return;
  }

  input.value = "";
  aiAddMessage("user", text);

  // Snapshot for undo before AI makes changes
  if (proFileData) aiUndoSnapshot = new Uint8Array(proFileData);

  // Reset tool counter for this request
  aiToolCounter = 0;
  aiToolCounterDiv = null;

  // Add user message to conversation
  aiConversation.push({ role: "user", content: text });

  // Trim conversation to manage token usage — must keep tool_calls/tool pairs intact
  if (aiConversation.length > 12) {
    // Find the latest safe cut point: a "user" message that is NOT immediately
    // preceded by an assistant with tool_calls (which would orphan tool responses).
    let safeCut = -1;
    const start = Math.max(0, aiConversation.length - 10);
    const end = aiConversation.length - 4; // keep at least 4 recent messages
    for (let i = start; i <= end; i++) {
      if (aiConversation[i].role === "user") {
        safeCut = i;
        break;
      }
    }
    if (safeCut > 0) {
      aiConversation = aiConversation.slice(safeCut);
    }
  }

  await aiRunConversation();
}

async function aiRunConversation() {
  aiStreaming = true;
  const sendBtn = document.querySelector(".ai-chat-send-btn");
  sendBtn.disabled = true;

  try {
    // Build messages with fresh system prompt
    const messages = [
      { role: "system", content: aiBuildSystemPrompt() },
      ...aiConversation,
    ];

    const msgDiv = aiAddStreamingMessage();
    const stream = await aiCallOpenAI(messages);
    const { textContent, toolCalls } = await aiProcessStream(stream, msgDiv);

    // If there was text content, finalize the message
    if (textContent) {
      msgDiv.textContent = textContent;
    }

    // If there were tool calls, execute them
    if (toolCalls.length > 0) {
      if (!textContent) {
        // Remove the empty streaming message if no text was generated
        msgDiv.remove();
      }

      // Build single assistant message with tool_calls (and optional text)
      const assistantMsg = {
        role: "assistant",
        content: textContent || null,
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments,
          },
        })),
      };
      aiConversation.push(assistantMsg);

      // Execute each tool call
      for (const tc of toolCalls) {
        const fnName = tc.function.name;
        let fnArgs;
        try {
          fnArgs = JSON.parse(tc.function.arguments);
        } catch (parseErr) {
          console.error(
            `Tool arg parse error for ${fnName}:`,
            parseErr,
            tc.function.arguments,
          );
          aiConversation.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({ error: "Invalid arguments JSON" }),
          });
          aiToolCounter++;
          aiUpdateToolCounter();
          continue;
        }

        const result = aiExecuteTool(fnName, fnArgs);
        aiToolCounter++;
        aiUpdateToolCounter();

        // Add tool result to conversation
        aiConversation.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }

      // Continue the conversation (AI may want to call more tools or reply)
      await aiRunConversation();
      return;
    }

    // Text-only response (no tool calls) — add to conversation
    if (textContent) {
      aiConversation.push({ role: "assistant", content: textContent });
    }

    // Finalize tool counter
    aiFinalizeToolCounter();

    // No tool calls and no text — shouldn't happen, but handle gracefully
    if (!textContent && toolCalls.length === 0) {
      msgDiv.textContent = "(No response)";
    }
  } catch (err) {
    aiAddMessage("system", `Error: ${err.message}`);
    if (
      err.message.includes("401") ||
      err.message.includes("Incorrect API key")
    ) {
      aiPromptForApiKey(aiGetApiKey());
    }
  } finally {
    aiStreaming = false;
    document.querySelector(".ai-chat-send-btn").disabled = false;
  }
}
