export const DRAFT_KEY = 'promptpilotDraft';

export async function getDraft() {
  const data = await chrome.storage.local.get(DRAFT_KEY);
  return data[DRAFT_KEY] || null;
}

export async function saveDraft(state) {
  const draft = createDraftFromState(state);
  await chrome.storage.local.set({ [DRAFT_KEY]: draft });
  return draft;
}

export async function clearDraft() {
  await chrome.storage.local.remove(DRAFT_KEY);
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
