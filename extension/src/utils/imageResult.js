import { ERROR_CODES, createAppError } from './errors.js';
import { getByPath, normalizeImagesFromResponse } from './objectPath.js';

export function normalizeImageResult(raw, provider, options = {}) {
  const width = Number(options.width || 0);
  const height = Number(options.height || 0);
  const labels = options.labels || ['参考风格', '创意变体', '结构草图', '线稿风格'];
  const source = resolveImageSource(raw, options.responseMap);
  const list = Array.isArray(source) ? source : [source].filter(Boolean);

  const result = {
    images: list.map((item, index) => normalizeImageItem(item, {
      index,
      provider,
      width,
      height,
      label: labels[index] || `结果 ${index + 1}`
    })).filter((item) => item.url),
    provider,
    raw
  };
  if (options.requireImages && !result.images.length) {
    throw createAppError({
      code: ERROR_CODES.INVALID_RESPONSE,
      provider,
      raw,
      retryable: false
    });
  }
  return result;
}

export function normalizeOpenAIImageResult(raw, provider, options = {}) {
  const result = normalizeImageResult(raw, provider, {
    ...options,
    responseMap: options.responseMap || { images: 'data' }
  });
  if (!result.images.length) {
    throw createAppError({
      code: ERROR_CODES.INVALID_RESPONSE,
      provider,
      raw,
      retryable: false
    });
  }
  return result;
}

export function normalizeReplicateResult(raw, provider, options = {}) {
  return normalizeImageResult(raw?.output || raw, provider, options);
}

function resolveImageSource(raw, responseMap = {}) {
  if (!raw) return [];
  const mapped = normalizeImagesFromResponse(raw, responseMap);
  if (mapped.length) return mapped;
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw.results)) return raw.results;
  if (Array.isArray(raw.images)) return raw.images;
  if (Array.isArray(raw.data)) return raw.data;
  if (Array.isArray(raw.output)) return raw.output;
  if (raw.image) return raw.image;
  if (raw.url || raw.b64_json || raw.imageUrl || raw.src) return raw;
  return [];
}

function normalizeImageItem(item, context) {
  if (typeof item === 'string') {
    return createImageItem(item, context);
  }

  const url = item.url ||
    item.imageUrl ||
    item.src ||
    item.uri ||
    item.output ||
    b64ToDataUrl(item.b64_json || item.base64 || item.image_base64 || item.bytesBase64Encoded);

  return {
    id: String(item.id || item.uuid || `${context.provider}_${Date.now()}_${context.index}`),
    url,
    thumbUrl: item.thumbUrl || item.thumbnail || item.thumbnailUrl || url,
    label: item.label || context.label,
    provider: context.provider,
    width: Number(item.width || context.width || 0),
    height: Number(item.height || context.height || 0)
  };
}

function createImageItem(url, context) {
  return {
    id: `${context.provider}_${Date.now()}_${context.index}`,
    url,
    thumbUrl: url,
    label: context.label,
    provider: context.provider,
    width: context.width,
    height: context.height
  };
}

function b64ToDataUrl(value) {
  if (!value) return '';
  if (String(value).startsWith('data:')) return value;
  return `data:image/png;base64,${value}`;
}
