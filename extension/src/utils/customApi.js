import { AUTH_TYPES } from '../constants.js';
import { requestJson } from './http.js';
import { getByPath } from './objectPath.js';

export { getByPath };

export function replaceTemplate(template, variables) {
  return String(template || '').replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, key) => {
    const value = variables[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

export function parseTemplateBody(template, variables) {
  const body = replaceTemplate(template, variables);
  if (!body.trim()) return undefined;
  try {
    return JSON.stringify(JSON.parse(body));
  } catch {
    return body;
  }
}

export function buildUrl(baseUrl, endpoint, settings = {}) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const path = replaceTemplate(endpoint || '', settings).replace(/^\/?/, '/');
  const url = new URL(`${base}${path}`);

  if (settings.authType === AUTH_TYPES.QUERY_KEY && settings.apiKey) {
    url.searchParams.set(settings.queryKeyName || 'api_key', settings.apiKey);
  }

  return url.toString();
}

export function buildHeaders(settings = {}) {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey = settings.apiKey || '';

  if (settings.authType === AUTH_TYPES.BEARER && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (settings.authType === AUTH_TYPES.X_API_KEY && apiKey) {
    headers['x-api-key'] = apiKey;
  } else if (settings.authType === AUTH_TYPES.CUSTOM_HEADER && settings.customHeaderName) {
    headers[settings.customHeaderName] = settings.customHeaderValue || apiKey;
  }

  return headers;
}

/**
 * Convenience wrapper that passes apiType through to requestJson for logging.
 */
export async function fetchJsonWithTimeout(url, options = {}, timeout = 60000, meta = {}) {
  return requestJson({
    apiType: meta.apiType || 'system',
    provider: meta.provider || '',
    url,
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body,
    timeout
  });
}

export function mapResponse(raw, responseMap = {}) {
  const output = {};
  for (const [key, path] of Object.entries(responseMap || {})) {
    output[key] = getByPath(raw, path);
  }
  return output;
}
