/**
 * Image output size computation utilities.
 */

export const RATIO_OPTIONS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

/** Preset sizes by quality tier and ratio: [width, height] */
export const PRESET_SIZES = {
  standard: {
    '1:1': [1024, 1024],
    '4:3': [1024, 768],
    '3:4': [768, 1024],
    '16:9': [1536, 864],
    '9:16': [864, 1536]
  },
  hd: {
    '1:1': [1536, 1536],
    '4:3': [1536, 1152],
    '3:4': [1152, 1536],
    '16:9': [2048, 1152],
    '9:16': [1152, 2048]
  },
  ultra: {
    '1:1': [2048, 2048],
    '4:3': [2048, 1536],
    '3:4': [1536, 2048],
    '16:9': [2560, 1440],
    '9:16': [1440, 2560]
  }
};

/** Fallback size when computation fails */
const FALLBACK = { width: 1024, height: 1024 };

/**
 * Normalize width and height to multiples of 16.
 * Throws if aspect ratio exceeds 3:1.
 */
export function normalizeSize(w, h) {
  const round16 = (n) => Math.max(16, Math.round(Number(n || 0) / 16) * 16);
  const width = round16(w);
  const height = round16(h);
  if (width <= 0 || height <= 0) throw new Error('尺寸必须大于 0');
  if (Math.max(width / height, height / width) > 3) {
    throw new Error('长宽比不能超过 3:1');
  }
  return { width, height };
}

/**
 * Detect the closest named ratio for a given width/height.
 */
export function detectRatio(width, height) {
  if (!width || !height) return '1:1';
  const r = Number(width) / Number(height);
  const ratios = [
    { name: '1:1', value: 1 },
    { name: '4:3', value: 4 / 3 },
    { name: '3:4', value: 3 / 4 },
    { name: '16:9', value: 16 / 9 },
    { name: '9:16', value: 9 / 16 }
  ];
  return ratios.reduce(
    (best, cur) => (Math.abs(cur.value - r) < Math.abs(best.value - r) ? cur : best),
    ratios[0]
  ).name;
}

/**
 * Auto mode follows the reference image orientation, not its exact aspect.
 * Landscape -> 16:9, portrait -> 9:16, near-square -> 1:1.
 */
export function detectAutoRatio(width, height) {
  if (!width || !height) return '1:1';
  const ratio = Number(width) / Number(height);
  if (ratio >= 1.12) return '16:9';
  if (ratio <= 0.89) return '9:16';
  return '1:1';
}

/**
 * Compute the final output size based on the configured size mode.
 *
 * @param {object} opts
 * @param {string} opts.sizeMode       - "auto" | "preset" | "custom"
 * @param {string} opts.quality        - "standard" | "hd" | "ultra"
 * @param {string} opts.selectedRatio  - e.g. "1:1"
 * @param {number} opts.customWidth
 * @param {number} opts.customHeight
 * @param {object} [opts.refImage]     - { width, height } of reference image
 * @returns {{width: number, height: number}}
 */
export function computeOutputSize({ sizeMode, quality, selectedRatio, customWidth, customHeight, refImage }) {
  try {
    const q = PRESET_SIZES[quality] ? quality : 'standard';

    if (sizeMode === 'auto' && refImage?.width && refImage?.height) {
      const ratio = detectAutoRatio(refImage.width, refImage.height);
      const [w, h] = PRESET_SIZES[q][ratio] || PRESET_SIZES[q]['1:1'];
      return normalizeSize(w, h);
    }

    if (sizeMode === 'preset') {
      const ratio = selectedRatio || '1:1';
      const [w, h] = PRESET_SIZES[q][ratio] || PRESET_SIZES[q]['1:1'];
      return normalizeSize(w, h);
    }

    if (sizeMode === 'custom') {
      return normalizeSize(customWidth || 1024, customHeight || 1024);
    }

    // Fallback for "auto" without refImage
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}
