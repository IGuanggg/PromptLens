/** Supported image MIME types for file upload / drop / paste */
export const ALLOWED_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif'
]);

/** Max raw file size before compression: 15 MB */
export const MAX_RAW_FILE_BYTES = 15 * 1024 * 1024;

/**
 * Format bytes into a human-readable string (e.g. "1.5 MB").
 */
export function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let index = 0;
  let size = value;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size.toFixed(index > 0 ? 1 : 0)} ${units[index]}`;
}

/**
 * Check whether a File's size is within the allowed limit.
 * Returns an object with `{ ok, message }`.
 */
export function validateFileSize(file, maxBytes = MAX_RAW_FILE_BYTES) {
  if (!file) {
    return { ok: false, message: '无效文件' };
  }
  if (file.size > maxBytes) {
    return {
      ok: false,
      message: `图片过大（${formatBytes(file.size)}），单张最大支持 ${formatBytes(maxBytes)}`
    };
  }
  return { ok: true, message: '' };
}
