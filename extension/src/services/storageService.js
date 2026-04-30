import { AUTH_TYPES, REQUEST_MODES } from '../constants.js';
import { getOutputSize, migrateResolutionPreset, migrateSizeMode } from '../utils/size.js';

export const DEFAULT_SETTINGS = {
  promptApi: {
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com',
    endpoint: '/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4.1-mini',
    temperature: 0.2,
    maxTokens: 1200,
    customInstruction: '',
    custom: {
      method: 'POST',
      authType: AUTH_TYPES.BEARER,
      requestTemplate: '{\n  "model": "{{model}}",\n  "messages": [\n    { "role": "system", "content": "{{systemPrompt}}" },\n    { "role": "user", "content": "{{userPrompt}}" }\n  ],\n  "temperature": {{temperature}},\n  "max_tokens": {{maxTokens}}\n}',
      responseMap: {
        tags: 'tags',
        zh: 'zh',
        en: 'en'
      }
    }
  },
  imageApi: {
    type: 'openai-compatible-image',
    baseUrl: 'https://api.openai.com',
    endpoint: '/v1/images/generations',
    apiKey: '',
    model: 'gpt-image-1',
    size: '1080x1080',
    sizeFormat: 'x',
    responseFormat: 'url',
    sizeMode: 'preset',
    aspectRatio: '1:1',
    resolutionPreset: '1k',
    customWidth: 1080,
    customHeight: 1080,
    finalWidth: 1080,
    finalHeight: 1080,
    custom: {
      method: 'POST',
      authType: AUTH_TYPES.BEARER,
      requestMode: REQUEST_MODES.SYNC,
      statusEndpoint: '',
      requestTemplate: '{\n  "model": "{{model}}",\n  "prompt": "{{prompt}}",\n  "n": {{count}},\n  "size": "{{size}}"\n}',
      responseMap: {
        images: 'data',
        imageUrl: 'url',
        taskId: 'id',
        status: 'status'
      }
    }
  },
  storage: {
    enableHistory: true,
    historyLimit: 30,
    savePromptWithImage: true,
    saveResults: true,
    autoSaveDraft: true,
    panelMode: 'docked'
  },
  advanced: {
    enableDebugMode: false,
    saveDebugLogs: true,
    debugLogLimit: 200,
    logRequestBody: false,
    logResponseBody: false
  }
};

export function deepMerge(target, source) {
  const output = { ...target };
  if (!source || typeof source !== 'object') return output;
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      output[key] = deepMerge(output[key] || {}, value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

export async function loadSettings() {
  const data = await chrome.storage.local.get('settings');
  return normalizeSettings(data.settings || {});
}

export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings);
  await chrome.storage.local.set({ settings: normalized });
  return normalized;
}

export async function resetSettings() {
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}

export function normalizeSettings(settings) {
  const sourceImageApi = settings?.imageApi || {};
  const normalized = deepMerge(DEFAULT_SETTINGS, settings || {});
  const api = normalized.imageApi || {};
  const sourceResolution = Object.prototype.hasOwnProperty.call(sourceImageApi, 'resolutionPreset')
    ? sourceImageApi.resolutionPreset
    : sourceImageApi.quality;
  const sourceAspectRatio = Object.prototype.hasOwnProperty.call(sourceImageApi, 'aspectRatio')
    ? sourceImageApi.aspectRatio
    : sourceImageApi.selectedRatio;

  api.sizeMode = migrateSizeMode(api.sizeMode || 'preset');
  api.aspectRatio = sourceAspectRatio || api.aspectRatio || '1:1';
  api.resolutionPreset = migrateResolutionPreset(sourceResolution || api.resolutionPreset);
  api.customWidth = Number(api.customWidth || 1080);
  api.customHeight = Number(api.customHeight || 1080);
  delete api.selectedRatio;
  delete api.quality;

  try {
    const outputSize = getOutputSize({
      sizeMode: api.sizeMode,
      aspectRatio: api.aspectRatio,
      resolutionPreset: api.resolutionPreset,
      customWidth: api.customWidth,
      customHeight: api.customHeight,
      referenceImage: null
    });
    api.finalWidth = outputSize.width;
    api.finalHeight = outputSize.height;
    api.size = outputSize.size;
  } catch {
    api.finalWidth = 1080;
    api.finalHeight = 1080;
    api.size = '1080x1080';
  }

  normalized.imageApi = api;
  return normalized;
}
