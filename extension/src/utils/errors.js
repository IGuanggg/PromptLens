import { maskSecret } from './mask.js';

export const ERROR_CODES = {
  CONFIG_MISSING: 'CONFIG_MISSING',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  TASK_FAILED: 'TASK_FAILED',
  IMAGE_DOWNLOAD_FAILED: 'IMAGE_DOWNLOAD_FAILED',
  UNKNOWN_ERROR: 'UNKNOWN_ERROR'
};

const DEFAULT_MESSAGES = {
  [ERROR_CODES.CONFIG_MISSING]: '接口配置缺失，请先在设置中完成配置。',
  [ERROR_CODES.UNAUTHORIZED]: 'API Key 无效或无权限访问。',
  [ERROR_CODES.RATE_LIMITED]: '请求过于频繁，请稍后再试。',
  [ERROR_CODES.TIMEOUT]: '请求超时，请检查网络或稍后重试。',
  [ERROR_CODES.NETWORK_ERROR]: '网络连接失败，请检查接口地址或网络状态。',
  [ERROR_CODES.INVALID_RESPONSE]: '接口响应结构异常，无法解析图片结果。',
  [ERROR_CODES.TASK_FAILED]: '异步任务执行失败。',
  [ERROR_CODES.IMAGE_DOWNLOAD_FAILED]: '图片下载失败。',
  [ERROR_CODES.UNKNOWN_ERROR]: '未知错误。'
};

export function createAppError({ code = ERROR_CODES.UNKNOWN_ERROR, message, provider = '', status = 0, raw = null, retryable = false } = {}) {
  const error = new Error(message || DEFAULT_MESSAGES[code] || DEFAULT_MESSAGES[ERROR_CODES.UNKNOWN_ERROR]);
  error.code = code;
  error.provider = provider;
  error.status = Number(status || 0);
  error.raw = raw;
  error.retryable = Boolean(retryable);
  return error;
}

export function normalizeError(error, fallback = ERROR_CODES.UNKNOWN_ERROR) {
  if (error?.code) {
    return {
      code: error.code,
      message: error.message || DEFAULT_MESSAGES[error.code] || DEFAULT_MESSAGES[fallback],
      provider: error.provider || '',
      status: Number(error.status || 0),
      raw: error.raw || null,
      retryable: Boolean(error.retryable)
    };
  }

  return {
    code: fallback,
    message: error?.message || String(error || '') || DEFAULT_MESSAGES[fallback],
    provider: '',
    status: 0,
    raw: error || null,
    retryable: false
  };
}

export function getErrorMessage(error, fallback = '操作失败') {
  if (!error) return fallback;
  return error.message || String(error) || fallback;
}

export function getUserErrorMessage(error) {
  const normalized = normalizeError(error);
  return normalized.message;
}

export function sanitizeErrorLog(value) {
  return JSON.stringify(value, (key, current) => {
    if (String(key).toLowerCase().includes('apikey') || String(key).toLowerCase() === 'authorization') {
      return maskSecret(current);
    }
    if (typeof current === 'string' && /bearer\s+[a-z0-9._-]+/i.test(current)) {
      return current.replace(/bearer\s+([a-z0-9._-]+)/i, (_, token) => `Bearer ${maskSecret(token)}`);
    }
    return current;
  }, 2);
}

