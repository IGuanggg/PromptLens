import { maskSecret } from './mask.js';

const MAX_HISTORY_ITEM_BYTES = 900 * 1024;

export function sanitizeHistoryItem(item) {
  const cloned = JSON.parse(JSON.stringify(item || {}));
  stripSecrets(cloned);
  let reduced = false;

  if (byteSize(cloned) > MAX_HISTORY_ITEM_BYTES) {
    reduced = true;

    // ── Strip large inline data URLs from image ──
    if (cloned.image) {
      // Strip dataUrl (largest field) first
      if (isLargeInlineUrl(cloned.image.dataUrl)) {
        cloned.image.dataUrl = '';
        cloned.image.dataUrlStripped = true;
      }
      // Strip displayUrl if it's a large inline data URL
      if (isLargeInlineUrl(cloned.image.displayUrl)) {
        cloned.image.displayUrl = cloned.image.url || '';
        cloned.image.displayUrlStripped = true;
      }
      // Strip url if it's a large data URL
      if (isLargeInlineUrl(cloned.image.url)) {
        cloned.image.url = '';
        cloned.image.unrestorable = true;
      }
    }

    // ── Strip large inline URLs from results ──
    cloned.results = (cloned.results || []).map((result) => {
      if (isLargeInlineUrl(result.url) || isLargeInlineUrl(result.thumbUrl)) {
        return {
          ...result,
          url: '',
          thumbUrl: '',
          unrestorable: true
        };
      }
      return result;
    });
  }

  // ── If still too large, remove results entirely ──
  if (byteSize(cloned) > MAX_HISTORY_ITEM_BYTES) {
    reduced = true;
    cloned.results = [];
  }

  // ── Mark blob URLs as unrestorable ──
  if (String(cloned.image?.url || '').startsWith('blob:')) {
    cloned.image.unrestorable = true;
  }

  return { item: cloned, reduced };
}

export function stripSecrets(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (lower.includes('apikey') || lower === 'authorization') {
      obj[key] = maskSecret(value);
    } else if (value && typeof value === 'object') {
      stripSecrets(value);
    }
  }
  return obj;
}

export function byteSize(value) {
  return new Blob([JSON.stringify(value || {})]).size;
}

function isLargeInlineUrl(value) {
  return String(value || '').startsWith('data:');
}
