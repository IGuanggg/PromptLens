export const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '5:4', '4:5', '21:9'];

export const RATIO_OPTIONS = ASPECT_RATIOS;

export const RESOLUTION_PRESETS = {
  '1k': { label: '1K / 标准', description: '1920 x 1080，适合快速生成和普通预览' },
  '2k': { label: '2K / 高清', description: '2560 x 1440，适合更清晰的作品输出' },
  '4k': { label: '4K / 超清', description: '3840 x 2160，适合高质量大图输出' }
};

export const presetSizes = {
  '1k': {
    '1:1': [1080, 1080], '16:9': [1920, 1080], '9:16': [1080, 1920],
    '4:3': [1440, 1080], '3:4': [1080, 1440],
    '3:2': [1620, 1080], '2:3': [1080, 1620],
    '5:4': [1350, 1080], '4:5': [1080, 1350],
    '21:9': [2520, 1080], '9:21': [1080, 2520],
    '2:1': [2160, 1080], '1:2': [1080, 2160],
    '3:1': [3240, 1080], '1:3': [1080, 3240]
  },
  '2k': {
    '1:1': [1440, 1440], '16:9': [2560, 1440], '9:16': [1440, 2560],
    '4:3': [1920, 1440], '3:4': [1440, 1920],
    '3:2': [2160, 1440], '2:3': [1440, 2160],
    '5:4': [1800, 1440], '4:5': [1440, 1800],
    '21:9': [3360, 1440], '9:21': [1440, 3360],
    '2:1': [2880, 1440], '1:2': [1440, 2880]
  },
  '4k': {
    '1:1': [2160, 2160], '16:9': [3840, 2160], '9:16': [2160, 3840],
    '4:3': [2880, 2160], '3:4': [2160, 2880],
    '3:2': [3240, 2160], '2:3': [2160, 3240],
    '5:4': [2700, 2160], '4:5': [2160, 2700],
    '21:9': [5040, 2160], '9:21': [2160, 5040],
    '2:1': [4320, 2160], '1:2': [2160, 4320]
  }
};

export const PRESET_SIZES = presetSizes;

export const RESOLUTION_PRESET_LABELS = Object.fromEntries(
  Object.entries(RESOLUTION_PRESETS).map(([k, v]) => [k, v.label])
);

export function migrateResolutionPreset(value) {
  if (!value) return '1k';
  return ({ p720: '1k', p1080: '1k', standard: '1k', hd: '2k', ultra: '4k', '1k': '1k', '2k': '2k', '4k': '4k' })[value] || '1k';
}

export function migrateSizeMode(value) {
  if (value === 'auto' || value === 'reference' || value === 'follow' || value === 'match-reference') return 'follow-reference';
  if (value === 'follow-reference' || value === 'preset' || value === 'custom') return value;
  return 'preset';
}

export function detectRatio(width, height) {
  if (!width || !height) return '1:1';
  const r = Number(width) / Number(height);
  const candidates = [
    { name: '1:1', value: 1 },
    { name: '16:9', value: 16 / 9 }, { name: '9:16', value: 9 / 16 },
    { name: '4:3', value: 4 / 3 },   { name: '3:4', value: 3 / 4 },
    { name: '3:2', value: 3 / 2 },   { name: '2:3', value: 2 / 3 },
    { name: '5:4', value: 5 / 4 },   { name: '4:5', value: 4 / 5 },
    { name: '21:9', value: 21 / 9 }, { name: '9:21', value: 9 / 21 },
    { name: '2:1', value: 2 / 1 },   { name: '1:2', value: 1 / 2 },
    { name: '3:1', value: 3 / 1 },   { name: '1:3', value: 1 / 3 }
  ];
  return candidates.reduce((best, cur) => Math.abs(cur.value - r) < Math.abs(best.value - r) ? cur : best, candidates[0]).name;
}

/** Standard 5-ratio bucket detector for "follow-reference" mode.
 *  Maps any image to 1:1, 16:9, 9:16, 4:3, or 3:4 only.
 *  Example: 1200x2369 (r=0.506) → 9:16 (not 1:2). */
export function detectStandardRatio(width, height) {
  const w = Number(width), h = Number(height);
  if (!w || !h) return '1:1';
  const r = w / h;

  // Square: 0.85 ~ 1.15
  if (r >= 0.85 && r <= 1.15) return '1:1';

  // Landscape: wider than 1.15
  if (r > 1.15) {
    if (r >= 1.55) return '16:9';  // 1.78 nominal
    return '4:3';                    // 1.33 nominal
  }

  // Portrait: narrower than 0.85
  if (r < 0.85) {
    if (r <= 0.65) return '9:16';  // 0.5625 nominal
    return '3:4';                    // 0.75 nominal
  }

  return '1:1';
}

