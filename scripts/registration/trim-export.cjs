// Match alpha >= 0.08 in the Godot shader (the first visible RGBA8 value is 21).
const ALPHA_MIN = 21

function trimExport(pixels, frame) {
  const {width, height, data} = pixels
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 4)
    throw Error('Invalid export image dimensions')
  let left = width, top = height, right = -1, bottom = -1
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] < ALPHA_MIN) continue
    left = Math.min(left, x); top = Math.min(top, y)
    right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  if (right < 0) throw Error('Cannot export an image without visible pixels')
  const crop = {x: left, y: top, width: right - left + 1, height: bottom - top + 1}
  const trimmed = new Uint8ClampedArray(crop.width * crop.height * 4)
  for (let y = 0; y < crop.height; y++) {
    const start = ((top + y) * width + left) * 4
    trimmed.set(data.subarray(start, start + crop.width * 4), y * crop.width * 4)
  }
  // Image coordinates point down, whereas the GS image frame points up.
  // Keep world units per pixel unchanged; cropping must never scale geometry.
  const unit = frame.height / height
  return {
    crop,
    pixels: {width: crop.width, height: crop.height, data: trimmed},
    frame: {...frame, left: frame.left + left * unit,
      bottom: frame.bottom + (height - bottom - 1) * unit,
      height: crop.height * unit},
  }
}

module.exports = {ALPHA_MIN, trimExport}
