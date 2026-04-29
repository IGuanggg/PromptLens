import { isQuotaExceededError, sanitizeDraft } from '../utils/sanitize.js';

export const DRAFT_KEY = 'promptpilotDraft';

export async function getDraft() {
  const data = await chrome.storage.local.get(DRAFT_KEY);
  return data[DRAFT_KEY] || null;
}

export async function saveDraft(state) {
  const draft = createDraftFromState(state);
  const sanitized = sanitizeDraft(draft);
  try {
    await chrome.storage.local.set({ [DRAFT_KEY]: sanitized.draft });
    return sanitized.draft;
  } catch (error) {
    if (!isQuotaExceededError(error)) throw error;
    await chrome.storage.local.remove('promptpilotLogs').catch(() => {});
    const fallback = sanitizeDraft({
      ...sanitized.draft,
      currentImage: stripDraftImage(sanitized.draft.currentImage),
      results: []
    }).draft;
    await chrome.storage.local.set({ [DRAFT_KEY]: fallback });
    return fallback;
  }
}

export async function clearDraft() {
  await chrome.storage.local.remove(DRAFT_KEY);
}

function stripDraftImage(image) {
  if (!image) return null;
  return {
    id: image.id || '',
    url: String(image.url || image.srcUrl || '').startsWith('data:') ? '' : (image.url || image.srcUrl || ''),
    displayUrl: String(image.displayUrl || '').startsWith('data:') ? '' : (image.displayUrl || image.url || ''),
    pageUrl: image.pageUrl || '',
    pageTitle: image.pageTitle || '',
    width: Number(image.width || 0),
    height: Number(image.height || 0),
    originalWidth: Number(image.originalWidth || 0),
    originalHeight: Number(image.originalHeight || 0),
    source: image.source || '',
    warning: image.warning || '草稿图片过大，已仅保留引用信息',
    unrestorable: true
  };
}

export async function restoreDraft() {
  return getDraft();
}

export function createDraftFromState(state) {
  return {
    currentImage: state.currentImage || null,
    prompts: state.prompts || { tags: [], zh: '', en: '' },
    generateSettings: state.generateSettings || {},
    results: state.results || [],
    taskStatus: state.taskStatus || {},
    extraInstruction: state.extraInstruction || '',
    userExtraPrompt: state.userExtraPrompt || '',
    updatedAt: Date.now()
  };
}
