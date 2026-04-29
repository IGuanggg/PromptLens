export const ASPECT_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'];

export const RATIO_OPTIONS = ASPECT_RATIOS;

export const presetSizes = {
  p720: {
    '1:1': [720, 720],
    '16:9': [1280, 720],
    '9:16': [720, 1280],
    '4:3': [960, 720],
    '3:4': [720, 960]
  },
  p1080: {
    '1:1': [1080, 1080],
    '16:9': [1920, 1080],
    '9:16': [1080, 1920],
    '4:3': [1440, 1080],
    '3:4': [1080, 1440]
  }
};

export const PRESET_SIZES = presetSizes;

export const RESOLUTION_PRESET_LABELS = {
  p720: '标准 720p',
  p1080: '高清 1080p'
};

export function migrateResolutionPreset(value) {
  if (value === 'p720' || value === 'standard') return 'p720';
  if (value === 'p1080' || value === 'hd' || value === 'ultra') return 'p1080';
  return 'p720';
}

export function migrateSizeMode(value) {
  if (value === 'auto') return 'follow-reference';
  if (value === 'follow-reference' || value === 'preset' || value === 'custom') return value;
  return 'preset';
}

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

  return ratios.reduce((best, cur) => {
    return Math.abs(cur.value - r) < Math.abs(best.value - r) ? cur : best;
  }, ratios[0]).name;
}

export function roundToEven(value) {
  return Math.max(16, Math.round(Number(value) / 2) * 2);
}

export function normalizeSize(width, height) {
  let w = Number(width);
  let h = Number(height);

  if (!Number.isFinite(w) || !Number.isFinite(h)) {
    throw new Error('尺寸必须是有效数字');
  }

  w = roundToEven(w);
  h = roundToEven(h);

  if (w < 16 || h < 16) {
    throw new Error('宽高不能小于 16px');
  }

  if (Math.max(w / h, h / w) > 3) {
    throw new Error('长宽比不能超过 3:1');
  }

  return {
    width: w,
    height: h,
    size: `${w}x${h}`,
    dashscopeSize: `${w}*${h}`
  };
}

export function getOutputSize({
  sizeMode,
  aspectRatio,
  resolutionPreset,
  customWidth,
  customHeight,
  referenceImage
}) {
  const mode = migrateSizeMode(sizeMode);
  const safeResolution = migrateResolutionPreset(resolutionPreset);

  if (mode === 'follow-reference') {
    const detectedRatio = detectRatio(referenceImage?.width, referenceImage?.height);
    const pair = presetSizes[safeResolution]?.[detectedRatio] || presetSizes.p720['1:1'];
    return {
      ...normalizeSize(pair[0], pair[1]),
      aspectRatio: detectedRatio,
      resolutionPreset: safeResolution,
      sizeMode: 'follow-reference'
    };
  }

  if (mode === 'preset') {
    const safeRatio = ASPECT_RATIOS.includes(aspectRatio) ? aspectRatio : '1:1';
    const pair = presetSizes[safeResolution]?.[safeRatio] || presetSizes.p720['1:1'];
    return {
      ...normalizeSize(pair[0], pair[1]),
      aspectRatio: safeRatio,
      resolutionPreset: safeResolution,
      sizeMode: 'preset'
    };
  }

  if (mode === 'custom') {
    return {
      ...normalizeSize(customWidth || 720, customHeight || 720),
      aspectRatio: 'custom',
      resolutionPreset: safeResolution,
      sizeMode: 'custom'
    };
  }

  return {
    ...normalizeSize(720, 720),
    aspectRatio: '1:1',
    resolutionPreset: 'p720',
    sizeMode: 'preset'
  };
}

export function mapSizeForOpenAIImages(size) {
  const supported = ['1024x1024', '1536x1024', '1024x1536', 'auto'];

  const fallbackMap = {
    '720x720': '1024x1024',
    '1080x1080': '1024x1024',
    '1280x720': '1536x1024',
    '1920x1080': '1536x1024',
    '960x720': '1536x1024',
    '1440x1080': '1536x1024',
    '720x1280': '1024x1536',
    '1080x1920': '1024x1536',
    '720x960': '1024x1536',
    '1080x1440': '1024x1536'
  };

  if (supported.includes(size)) return size;
  return fallbackMap[size] || '1024x1024';
}

export function computeOutputSize({
  sizeMode,
  quality,
  selectedRatio,
  customWidth,
  customHeight,
  refImage,
  resolutionPreset,
  aspectRatio,
  referenceImage
}) {
  return getOutputSize({
    sizeMode,
    aspectRatio: aspectRatio || selectedRatio,
    resolutionPreset: resolutionPreset || quality,
    customWidth,
    customHeight,
    referenceImage: referenceImage || refImage
  });
}