export function roundToEven(value) {
  return Math.max(16, Math.round(Number(value) / 2) * 2);
}

export function normalizeSize(width, height) {
  let w = Number(width), h = Number(height);
  if (!Number.isFinite(w) || !Number.isFinite(h)) throw new Error('尺寸必须是有效数字');
  w = roundToEven(w); h = roundToEven(h);
  if (w < 16 || h < 16) throw new Error('宽高不能小于 16px');
  if (Math.max(w / h, h / w) > 3) throw new Error('长宽比不能超过 3:1');
  return { width: w, height: h, size: `${w}x${h}`, dashscopeSize: `${w}*${h}` };
}

export function getOutputSize({ sizeMode, aspectRatio, resolutionPreset, customWidth, customHeight, referenceImage }) {
  const mode = migrateSizeMode(sizeMode);
  const safeResolution = migrateResolutionPreset(resolutionPreset);
  const srcW = Number(referenceImage?.width || referenceImage?.originalWidth || 0);
  const srcH = Number(referenceImage?.height || referenceImage?.originalHeight || 0);
  const hasRef = srcW > 0 && srcH > 0;

  if (mode === 'follow-reference') {
    const detectedRatio = hasRef ? detectStandardRatio(srcW, srcH) : '1:1';
    const pair = presetSizes[safeResolution]?.[detectedRatio] || presetSizes['1k']['1:1'];
    return { ...normalizeSize(pair[0], pair[1]), aspectRatio: detectedRatio, resolutionPreset: safeResolution, sizeMode: 'follow-reference', hasReferenceImage: hasRef, sourceImageWidth: srcW || undefined, sourceImageHeight: srcH || undefined };
  }
  if (mode === 'preset') {
    const safeRatio = ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1';
    const pair = presetSizes[safeResolution]?.[safeRatio] || presetSizes['1k']['1:1'];
    return { ...normalizeSize(pair[0], pair[1]), aspectRatio: safeRatio, resolutionPreset: safeResolution, sizeMode: 'preset', hasReferenceImage: hasRef, sourceImageWidth: srcW || undefined, sourceImageHeight: srcH || undefined };
  }
  if (mode === 'custom') {
    return { ...normalizeSize(customWidth || 1080, customHeight || 1080), aspectRatio: 'custom', resolutionPreset: safeResolution, sizeMode: 'custom', hasReferenceImage: hasRef, sourceImageWidth: srcW || undefined, sourceImageHeight: srcH || undefined };
  }
  return { ...normalizeSize(1080, 1080), aspectRatio: '1:1', resolutionPreset: '1k', sizeMode: 'preset', hasReferenceImage: false };
}

export function mapSizeForOpenAIImages(size) {
  const supported = ['1024x1024', '1536x1024', '1024x1536', 'auto'];
  const fallbackMap = {
    '1080x1080': '1024x1024', '1440x1440': '1024x1024', '2160x2160': '1024x1024',
    '1920x1080': '1536x1024', '2560x1440': '1536x1024', '3840x2160': '1536x1024',
    '1080x1920': '1024x1536', '1440x2560': '1024x1536', '2160x3840': '1024x1536',
    '1440x1080': '1536x1024', '1920x1440': '1536x1024', '2880x2160': '1536x1024',
    '1080x1440': '1024x1536', '1440x1920': '1024x1536', '2160x2880': '1024x1536'
  };
  if (supported.includes(size)) return size;
  return fallbackMap[size] || '1024x1024';
}

export function getProviderSize({ requestedSize, dashscopeSize, sizeFormat }) {
  if (sizeFormat === '*') return dashscopeSize || requestedSize.replace('x', '*');
  if (sizeFormat === 'openai-mapped') return mapSizeForOpenAIImages(requestedSize);
  return requestedSize;
}

export function computeOutputSize({ sizeMode, quality, selectedRatio, customWidth, customHeight, refImage, resolutionPreset, aspectRatio, referenceImage }) {
  return getOutputSize({ sizeMode, aspectRatio: aspectRatio || selectedRatio, resolutionPreset: resolutionPreset || quality, customWidth, customHeight, referenceImage: referenceImage || refImage });
}
