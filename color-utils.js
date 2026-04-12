// HSV to RGB conversion (shared by color picker rendering and interaction)
function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// Convert RGB to a position on the 10x10 HSV color grid
function rgbToColorPickerPosition(r, g, b) {
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

  const gridSize = 10;
  const xIndex = Math.round((hue / 360) * (gridSize - 1));
  const yIndex = Math.round((1 - value) * (gridSize - 1));

  return {
    x: xIndex / (gridSize - 1),
    y: yIndex / (gridSize - 1),
  };
}
