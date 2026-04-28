import { ALLOWED_IMAGE_TYPES, formatBytes } from './fileSize.js';
import { createId } from './id.js';

/**
 * Default compression options.
 *
 * maxWidth / maxHeight  — if the image exceeds either dimension it is
 *                          scaled down proportionally.
 * quality               — JPEG output quality (0–1).
 * outputType            — output MIME type when compression is needed.
 * maxDataUrlBytes       — if the data URL exceeds this the image is
 *                          compressed to JPEG regardless of dimensions.
 */
export const DEFAULT_COMPRESS_OPTIONS = Object.freeze({
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.88,
  outputType: 'image/jpeg',
  maxDataUrlBytes: 8 * 1024 * 1024
});

/**
 * Read a File object as a data-URL string.
 */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

/**
 * Convert a Blob into a data-URL string.
 */
export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Blob 读取失败'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Get the width and height of an image (from a data URL, URL, or HTMLImageElement).
 */
export function getImageDimensions(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('无法读取图片尺寸'));
    if (source instanceof HTMLImageElement) {
      resolve({ width: source.naturalWidth, height: source.naturalHeight });
      return;
    }
    img.src = source;
  });
}

/**
 * Compress an image (given as a data URL) if it exceeds size / dimension limits.
 *
 * Returns:
 *   { dataUrl, width, height, originalWidth, originalHeight,
 *     sizeBytes, compressed: true|false, mimeType }
 */
export function compressImageIfNeeded(dataUrl, options = {}) {
  const opts = { ...DEFAULT_COMPRESS_OPTIONS, ...options };
  const { maxWidth, maxHeight, quality, outputType, maxDataUrlBytes } = opts;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const originalWidth = img.naturalWidth;
      const originalHeight = img.naturalHeight;

      // Decide target dimensions
      let targetWidth = originalWidth;
      let targetHeight = originalHeight;
      let needsResize = false;

      if (originalWidth > maxWidth || originalHeight > maxHeight) {
        needsResize = true;
        const ratio = Math.min(maxWidth / originalWidth, maxHeight / originalHeight);
        targetWidth = Math.round(originalWidth * ratio);
        targetHeight = Math.round(originalHeight * ratio);
      }

      // Check current data URL byte size
      const currentBytes = byteSizeOfDataUrl(dataUrl);

      // If no resize needed and the data URL is already small enough, return as-is
      if (!needsResize && currentBytes <= maxDataUrlBytes) {
        resolve({
          dataUrl,
          width: originalWidth,
          height: originalHeight,
          originalWidth,
          originalHeight,
          sizeBytes: currentBytes,
          compressed: false,
          mimeType: guessMimeFromDataUrl(dataUrl) || 'image/png'
        });
        return;
      }

      // Draw to canvas and export
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      // Try the preferred output type, fall back to JPEG if unsupported
      const mimeType = outputType || 'image/jpeg';
      const compressedDataUrl = canvas.toDataURL(mimeType, quality);
      const compressedBytes = byteSizeOfDataUrl(compressedDataUrl);

      // If still over limit, try once more with lower quality
      if (compressedBytes > maxDataUrlBytes && quality > 0.5) {
        const retryDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        const retryBytes = byteSizeOfDataUrl(retryDataUrl);
        resolve({
          dataUrl: retryDataUrl,
          width: targetWidth,
          height: targetHeight,
          originalWidth,
          originalHeight,
          sizeBytes: retryBytes,
          compressed: true,
          mimeType: 'image/jpeg'
        });
        return;
      }

      resolve({
        dataUrl: compressedDataUrl,
        width: targetWidth,
        height: targetHeight,
        originalWidth,
        originalHeight,
        sizeBytes: compressedBytes,
        compressed: true,
        mimeType
      });
    };

    img.onerror = () => reject(new Error('图片加载失败，无法压缩'));
    img.src = dataUrl;
  });
}

/**
 * Create a standardised image-metadata object from a source type and extra info.
 *
 * @param {"context-menu"|"upload"|"paste"|"drag-drop"|"url"|"blob"} source
 * @param {object} extra  — additional fields to merge
 */
export function createImageMeta(source, extra = {}) {
  return {
    id: createId('img'),
    url: '',
    dataUrl: '',
    displayUrl: '',
    source,
    fileName: '',
    mimeType: '',
    sizeBytes: 0,
    width: 0,
    height: 0,
    originalWidth: 0,
    originalHeight: 0,
    compressed: false,
    pageUrl: '',
    pageTitle: '',
    warning: '',
    recoverable: true,
    createdAt: Date.now(),
    ...extra
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function byteSizeOfDataUrl(dataUrl) {
  // Remove the "data:…;base64," prefix then compute base64 byte length
  const base64 = String(dataUrl || '').split(',')[1] || '';
  return Math.floor((base64.length * 3) / 4);
}

function guessMimeFromDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+)/);
  return match ? match[1] : '';
}
