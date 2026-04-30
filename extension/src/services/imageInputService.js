import {
  fileToDataUrl,
  compressImageIfNeeded,
  createImageMeta,
  DEFAULT_COMPRESS_OPTIONS
} from '../utils/imageConvert.js';
import {
  ALLOWED_IMAGE_TYPES,
  MAX_RAW_FILE_BYTES,
  validateFileSize,
  formatBytes
} from '../utils/fileSize.js';

// ---------------------------------------------------------------------------
// File validation
// ---------------------------------------------------------------------------

/**
 * Validate a File object for type and size.
 * Returns `{ ok, message }`.
 */
export function validateImageFile(file) {
  if (!file) {
    return { ok: false, message: '未选择文件' };
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    return { ok: false, message: `不支持的图片类型（${file.type || '未知'}），支持 PNG / JPEG / WebP / GIF` };
  }
  return validateFileSize(file, MAX_RAW_FILE_BYTES);
}

// ---------------------------------------------------------------------------
// Normalize any image input into a standard currentImage shape
// ---------------------------------------------------------------------------

/**
 * Normalise a variety of image-input shapes into the upgraded currentImage structure.
 *
 * Accepted inputs:
 *  - a legacy payload from background.js (with srcUrl/url/pageUrl…)
 *  - an already-upgraded currentImage object
 *  - a partial imageMeta object
 */
export function normalizeImageInput(input) {
  if (!input) return null;

  // Already matches the new shape
  if (input.id && typeof input.displayUrl !== 'undefined') {
    return { ...createImageMeta(input.source || 'url'), ...input };
  }

  // Legacy payload from background.js context-menu
  const url = input?.url || input?.srcUrl || '';
  const isBlob = String(url || '').startsWith('blob:');

  return {
    ...createImageMeta(input?.source || 'context-menu'),
    url,
    dataUrl: input?.dataUrl || '',
    displayUrl: input?.dataUrl || (isBlob ? '' : url),
    pageUrl: input?.pageUrl || '',
    pageTitle: input?.pageTitle || '',
    recoverable: input?.recoverable !== undefined ? input.recoverable : !isBlob,
    warning: input?.warning || (isBlob ? 'blob 图片无法跨上下文访问，请尝试截图粘贴或本地上传' : ''),
    createdAt: input?.createdAt || Date.now(),
    ...input
  };
}

// ---------------------------------------------------------------------------
// Handle file-based inputs (upload / drop)
// ---------------------------------------------------------------------------

/**
 * Process a file from <input type="file"> or drag-and-drop.
 *
 * Flow:
 *  1. validate type + size
 *  2. FileReader → data URL
 *  3. compress if needed
 *  4. build currentImage object
 */
export async function handleLocalFile(file, source = 'upload') {
  const validation = validateImageFile(file);
  if (!validation.ok) {
    throw new Error(validation.message);
  }

  const dataUrl = await fileToDataUrl(file);
  const dims = await getImageDimensionsSafe(dataUrl);

  const compressed = await compressImageIfNeeded(dataUrl);
  const displayUrl = compressed.dataUrl;

  return {
    ...createImageMeta(source),
    url: '',
    dataUrl: compressed.dataUrl,
    displayUrl,
    fileName: file.name || '',
    mimeType: compressed.mimeType || file.type,
    sizeBytes: compressed.sizeBytes,
    width: compressed.width,
    height: compressed.height,
    originalWidth: compressed.originalWidth,
    originalHeight: compressed.originalHeight,
    compressed: compressed.compressed,
    recoverable: true,
    warning: compressed.compressed
      ? `图片已自动压缩（${formatBytes(compressed.sizeBytes)}），原始尺寸 ${compressed.originalWidth}x${compressed.originalHeight}`
      : ''
  };
}

// Alias for drag-drop
export async function handleDropFile(file) {
  return handleLocalFile(file, 'drag-drop');
}

// ---------------------------------------------------------------------------
// Handle paste events
// ---------------------------------------------------------------------------

/**
 * Process a ClipboardEvent — expects an image on the clipboard.
 *
 * Rules:
 *  1. If clipboard has image file(s), read the first one.
 *  2. If clipboard has text that looks like an image URL, return as URL import.
 *  3. Otherwise throw with a helpful message.
 */
