import { AUTH_TYPES, REQUEST_MODES } from '../constants.js';

export const DEFAULT_SETTINGS = {
  promptApi: {
    type: 'openai-compatible',
    baseUrl: 'https://api.openai.com',
    endpoint: '/v1/chat/completions',
    apiKey: '',
    model: 'gpt-4.1-mini',
    temperature: 0.2,
    maxTokens: 1200,
    enablePromptSanitizer: true,
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
    type: 'custom-image',
    baseUrl: 'https://grsai.dakka.com.cn',
    endpoint: '',
    apiKey: '',
    model: 'gpt-image-2',
    size: '1080x1080',
    sizeFormat: '*',
    responseFormat: 'url',
    sizeMode: 'preset',
    aspectRatio: '1:1',
    resolutionPreset: '1k',
    customWidth: 1080,
    customHeight: 1080,
    finalWidth: 1080,
    finalHeight: 1080,
    requestMode: 'async',
    resultEndpoint: '/v1/draw/result',
    pollIntervalMs: 3000,
    maxPollCount: 240,
    webHook: '-1',
    shutProgress: false,
    customEndpointOverride: false,
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
  return deepMerge(DEFAULT_SETTINGS, data.settings || {});
}

export async function saveSettings(settings) {
  await chrome.storage.local.set({ settings });
  return settings;
}

export async function resetSettings() {
  await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  return DEFAULT_SETTINGS;
}
