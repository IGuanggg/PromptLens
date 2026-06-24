import { AUTH_TYPES } from '../constants.js';
import { requestJson } from '../utils/http.js';

const DEFAULT_MODELS_ENDPOINT = '/v1/models';
const KNOWN_ENDPOINT_SUFFIXES = [
  '/chat/completions',
  '/images/generations',
  '/responses',
  '/completions'
];

export function buildModelsUrl(baseUrl) {
  const text = String(baseUrl || '').trim();
  if (!text) throw new Error('请先填写 Base URL');

  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error('Base URL 格式不正确');
  }

  let pathname = url.pathname.replace(/\/+$/, '');
  for (const suffix of KNOWN_ENDPOINT_SUFFIXES) {
    if (pathname.toLowerCase().endsWith(suffix)) {
      pathname = pathname.slice(0, -suffix.length);
      break;
    }
  }

  if (pathname.toLowerCase().endsWith('/models')) {
    url.pathname = pathname;
    return url.toString();
  }

  if (pathname.toLowerCase().endsWith('/v1')) {
    url.pathname = `${pathname}/models`;
  } else {
    url.pathname = `${pathname}${DEFAULT_MODELS_ENDPOINT}`;
  }

  return url.toString();
}

export function parseModelList(raw) {
  const candidates = [
    raw?.data,
    raw?.models,
    raw?.result?.data,
    raw?.result?.models,
    raw?.response?.data,
    raw?.response?.models
  ].filter(Array.isArray);

  const values = candidates.flatMap((items) => items)
    .map((item) => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      return item.id || item.name || item.model || item.value || '';
    })
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function buildModelDiscoveryRequest({
  baseUrl,
  apiKey = '',
  custom = {},
  forceBearer = false
}) {
  const url = new URL(buildModelsUrl(baseUrl));
  const headers = { Accept: 'application/json' };
  const authType = forceBearer ? AUTH_TYPES.BEARER : (custom?.authType || AUTH_TYPES.BEARER);
  const key = String(apiKey || '').trim();

  if (!key || authType === AUTH_TYPES.NONE) {
    return { url: url.toString(), headers };
  }

  if (authType === AUTH_TYPES.QUERY_KEY) {
    url.searchParams.set(custom?.queryKeyName || 'api_key', key);
  } else if (authType === AUTH_TYPES.X_API_KEY) {
    headers['x-api-key'] = key;
  } else if (authType === AUTH_TYPES.CUSTOM_HEADER && custom?.customHeaderName) {
    headers[custom.customHeaderName] = custom.customHeaderValue || key;
  } else {
    headers.Authorization = `Bearer ${key}`;
  }

  return { url: url.toString(), headers };
}

export async function discoverModels({
  baseUrl,
  apiKey,
  apiType = 'system',
  provider = 'openai-compatible',
  custom,
  forceBearer = false
}) {
  const request = buildModelDiscoveryRequest({
    baseUrl,
    apiKey,
    custom,
    forceBearer
  });

  const raw = await requestJson({
    apiType,
    provider,
    url: request.url,
    method: 'GET',
    headers: request.headers,
    timeout: 30000
  });

  const models = parseModelList(raw);
  if (models.length === 0) {
    throw new Error('接口返回中没有可识别的模型列表');
  }

  return { models, url: request.url, raw };
}