export async function handlePasteEvent(event) {
  const items = event.clipboardData?.items;
  if (!items || items.length === 0) {
    throw new Error('剪贴板中没有内容');
  }

  // 1. Look for image files first
  for (const item of items) {
    if (item.type && ALLOWED_IMAGE_TYPES.has(item.type)) {
      const file = item.getAsFile();
      if (!file) continue;
      return handleLocalFile(file, 'paste');
    }
  }

  // 2. Look for text that looks like an image URL
  const text = event.clipboardData.getData('text/plain').trim();
  if (text && /^https?:\/\/.+\.(png|jpe?g|webp|gif)(\?.*)?$/i.test(text)) {
    return setImageFromUrl(text, { source: 'url', recoverable: true });
  }

  // 3. Nothing usable
  throw new Error('剪贴板中没有图片，请先复制或截图一张图片');
}

// ---------------------------------------------------------------------------
// Set image from data URL
// ---------------------------------------------------------------------------

/**
 * Build a currentImage from a data URL string.
 */
export async function setImageFromDataUrl(dataUrl, meta = {}) {
  const compressed = await compressImageIfNeeded(dataUrl);
  const dims = await getImageDimensionsSafe(compressed.dataUrl || dataUrl);

  return {
    ...createImageMeta(meta.source || 'paste', meta),
    url: '',
    dataUrl: compressed.dataUrl || dataUrl,
    displayUrl: compressed.dataUrl || dataUrl,
    fileName: meta.fileName || '',
    mimeType: compressed.mimeType || guessMimeType(dataUrl),
    sizeBytes: compressed.sizeBytes,
    width: compressed.width || dims.width,
    height: compressed.height || dims.height,
    originalWidth: compressed.originalWidth || dims.width,
    originalHeight: compressed.originalHeight || dims.height,
    compressed: compressed.compressed,
    recoverable: meta.recoverable !== false,
    warning: compressed.compressed
      ? `图片已自动压缩（${formatBytes(compressed.sizeBytes)}）`
      : (meta.warning || ''),
    pageUrl: meta.pageUrl || '',
    pageTitle: meta.pageTitle || ''
  };
}

// ---------------------------------------------------------------------------
// Set image from a URL (context-menu, url import, blob)
// ---------------------------------------------------------------------------

/**
 * Build a currentImage from a regular URL.
 * Does NOT fetch the URL — only records metadata.
 *
 * For blob: URLs, marks as unrecoverable with a warning.
 * For http(s): URLs, leaves it as-is (hotlink protection may apply).
 */
export async function setImageFromUrl(url, meta = {}) {
  const isBlob = String(url || '').startsWith('blob:');
  const source = meta.source || (isBlob ? 'blob' : 'url');
  const displayUrl = meta.dataUrl || (isBlob ? '' : url);

  // Try to capture image dimensions immediately for aspect ratio detection
  let width = meta.width || 0, height = meta.height || 0;
  if ((!width || !height) && displayUrl) {
    try {
      const dims = await getImageDimensionsSafe(displayUrl);
      width = dims.width;
      height = dims.height;
    } catch { /* ignore */ }
  }

  return {
    ...createImageMeta(source, meta),
    url,
    dataUrl: meta.dataUrl || '',
    displayUrl,
    width,
    height,
    originalWidth: meta.originalWidth || width,
    originalHeight: meta.originalHeight || height,
    recoverable: meta.recoverable !== undefined ? meta.recoverable : !isBlob,
    warning: meta.warning
      || (isBlob ? '当前 blob 图片无法直接恢复，请尝试截图粘贴或本地上传' : ''),
    fileName: meta.fileName || '',
    pageUrl: meta.pageUrl || '',
    pageTitle: meta.pageTitle || ''
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getImageDimensionsSafe(src) {
  try {
    const img = new Image();
    return await new Promise((resolve, reject) => {
      img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => reject(new Error('无法获取图片尺寸'));
      img.src = src;
    });
  } catch {
    return { width: 0, height: 0 };
  }
}

function guessMimeType(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+)/);
  return match ? match[1] : 'image/png';
}
