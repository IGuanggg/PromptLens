/**
 * Debug log storage backed by chrome.storage.local.
 *
 * Keys:
 *   promptpilotLogs      — array of log entries (newest first)
 *   promptpilotLastCall  — last API call summary
 */

import { createId } from '../utils/id.js';
import { maskApiKey, maskAuthorization, maskBase64Image, maskHeaders } from '../utils/mask.js';
import { isQuotaExceededError } from '../utils/sanitize.js';
import { safeStringify, truncateString } from '../utils/safeJson.js';

const LOG_KEY = 'promptpilotLogs';
const LAST_CALL_KEY = 'promptpilotLastCall';
const DEFAULT_MAX = 200;

// ── In-memory state ──
let logs = [];
let maxCount = DEFAULT_MAX;
let flushTimer = null;
let initialized = false;
let settingsRef = null; // { advanced: { enableDebugMode, saveDebugLogs, logRequestBody, logResponseBody } }

// ── Public API ──

/** Call once on startup to load existing logs from storage. */
export async function initLogService(settings) {
  if (settings) setLogSettings(settings);
  const data = await chrome.storage.local.get([LOG_KEY, LAST_CALL_KEY]);
  logs = Array.isArray(data[LOG_KEY]) ? data[LOG_KEY] : [];
  initialized = true;
}

/** Update the settings reference used for filtering/console gating. */
export function setLogSettings(settings) {
  settingsRef = settings || null;
}

/** Set the max log count. */
export function setLogLimit(n) {
  maxCount = Number(n) || DEFAULT_MAX;
}

/**
 * Append a log entry.
 * - Always saved: warn, error
 * - Saved if saveDebugLogs=true: info
 * - Never saved if saveDebugLogs=false: info, debug
 * Console output gated by enableDebugMode.
 */
export function appendLog(entry) {
  if (!initialized) {
    // Lazy init in background (can't await in service worker top-level)
    logs = [];
    initialized = true;
  }

  const entry_ = buildEntry(entry);

  // Console output
  const adv = settingsRef?.advanced || {};
  if (adv.enableDebugMode) {
    const method = { debug: console.debug, info: console.info, warn: console.warn, error: console.error };
    const fn = method[entry_.level] || console.log;
    fn(`[PromptPilot][${entry_.level.toUpperCase()}][${entry_.event || '-'}] ${entry_.message || ''}`,
      entry_.data ? entry_.data : '');
  }

  // Persistence gating
  if (!shouldSave(entry_.level)) return;

  logs.unshift(entry_);
  if (logs.length > maxCount) logs = logs.slice(0, maxCount);
  scheduleFlush();
}

/** Update lastApiCall in storage. */
export async function updateLastCall(call) {
  const entry = {
    id: call.id || createId('call'),
    apiType: call.apiType || 'system',
    provider: call.provider || '',
    endpoint: call.endpoint || '',
    method: call.method || '',
    status: call.status || 0,
    durationMs: call.durationMs || 0,
    success: call.success !== false,
    message: call.message || '',
    createdAt: call.createdAt || Date.now()
  };
  try {
    await chrome.storage.local.set({ [LAST_CALL_KEY]: entry });
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    await shrinkLogsForQuota();
    try {
      await chrome.storage.local.set({ [LAST_CALL_KEY]: entry });
    } catch {
      // lastCall is diagnostic only; never fail the user action because storage is full.
    }
  }
  return entry;
}

/** Get the last API call. */
export async function getLastCall() {
  const data = await chrome.storage.local.get(LAST_CALL_KEY);
  return data[LAST_CALL_KEY] || null;
}

/**
 * Get logs, optionally filtered. Returns newest first.
 */
export async function getLogs(filters = {}) {
  if (!initialized) await initLogService();
  let result = [...logs];

  if (filters.level && filters.level !== 'all') {
    result = result.filter((l) => l.level === filters.level);
  }
  if (filters.apiType && filters.apiType !== 'all') {
    result = result.filter((l) => l.apiType === filters.apiType);
  }
  if (filters.provider && filters.provider !== 'all') {
    result = result.filter((l) => l.provider === filters.provider);
  }
  if (filters.event && filters.event !== 'all') {
    result = result.filter((l) => l.event === filters.event);
  }
  if (filters.keyword) {
    const kw = filters.keyword.toLowerCase();
    result = result.filter((l) =>
      (l.message || '').toLowerCase().includes(kw) ||
      (l.event || '').toLowerCase().includes(kw) ||
      (l.provider || '').toLowerCase().includes(kw)
    );
  }
  if (filters.timeFrom) {
    result = result.filter((l) => l.createdAt >= filters.timeFrom);
  }
  if (filters.timeTo) {
    result = result.filter((l) => l.createdAt <= filters.timeTo);
  }

  return result;
}

