// PRO file format constants
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
