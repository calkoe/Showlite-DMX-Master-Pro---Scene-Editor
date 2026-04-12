#!/usr/bin/env node
/**
 * Showlite DMX Master Pro — MCP Server
 *
 * Exposes tools that let an AI agent read and write .PRO scene files
 * directly on disk.  All binary-format logic is reused from the main
 * project via pro-loader.js (no duplicated code).
 *
 * Transport: stdio  (works with VS Code Copilot, Claude Desktop, etc.)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, extname } from "node:path";

import {
  setFileData,
  getFileData,
  SCENES_PER_BANK,
  NUM_BANKS,
  SCANNERS_PER_SCENE,
  CHANNELS_PER_SCANNER,
  TOTAL_SCENES,
  CONFIG_SCENE_INDEX,
  CHANNEL_ATTRIBUTES,
  CALIBRATION_SCENES,
  SCENE_RECORD_SIZE,
  getSceneBlockOffset,
  getSceneChannelOffset,
  updateSceneMetadata,
  getSceneData,
  getChannelMapping,
  setChannelMapping,
  getPanTiltChannels,
  getRGBWChannels,
  getDimmerChannel,
  degreeToDmx,
  dmxToDegree,
  EXPECTED_FILE_SIZE,
  PROJECT_ROOT_PATH,
} from "./pro-loader.js";

// ─── Helpers ────────────────────────────────────────────────────────

let currentFilePath = null;

function ensureLoaded() {
  if (!getFileData())
    throw new Error("No PRO file loaded. Call load_file first.");
}

function sceneLabel(sceneIndex) {
  const bank = Math.floor(sceneIndex / SCENES_PER_BANK) + 1;
  const scene = (sceneIndex % SCENES_PER_BANK) + 1;
  return `Bank ${bank} Scene ${scene}`;
}

function channelAttrName(scanner, ch) {
  const id = getChannelMapping(scanner, ch);
  return CHANNEL_ATTRIBUTES[id]?.name ?? "NONE";
}

function saveToDisk() {
  ensureLoaded();
  for (let i = 0; i < TOTAL_SCENES; i++) updateSceneMetadata(i);
  writeFileSync(currentFilePath, getFileData());
}

// ─── MCP Server ─────────────────────────────────────────────────────

const server = new McpServer({
  name: "showlite-pro",
  version: "1.0.0",
});

// ─── System Prompt ──────────────────────────────────────────────────

server.prompt(
  "scene-designer",
  "Creative lighting scene design assistant for the Showlite DMX Master Pro",
  {},
  () => ({
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: `You are a creative lighting design assistant for the **Showlite DMX Master Pro USB** controller.

## Data Model
- The controller has **30 banks × 8 scenes = 240 scenes** total.
- Each scene contains **12 scanners** (fixture slots), each with **16 DMX channels** (values 0–255).
- **Bank 30** is reserved for configuration — do NOT write creative scenes there.
- Banks 1–29 (232 scenes) are available for lighting scenes.

## Your Workflow — ALWAYS do this first:
1. Call \`load_file\` to load the .PRO file.
2. Call \`get_channel_config\` to see what channels are assigned for each scanner.
3. Call \`list_scenes\` to see what scenes already exist.
4. **IMPORTANT**: Look at each scanner's channel attributes. If you cannot tell what KIND of fixture a scanner is (e.g. moving head, LED par, strobe, fog machine, laser), you MUST ask the user:
   - "What type of fixture is on Scanner 1? (e.g. moving head wash, LED par can, spot with gobo wheel...)"
   - "What is Scanner 5 controlling? I see it has only a DIMMER channel."
   Knowing the fixture type is essential for creating good-looking scenes. Different fixtures serve different purposes — a moving head wash creates color washes, a spot projects gobos, a strobe adds energy, pars fill the stage.

## Creative Guidelines
- **Dimmer first**: Always set DIMMER to >0 or the fixture stays dark, even with colors set.
- **Color harmony**: Use complementary or analogous color schemes. Don't just blast R=255 G=255 B=255 everywhere.
- **Movement**: For moving heads, create gentle sweeps by varying pan/tilt across scenes in a bank. A bank of 8 scenes can form a smooth sequence.
- **Contrast**: Alternate between bright/saturated scenes and darker/moody ones within a bank.
- **Build-ups**: Use scene progression within a bank — start subtle, build intensity.
- **Gobos & color wheels**: Use preset slots (1–7) when available.
- **Group similar fixtures**: If multiple scanners are the same fixture type, give them coordinated but slightly varied positions/colors for depth.

## Key Rules
- Use \`set_color\` for RGB fixtures (it handles dimmer automatically).
- Use \`set_position\` for pan/tilt (it uses calibration for accurate degrees).
- Use \`set_scanner_batch\` to set many channels efficiently in one call.
- Every write tool auto-saves to disk — no need to call \`save_file\` separately.
- Always tell the user what you created and suggest they open the web editor to preview it.
- If the user asks for something vague like "make it look cool", ask about the mood, genre, or event type (concert, party, theater, chill lounge, etc.).`,
        },
      },
    ],
  }),
);

// ── 1. load_file ────────────────────────────────────────────────────

server.tool(
  "load_file",
  "Load a .PRO file from disk into memory. If no path given, loads the first .PRO file found in the project root.",
  {
    path: z
      .string()
      .optional()
      .describe("Absolute or relative path to .PRO file"),
  },
  async ({ path }) => {
    let filePath = path;

    if (!filePath) {
      const proFiles = readdirSync(PROJECT_ROOT_PATH).filter(
        (f) => extname(f).toLowerCase() === ".pro",
      );
      if (proFiles.length === 0)
        return {
          content: [
            { type: "text", text: "No .PRO file found in project root." },
          ],
        };
      filePath = resolve(PROJECT_ROOT_PATH, proFiles[0]);
    } else {
      filePath = resolve(filePath);
    }

    const buf = readFileSync(filePath);
    if (buf.length !== EXPECTED_FILE_SIZE)
      return {
        content: [
          {
            type: "text",
            text: `Invalid file: ${buf.length} bytes (expected ${EXPECTED_FILE_SIZE}).`,
          },
        ],
      };

    setFileData(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    currentFilePath = filePath;

    return {
      content: [
        {
          type: "text",
          text: `Loaded ${filePath} (${buf.length} bytes). ${NUM_BANKS} banks × ${SCENES_PER_BANK} scenes × ${SCANNERS_PER_SCENE} scanners × ${CHANNELS_PER_SCANNER} channels.`,
        },
      ],
    };
  },
);

// ── 2. save_file ────────────────────────────────────────────────────

server.tool(
  "save_file",
  "Save the current in-memory PRO data back to the loaded file (or a new path).",
  { path: z.string().optional().describe("Optional alternate save path") },
  async ({ path }) => {
    ensureLoaded();
    const target = path ? resolve(path) : currentFilePath;
    for (let i = 0; i < TOTAL_SCENES; i++) updateSceneMetadata(i);
    writeFileSync(target, getFileData());
    return { content: [{ type: "text", text: `Saved to ${target}.` }] };
  },
);

// ── 3. get_scene ────────────────────────────────────────────────────

server.tool(
  "get_scene",
  "Read all scanner channel values for a specific scene. Returns human-readable channel names.",
  {
    bank: z.number().int().min(1).max(30).describe("Bank number (1-30)"),
    scene: z.number().int().min(1).max(8).describe("Scene number (1-8)"),
  },
  async ({ bank, scene }) => {
    ensureLoaded();
    const sceneIndex = (bank - 1) * SCENES_PER_BANK + (scene - 1);
    const data = getSceneData(sceneIndex);
    if (!data)
      return { content: [{ type: "text", text: "Could not read scene." }] };

    const result = { bank, scene, isEmpty: data.isEmpty, scanners: {} };

    for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
      const channels = {};
      for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
        const name = channelAttrName(s, ch);
        const val = data.scanners[s][ch];
        if (name !== "NONE") {
          channels[`ch${ch}_${name}`] = val;
        } else if (val !== 0) {
          channels[`ch${ch}`] = val;
        }
      }
      if (Object.keys(channels).length > 0) {
        result.scanners[`scanner_${s + 1}`] = channels;
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  },
);

// ── 4. set_channel ──────────────────────────────────────────────────

server.tool(
  "set_channel",
  "Set a single channel's raw DMX value (0-255) for a scanner in a scene. Auto-saves to disk.",
  {
    bank: z.number().int().min(1).max(30),
    scene: z.number().int().min(1).max(8),
    scanner: z.number().int().min(1).max(12).describe("Scanner number (1-12)"),
    channel: z.number().int().min(0).max(15).describe("Channel index (0-15)"),
    value: z.number().int().min(0).max(255).describe("DMX value"),
  },
  async ({ bank, scene, scanner, channel, value }) => {
    ensureLoaded();
    const sceneIndex = (bank - 1) * SCENES_PER_BANK + (scene - 1);
    const s = scanner - 1;

    getFileData()[getSceneChannelOffset(sceneIndex, s, channel)] = value;
    saveToDisk();

    return {
      content: [
        {
          type: "text",
          text: `Set ${sceneLabel(sceneIndex)} scanner ${scanner} ch${channel} (${channelAttrName(s, channel)}) = ${value}. Saved.`,
        },
      ],
    };
  },
);

// ── 5. set_color ────────────────────────────────────────────────────

server.tool(
  "set_color",
  "Set RGB(W) color for a scanner. Values 0-255. Also sets dimmer to 255 if present. Auto-saves.",
  {
    bank: z.number().int().min(1).max(30),
    scene: z.number().int().min(1).max(8),
    scanner: z.number().int().min(1).max(12),
    red: z.number().int().min(0).max(255),
    green: z.number().int().min(0).max(255),
    blue: z.number().int().min(0).max(255),
    white: z.number().int().min(0).max(255).optional().default(0),
    dimmer: z.number().int().min(0).max(255).optional().default(255),
  },
  async ({ bank, scene, scanner, red, green, blue, white, dimmer }) => {
    ensureLoaded();
    const sceneIndex = (bank - 1) * SCENES_PER_BANK + (scene - 1);
    const s = scanner - 1;
    const fd = getFileData();

    const rgbw = getRGBWChannels(s);
    const set = [];

    if (rgbw.red >= 0) {
      fd[getSceneChannelOffset(sceneIndex, s, rgbw.red)] = red;
      set.push(`R=${red}`);
    }
    if (rgbw.green >= 0) {
      fd[getSceneChannelOffset(sceneIndex, s, rgbw.green)] = green;
      set.push(`G=${green}`);
    }
    if (rgbw.blue >= 0) {
      fd[getSceneChannelOffset(sceneIndex, s, rgbw.blue)] = blue;
      set.push(`B=${blue}`);
    }
    if (rgbw.white >= 0) {
      fd[getSceneChannelOffset(sceneIndex, s, rgbw.white)] = white;
      set.push(`W=${white}`);
    }

    const dimCh = getDimmerChannel(s);
    if (dimCh >= 0) {
      fd[getSceneChannelOffset(sceneIndex, s, dimCh)] = dimmer;
      set.push(`DIM=${dimmer}`);
    }

    if (set.length === 0)
      return {
        content: [
          {
            type: "text",
            text: `Scanner ${scanner} has no color channels configured.`,
          },
        ],
      };

    saveToDisk();
    return {
      content: [
        {
          type: "text",
          text: `${sceneLabel(sceneIndex)} scanner ${scanner}: ${set.join(", ")}. Saved.`,
        },
      ],
    };
  },
);

// ── 6. set_position ─────────────────────────────────────────────────

server.tool(
  "set_position",
  "Set pan/tilt for a scanner using degrees (-90 to +90). Uses calibration data for DMX conversion. Auto-saves.",
  {
    bank: z.number().int().min(1).max(30),
    scene: z.number().int().min(1).max(8),
    scanner: z.number().int().min(1).max(12),
    pan: z.number().min(-90).max(90).describe("Pan angle in degrees"),
    tilt: z.number().min(-90).max(90).describe("Tilt angle in degrees"),
  },
  async ({ bank, scene, scanner, pan, tilt }) => {
    ensureLoaded();
    const sceneIndex = (bank - 1) * SCENES_PER_BANK + (scene - 1);
    const s = scanner - 1;
    const fd = getFileData();

    const pt = getPanTiltChannels(s);
    const set = [];

    if (pt.pan >= 0) {
      const dmx = degreeToDmx(s, pt.pan, pan);
      fd[getSceneChannelOffset(sceneIndex, s, pt.pan)] = dmx;
      set.push(`Pan=${pan}° (DMX ${dmx})`);
    }
    if (pt.tilt >= 0) {
      const dmx = degreeToDmx(s, pt.tilt, tilt);
      fd[getSceneChannelOffset(sceneIndex, s, pt.tilt)] = dmx;
      set.push(`Tilt=${tilt}° (DMX ${dmx})`);
    }

    if (set.length === 0)
      return {
        content: [
          {
            type: "text",
            text: `Scanner ${scanner} has no pan/tilt channels configured.`,
          },
        ],
      };

    saveToDisk();
    return {
      content: [
        {
          type: "text",
          text: `${sceneLabel(sceneIndex)} scanner ${scanner}: ${set.join(", ")}. Saved.`,
        },
      ],
    };
  },
);

// ── 7. copy_scanner ─────────────────────────────────────────────────

server.tool(
  "copy_scanner",
  "Copy all channel values from one scanner to another (same or different scene). Auto-saves.",
  {
    src_bank: z.number().int().min(1).max(30),
    src_scene: z.number().int().min(1).max(8),
    src_scanner: z.number().int().min(1).max(12),
    dst_bank: z.number().int().min(1).max(30),
    dst_scene: z.number().int().min(1).max(8),
    dst_scanner: z.number().int().min(1).max(12),
  },
  async ({
    src_bank,
    src_scene,
    src_scanner,
    dst_bank,
    dst_scene,
    dst_scanner,
  }) => {
    ensureLoaded();
    const srcIdx = (src_bank - 1) * SCENES_PER_BANK + (src_scene - 1);
    const dstIdx = (dst_bank - 1) * SCENES_PER_BANK + (dst_scene - 1);
    const fd = getFileData();

    for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
      fd[getSceneChannelOffset(dstIdx, dst_scanner - 1, ch)] =
        fd[getSceneChannelOffset(srcIdx, src_scanner - 1, ch)];
    }

    saveToDisk();
    return {
      content: [
        {
          type: "text",
          text: `Copied scanner ${src_scanner} (${sceneLabel(srcIdx)}) → scanner ${dst_scanner} (${sceneLabel(dstIdx)}). Saved.`,
        },
      ],
    };
  },
);

// ── 8. clear_scene ──────────────────────────────────────────────────

server.tool(
  "clear_scene",
  "Set all channels in a scene to 0. Auto-saves.",
  {
    bank: z.number().int().min(1).max(30),
    scene: z.number().int().min(1).max(8),
  },
  async ({ bank, scene }) => {
    ensureLoaded();
    const sceneIndex = (bank - 1) * SCENES_PER_BANK + (scene - 1);
    const offset = getSceneBlockOffset(sceneIndex);
    getFileData().fill(0, offset, offset + SCENE_RECORD_SIZE);
    saveToDisk();
    return {
      content: [
        { type: "text", text: `Cleared ${sceneLabel(sceneIndex)}. Saved.` },
      ],
    };
  },
);

// ── 9. get_channel_config ───────────────────────────────────────────

server.tool(
  "get_channel_config",
  "Show the channel attribute mapping (PAN, TILT, RED, GREEN, BLUE, etc.) for all 12 scanners.",
  {},
  async () => {
    ensureLoaded();
    const config = {};

    for (let s = 0; s < SCANNERS_PER_SCENE; s++) {
      const channels = {};
      for (let ch = 0; ch < CHANNELS_PER_SCANNER; ch++) {
        const name = channelAttrName(s, ch);
        if (name !== "NONE") channels[`ch${ch}`] = name;
      }
      if (Object.keys(channels).length > 0) {
        config[`scanner_${s + 1}`] = channels;
      }
    }

    return {
      content: [{ type: "text", text: JSON.stringify(config, null, 2) }],
    };
  },
);

// ── 10. list_scenes ─────────────────────────────────────────────────

server.tool(
  "list_scenes",
  "List all non-empty scenes in a bank (or all 30 banks).",
  {
    bank: z
      .number()
      .int()
      .min(1)
      .max(30)
      .optional()
      .describe("Bank to list (omit for all)"),
  },
  async ({ bank }) => {
    ensureLoaded();
    const startBank = bank ?? 1;
    const endBank = bank ?? NUM_BANKS;
    const results = [];

    for (let b = startBank; b <= endBank; b++) {
      for (let s = 0; s < SCENES_PER_BANK; s++) {
        const idx = (b - 1) * SCENES_PER_BANK + s;
        const data = getSceneData(idx);
        if (data && !data.isEmpty) {
          results.push(`Bank ${b} Scene ${s + 1}`);
        }
      }
    }

    if (results.length === 0)
      return {
        content: [{ type: "text", text: "No non-empty scenes found." }],
      };
    return {
      content: [
        {
          type: "text",
          text: `Non-empty scenes (${results.length}):\n${results.join("\n")}`,
        },
      ],
    };
  },
);

// ── 11. set_scanner_batch ───────────────────────────────────────────

server.tool(
  "set_scanner_batch",
  "Set multiple channel values for a scanner at once. Provide a JSON object mapping channel indices to DMX values. Auto-saves.",
  {
    bank: z.number().int().min(1).max(30),
    scene: z.number().int().min(1).max(8),
    scanner: z.number().int().min(1).max(12),
    channels: z
      .record(z.string(), z.number().int().min(0).max(255))
      .describe('Map of channel index to DMX value, e.g. {"0": 128, "5": 255}'),
  },
  async ({ bank, scene, scanner, channels }) => {
    ensureLoaded();
    const sceneIndex = (bank - 1) * SCENES_PER_BANK + (scene - 1);
    const s = scanner - 1;
    const fd = getFileData();
    const set = [];

    for (const [chStr, value] of Object.entries(channels)) {
      const ch = parseInt(chStr, 10);
      if (ch < 0 || ch > 15) continue;
      fd[getSceneChannelOffset(sceneIndex, s, ch)] = value;
      set.push(`ch${ch}(${channelAttrName(s, ch)})=${value}`);
    }

    saveToDisk();
    return {
      content: [
        {
          type: "text",
          text: `${sceneLabel(sceneIndex)} scanner ${scanner}: ${set.join(", ")}. Saved.`,
        },
      ],
    };
  },
);

// ── Start ───────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