/** Clear all logs from memory and storage. */
export async function clearLogs() {
  logs = [];
  await chrome.storage.local.remove(LOG_KEY);
}

/** Get current log count. */
export function getLogCount() {
  return logs.length;
}

/** Force flush to storage immediately. */
export async function flushLogs() {
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  try {
    await chrome.storage.local.set({ [LOG_KEY]: logs });
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    await shrinkLogsForQuota();
  }
}

// ── Internal ──

function buildEntry(raw) {
  const now = Date.now();
  const adv = settingsRef?.advanced || {};

  // Sanitize sensitive data
  let requestPreview = raw.requestPreview || undefined;
  let responsePreview = raw.responsePreview || undefined;

  if (requestPreview) {
    requestPreview = sanitizePreview(requestPreview, adv.logRequestBody);
  }
  if (responsePreview) {
    responsePreview = sanitizePreview(responsePreview, adv.logResponseBody);
  }

  return {
    id: raw.id || createId('log'),
    level: raw.level || 'info',
    apiType: raw.apiType || 'system',
    event: raw.event || '',
    provider: raw.provider || '',
    endpoint: raw.endpoint || '',
    method: raw.method || '',
    status: raw.status || 0,
    durationMs: raw.durationMs || 0,
    success: raw.success === undefined ? raw.level !== 'error' : raw.success !== false,
    message: raw.message || '',
    requestPreview,
    responsePreview,
    error: raw.error ? sanitizePreview(raw.error, false) : undefined,
    data: raw.data || undefined,
    createdAt: raw.createdAt || now
  };
}

function sanitizePreview(obj, includeBody) {
  if (!obj || typeof obj !== 'object') return obj;

  const safe = { ...obj };

  // Mask headers
  if (safe.headers) safe.headers = maskHeaders(safe.headers);

  // Mask URL query params (api keys)
  if (safe.url && typeof safe.url === 'string') {
    safe.url = safe.url.replace(/([?&](key|api_key|apiKey|token)=)([^&]+)/gi,
      (_, prefix, _name, value) => prefix + maskApiKey(value));
  }

  // Mask body
  if (safe.body) {
    if (includeBody) {
      safe.body = maskBase64InBody(safe.body);
    } else {
      safe.body = typeof safe.body === 'string'
        ? (safe.body.length > 100 ? safe.body.slice(0, 100) + '...[truncated]' : safe.body)
        : '<omitted>';
    }
  }

  // Mask response text
  if (safe.text && typeof safe.text === 'string') {
    safe.text = includeBody
      ? maskBase64Image(safe.text)
      : (safe.text.length > 200 ? safe.text.slice(0, 200) + '...[truncated]' : safe.text);
  }

  // Mask any apiKey field
  if (safe.apiKey) safe.apiKey = maskApiKey(safe.apiKey);
  if (safe.authorization) safe.authorization = maskAuthorization(safe.authorization);

  return safe;
}

function maskBase64InBody(body) {
  if (typeof body === 'string') return maskBase64Image(body);
  if (typeof body === 'object') {
    try {
      const json = JSON.stringify(body);
      const masked = maskBase64Image(json);
      if (masked.length > 2000) return masked.slice(0, 2000) + '...[truncated]';
      return masked;
    } catch {
      return '<unserializable body>';
    }
  }
  return body;
}

function shouldSave(level) {
  const adv = settingsRef?.advanced || {};
  // warn and error always saved
  if (level === 'warn' || level === 'error') return true;
  // info/debug only saved if saveDebugLogs is true
  return adv.saveDebugLogs === true;
}

function scheduleFlush() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    chrome.storage.local.set({ [LOG_KEY]: logs }).catch((error) => {
      if (isQuotaExceededError(error)) shrinkLogsForQuota().catch(() => {});
    });
  }, 500);
}

async function shrinkLogsForQuota() {
  logs = logs.slice(0, Math.min(logs.length, 40)).map((entry) => ({
    id: entry.id,
    level: entry.level,
    apiType: entry.apiType,
    event: entry.event,
    provider: entry.provider,
    endpoint: entry.endpoint,
    method: entry.method,
    status: entry.status,
    durationMs: entry.durationMs,
    success: entry.success,
    message: entry.message,
    data: entry.data,
    createdAt: entry.createdAt
  }));
  try {
    await chrome.storage.local.set({ [LOG_KEY]: logs });
  } catch {
    logs = [];
    await chrome.storage.local.remove(LOG_KEY).catch(() => {});
  }
}
