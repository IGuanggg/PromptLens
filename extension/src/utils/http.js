import { ERROR_CODES, createAppError } from './errors.js';
import { maskHeaders, maskRequestBody } from './mask.js';
import { truncateJson } from './safeJson.js';
import { appendLog, updateLastCall } from '../services/logService.js';

/**
 * Unified JSON request with built-in debug logging.
 *
 * @param {object} opts
 * @param {string} opts.apiType   - "prompt" | "image" | "system"
 * @param {string} opts.provider  - e.g. "openai-compatible"
 * @param {string} opts.url
 * @param {string} [opts.method]
 * @param {object} [opts.headers]
 * @param {string|FormData} [opts.body]
 * @param {number} [opts.timeout]
 */
export async function requestJson({ apiType = 'system', provider = '', url, method = 'GET', headers = {}, body, timeout = 60000 }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // ── LOG: request start ──
  appendLog({
    level: 'info',
    apiType,
    event: 'API_REQUEST_START',
    provider,
    endpoint: url,
    method,
    message: `${method} ${url}`,
    requestPreview: {
      url,
      method,
      headers: { ...headers },
      body
    }
  });

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal
    });
    const text = await response.text();
    let raw = parseResponse(text, response);

    const elapsedMs = Date.now() - startedAt;
    const success = response.ok;

    // ── LOG: response ──
    const logLevel = success ? 'info' : 'warn';
    appendLog({
      level: logLevel,
      apiType,
      event: success ? 'API_REQUEST_SUCCESS' : 'API_REQUEST_ERROR',
      provider,
      endpoint: url,
      method,
      status: response.status,
      durationMs: elapsedMs,
      success,
      message: `${response.status} ${method} ${url} (${elapsedMs}ms)`,
      responsePreview: { status: response.status, ok: success, text }
    });

    // ── Update lastCall ──
    await updateLastCall({
      apiType,
      provider,
      endpoint: url,
      method,
      status: response.status,
      durationMs: elapsedMs,
      success,
      message: success ? 'OK' : `HTTP ${response.status}`
    });

    if (!success) {
      throw createHttpError(response.status, raw, provider);
    }

    return raw;
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;

    // Determine error type
    const isAbort = error?.name === 'AbortError';
    const errorCode = error?.code || (isAbort ? ERROR_CODES.TIMEOUT : ERROR_CODES.NETWORK_ERROR);
    const errorMessage = error?.message || (isAbort ? '请求超时' : '网络错误');

    // ── LOG: error ──
    appendLog({
      level: 'error',
      apiType,
      event: 'API_REQUEST_ERROR',
      provider,
      endpoint: url,
      method,
      status: error?.status || 0,
      durationMs: elapsedMs,
      success: false,
      message: `${errorCode}: ${errorMessage}`,
      error: { code: errorCode, message: errorMessage, name: error?.name || 'Error' }
    });

    // ── Update lastCall ──
    await updateLastCall({
      apiType,
      provider,
      endpoint: url,
      method,
      status: error?.status || 0,
      durationMs: elapsedMs,
      success: false,
      message: errorMessage
    });

    // Re-throw existing app errors
    if (error?.code) throw error;
    if (isAbort) {
      throw createAppError({ code: ERROR_CODES.TIMEOUT, provider, raw: { url }, retryable: true });
    }
    throw createAppError({
      code: ERROR_CODES.NETWORK_ERROR,
      message: errorMessage,
      provider,
      raw: error,
      retryable: true
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * FormData request that delegates to requestJson.
 */
export async function requestFormData({ apiType = 'image', provider = '', url, method = 'POST', headers = {}, formData, timeout = 60000 }) {
  const safeHeaders = { ...headers };
  delete safeHeaders['Content-Type'];
  delete safeHeaders['content-type'];
  return requestJson({ apiType, provider, url, method, headers: safeHeaders, body: formData, timeout });
}

// ── Internal ──

/**
 * Parse an HTTP response body. Handles:
 * 1. Plain JSON
 * 2. SSE (Server-Sent Events) streams — extracts the final succeeded result
 * 3. Fallback to { text } wrapper
 */
function parseResponse(text, response) {
  const contentType = (response?.headers?.get?.('content-type') || '').toLowerCase();

  // Detect SSE: Content-Type text/event-stream, or body starts with "data:"
  const isSSE = contentType.includes('text/event-stream') ||
    (typeof text === 'string' && text.trimStart().startsWith('data:'));

  if (isSSE) {
    return parseSSEStream(text);
  }

  // Standard JSON parse
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

/**
 * Parse an SSE (Server-Sent Events) stream.
 *
 * SSE format:
 *   data: {"key": "value"}\n\n
 *   data: {"key": "value2"}\n\n
 *
 * Strategy: extract all `data:` lines, parse each as JSON.
 * Return the LAST one that has "status":"succeeded" | "completed" | "done".
 * If none found, return the LAST valid JSON line.
 * If no valid lines, return { text } with the raw content.
 */
function parseSSEStream(text) {
  const lines = text.split('\n');
  const events = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    // Strip "data: " or "data:" prefix
    const jsonStr = trimmed.slice(5).trim();
    if (!jsonStr) continue;
    try {
      events.push(JSON.parse(jsonStr));
    } catch {
      // Skip unparseable lines
    }
  }

  if (events.length === 0) {
    return { text, _parseError: 'SSE stream detected but no valid JSON lines found' };
  }

  // Try to find the final succeeded/completed event
  const finalStatuses = ['succeeded', 'success', 'completed', 'done', 'finished'];
  for (let i = events.length - 1; i >= 0; i--) {
    const status = String(events[i].status || '').toLowerCase();
    if (finalStatuses.includes(status)) {
      // Merge into a clean result structure
      return {
        ...events[i],
        _sseMerged: true,
        _sseEventCount: events.length
      };
    }
  }

  // No final status found — return the last event anyway
  return {
    ...events[events.length - 1],
    _sseMerged: true,
    _sseEventCount: events.length
  };
}

function createHttpError(status, raw, provider) {
  if (status === 401 || status === 403) {
    return createAppError({ code: ERROR_CODES.UNAUTHORIZED, provider, status, raw, retryable: false });
  }
  if (status === 429) {
    return createAppError({ code: ERROR_CODES.RATE_LIMITED, provider, status, raw, retryable: true });
  }
  return createAppError({
    code: ERROR_CODES.NETWORK_ERROR,
    message: raw?.error?.message || raw?.message || `HTTP ${status}`,
    provider,
    status,
    raw,
    retryable: status >= 500
  });
}
