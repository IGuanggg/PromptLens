import { ERROR_CODES, createAppError, normalizeError } from '../utils/errors.js';
import { appendLog } from './logService.js';

export async function downloadImage(image, index = 1) {
  const url = typeof image === 'string' ? image : image?.url;
  const filename = createImageFilename(index);

  appendLog({
    level: 'info',
    apiType: 'system',
    event: 'DOWNLOAD_START',
    message: `下载图片 ${index}: ${filename}`
  });

  try {
    if (!url) {
      throw createAppError({
        code: ERROR_CODES.IMAGE_DOWNLOAD_FAILED,
        message: '图片地址为空，无法下载。',
        raw: image,
        retryable: false
      });
    }

    await chrome.downloads.download({ url, filename, saveAs: false });

    appendLog({
      level: 'info',
      apiType: 'system',
      event: 'DOWNLOAD_SUCCESS',
      message: `下载完成: ${filename}`
    });

    return { success: true, filename, error: null };
  } catch (error) {
    const appError = error?.code ? error : createAppError({
      code: ERROR_CODES.IMAGE_DOWNLOAD_FAILED,
      message: error?.message || '图片下载失败。',
      raw: error,
      retryable: true
    });

    appendLog({
      level: 'error',
      apiType: 'system',
      event: 'DOWNLOAD_ERROR',
      message: `下载失败: ${appError.message}`
    });

    return { success: false, filename, error: normalizeError(appError, ERROR_CODES.IMAGE_DOWNLOAD_FAILED) };
  }
}

export async function downloadAllImages(images) {
  appendLog({
    level: 'info',
    apiType: 'system',
    event: 'DOWNLOAD_ALL_START',
    message: `批量下载 ${images.length} 张图片`
  });

  const results = [];
  for (let index = 0; index < images.length; index += 1) {
    results.push(await downloadImage(images[index], index + 1));
  }

  const succeeded = results.filter((r) => r.success).length;
  appendLog({
    level: 'info',
    apiType: 'system',
    event: 'DOWNLOAD_ALL_DONE',
    message: `批量下载完成: ${succeeded}/${results.length}`
  });

  return results;
}

function createImageFilename(index) {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate())
  ].join('') + '_' + [
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join('');
  return `promptpilot_${stamp}_${pad(index)}.png`;
}

function pad(value) {
  return String(value).padStart(2, '0');
}
