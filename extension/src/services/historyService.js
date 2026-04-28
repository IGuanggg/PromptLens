import { createId } from '../utils/id.js';
import { formatCompactDateTime } from '../utils/date.js';
import { sanitizeHistoryItem } from '../utils/sanitize.js';
import { loadSettings } from './storageService.js';

export const HISTORY_KEY = 'promptpilotHistory';
const DEFAULT_HISTORY_LIMIT = 30;

export async function getHistory() {
  const data = await chrome.storage.local.get(HISTORY_KEY);
  return Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
}

export async function saveHistoryItem(item) {
  const settings = await loadSettings();
  if (settings?.storage?.enableHistory === false) return { item: null, updated: false, reduced: false };

  const now = Date.now();
  const incoming = {
    ...item,
    id: item.id || createId('hist'),
    createdAt: item.createdAt || now,
    updatedAt: now
  };
  const sanitized = sanitizeHistoryItem(incoming);
  const history = await getHistory();
  const duplicateIndex = history.findIndex((entry) => {
    return entry.image?.url &&
      entry.image.url === sanitized.item.image?.url &&
      (entry.prompts?.en || '') === (sanitized.item.prompts?.en || '');
  });

  if (duplicateIndex >= 0) {
    const existing = history[duplicateIndex];
    history[duplicateIndex] = {
      ...existing,
      ...sanitized.item,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now
    };
    await chrome.storage.local.set({ [HISTORY_KEY]: await trimList(history, getHistoryLimit(settings)) });
    return { item: history[duplicateIndex], updated: true, reduced: sanitized.reduced };
  }

  const next = [sanitized.item, ...history];
  await chrome.storage.local.set({ [HISTORY_KEY]: await trimList(next, getHistoryLimit(settings)) });
  return { item: sanitized.item, updated: false, reduced: sanitized.reduced };
}

export async function updateHistoryItem(id, patch) {
  const history = await getHistory();
  const index = history.findIndex((item) => item.id === id);
  if (index < 0) return null;
  history[index] = {
    ...history[index],
    ...patch,
    updatedAt: Date.now()
  };
  await chrome.storage.local.set({ [HISTORY_KEY]: history });
  return history[index];
}

export async function deleteHistoryItem(id) {
  const history = await getHistory();
  const next = history.filter((item) => item.id !== id);
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

export async function clearHistory() {
  await chrome.storage.local.set({ [HISTORY_KEY]: [] });
}

export async function exportHistory() {
  return {
    app: 'PromptPilot',
    version: '1.0.0',
    exportedAt: Date.now(),
    items: await getHistory()
  };
}

export async function importHistory(items) {
  if (!Array.isArray(items)) throw new Error('历史数据格式无效');
  const settings = await loadSettings();
  const existing = await getHistory();
  const existingIds = new Set(existing.map((item) => item.id));
  const cleaned = items
    .filter((item) => item && item.id && !existingIds.has(item.id))
    .map((item) => sanitizeHistoryItem(item).item);
  const next = await trimList([...cleaned, ...existing], getHistoryLimit(settings));
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

export async function trimHistory(limit) {
  const history = await getHistory();
  const next = await trimList(history, Number(limit || DEFAULT_HISTORY_LIMIT));
  await chrome.storage.local.set({ [HISTORY_KEY]: next });
  return next;
}

export function createHistoryItemFromState(state) {
  const now = Date.now();
  const settings = state.settings || {};
  const promptApi = settings.promptApi || {};
  const imageApi = settings.imageApi || {};
  const currentImage = state.currentImage || {};
  const title = currentImage.pageTitle || state.prompts?.zh?.slice(0, 24) || state.prompts?.en?.slice(0, 32) || '未命名记录';

  return {
    id: createId('hist'),
    title,
    source: currentImage.source || 'context-menu',
    createdAt: now,
    updatedAt: now,
    image: {
      id: currentImage.id || createId('img'),
      url: currentImage.url || currentImage.srcUrl || '',
      dataUrl: currentImage.dataUrl || '',
      displayUrl: currentImage.displayUrl || currentImage.dataUrl || currentImage.url || '',
      pageUrl: currentImage.pageUrl || '',
      pageTitle: currentImage.pageTitle || '',
      fileName: currentImage.fileName || '',
      mimeType: currentImage.mimeType || '',
      sizeBytes: Number(currentImage.sizeBytes || 0),
      width: Number(currentImage.width || 0),
      height: Number(currentImage.height || 0),
      originalWidth: Number(currentImage.originalWidth || 0),
      originalHeight: Number(currentImage.originalHeight || 0),
      compressed: Boolean(currentImage.compressed),
      source: currentImage.source || 'context-menu',
      warning: currentImage.warning || '',
      recoverable: currentImage.recoverable !== false,
      createdAt: currentImage.createdAt || now
    },
    prompts: {
      tags: state.prompts?.tags || [],
      zh: state.prompts?.zh || '',
      en: state.prompts?.en || ''
    },
    templateMeta: {
      extraInstruction: state.extraInstruction || ''
    },
    generateSettings: {
      providerType: imageApi.type || '',
      model: imageApi.model || '',
      mode: state.generateSettings?.mode || 'standard',
      width: Number(state.generateSettings?.width || 1024),
      height: Number(state.generateSettings?.height || 1024),
      count: Number(state.generateSettings?.count || 4),
      negativePrompt: ''
    },
    results: (state.results || []).map((result) => ({
      id: result.id || createId('img'),
      url: result.url || '',
      thumbUrl: result.thumbUrl || result.url || '',
      label: result.label || '',
      provider: result.provider || imageApi.type || '',
      width: Number(result.width || 0),
      height: Number(result.height || 0),
      createdAt: result.createdAt || now
    })),
    meta: {
      promptProvider: promptApi.type || '',
      imageProvider: imageApi.type || '',
      promptModel: promptApi.model || '',
      imageModel: imageApi.model || '',
      elapsedMs: Number(state.meta?.elapsedMs || 0),
      errorCount: state.lastError ? 1 : 0
    }
  };
}

export function createHistoryExportFilename() {
  return `promptpilot_history_${formatCompactDateTime()}.json`;
}

function getHistoryLimit(settings) {
  return Number(settings?.storage?.historyLimit || DEFAULT_HISTORY_LIMIT);
}

async function trimList(items, limit) {
  return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, Number(limit || DEFAULT_HISTORY_LIMIT));
}

