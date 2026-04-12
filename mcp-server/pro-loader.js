/**
 * pro-loader.js
 *
 * Loads the existing browser-side constants.js, pro-format.js, and
 * color-utils.js into a shared vm context so the MCP server can reuse
 * exactly the same binary-format logic — zero duplicated code.
 *
 * Strategy: `const`/`let` in vm.runInContext don't become sandbox
 * properties, so we wrap each file in an IIFE that copies every
 * top-level declaration onto `this` (the sandbox).
 */

import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "..");

// Create a sandbox with the globals the browser scripts expect
const sandbox = { proFileData: null, Math, Array, console, Uint8Array };
const ctx = createContext(sandbox);

/**
 * Evaluate a browser-global script and hoist its top-level const/let/function
 * declarations onto the sandbox so they're accessible as ctx.XXX.
 */
function loadBrowserScript(file) {
  const src = readFileSync(join(PROJECT_ROOT, file), "utf-8");

  // Collect names declared at the top level (const X, let X, function X)
  const names = new Set();
  for (const m of src.matchAll(/^(?:const|let|var)\s+(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^function\s+(\w+)/gm)) names.add(m[1]);

  // Build a wrapper that evaluates the original source, then copies locals to `this`
  const exports = [...names].map((n) => `this.${n} = ${n};`).join("\n");
  const wrapped = `(function() {\n${src}\n${exports}\n}).call(this);`;

  runInContext(wrapped, ctx, { filename: file });
}

// Load the three shared files in order (same order as the browser loads them)
loadBrowserScript("constants.js");
loadBrowserScript("pro-format.js");
loadBrowserScript("color-utils.js");

// --- Convenience wrappers that operate on the shared context ---

/** Replace the in-memory PRO data (Uint8Array) */
export function setFileData(uint8) {
  ctx.proFileData = uint8;
}

/** Get a reference to the live Uint8Array */
export function getFileData() {
  return ctx.proFileData;
}

// Re-export every constant and function the server needs
export const SCENES_PER_BANK = ctx.SCENES_PER_BANK;
export const NUM_BANKS = ctx.NUM_BANKS;
export const SCANNERS_PER_SCENE = ctx.SCANNERS_PER_SCENE;
export const CHANNELS_PER_SCANNER = ctx.CHANNELS_PER_SCANNER;
export const TOTAL_SCENES = ctx.TOTAL_SCENES;
export const CONFIG_SCENE_INDEX = ctx.CONFIG_SCENE_INDEX;
export const CHANNEL_ATTRIBUTES = ctx.CHANNEL_ATTRIBUTES;
export const CALIBRATION_SCENES = ctx.CALIBRATION_SCENES;
export const SCENE_RECORD_SIZE = ctx.SCENE_RECORD_SIZE;

export const getSceneBlockOffset = ctx.getSceneBlockOffset;
export const getSceneChannelOffset = ctx.getSceneChannelOffset;
export const updateSceneMetadata = ctx.updateSceneMetadata;
export const getSceneData = ctx.getSceneData;
export const getChannelMapping = ctx.getChannelMapping;
export const setChannelMapping = ctx.setChannelMapping;
export const getCalibrationValue = ctx.getCalibrationValue;
export const degreeToDmx = ctx.degreeToDmx;
export const dmxToDegree = ctx.dmxToDegree;
export const getPanTiltChannels = ctx.getPanTiltChannels;
export const getRGBWChannels = ctx.getRGBWChannels;
export const getDimmerChannel = ctx.getDimmerChannel;
export const isWheelChannel = ctx.isWheelChannel;
export const hsvToRgb = ctx.hsvToRgb;

export const EXPECTED_FILE_SIZE = 131584;
export const PROJECT_ROOT_PATH = PROJECT_ROOT;
