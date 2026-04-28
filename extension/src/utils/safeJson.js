/**
 * Safe JSON serialization utilities.
 *
 * These functions never throw on edge cases like circular references,
 * BigInt, functions, or Symbols. Long strings are automatically truncated.
 */

const MAX_STRING_LEN = 10000;

/**
 * Safe JSON.stringify that never throws.
 *
 * @param {*} value        - The value to stringify
 * @param {object} [opts]
 * @param {boolean} [opts.pretty]   - Use 2-space indent (default: compact)
 * @param {boolean} [opts.maxLength] - Max total output length (default: 50000)
 * @returns {string}
 */
export function safeStringify(value, opts = {}) {
  const indent = opts.pretty ? 2 : 0;
  const maxLen = opts.maxLength || 50000;

  try {
    const seen = new WeakSet();
    const result = JSON.stringify(value, function safeReplacer(key, val) {
      if (typeof val === 'bigint') return `<BigInt ${String(val)}>`;
      if (typeof val === 'function') return `<Function ${val.name || 'anonymous'}>`;
      if (typeof val === 'symbol') return `<Symbol ${String(val)}>`;
      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) return '<Circular>';
        seen.add(val);
      }
      if (typeof val === 'string' && val.length > MAX_STRING_LEN) {
        return truncateString(val, MAX_STRING_LEN);
      }
      return val;
    }, indent);

    if (result && result.length > maxLen) {
      return result.slice(0, maxLen) + `\n...[truncated total ${result.length} chars]`;
    }
    return result;
  } catch (error) {
    return `<Unserializable: ${error.message}>`;
  }
}

/**
 * Truncate a string with a suffix showing how much was cut.
 *
 * @param {string} value
 * @param {number} maxLen - Default 500
 * @returns {string}
 */
export function truncateString(value, maxLen = 500) {
  const text = String(value || '');
  if (text.length <= maxLen) return text;
  const cut = maxLen - 40; // reserve space for suffix
  if (cut <= 0) return text.slice(0, maxLen);
  return `${text.slice(0, cut)}...[truncated ${text.length - cut} chars]`;
}

/**
 * Deep-clone and truncate an object tree at a given depth.
 * Beyond maxDepth, objects become "<Object>" and arrays become "<Array(N)>".
 * Long strings are truncated to 200 chars.
 *
 * @param {*} value
 * @param {number} maxDepth - Default 3
 * @returns {*}
 */
export function truncateJson(value, maxDepth = 3) {
  return _truncateJson(value, 0, maxDepth);
}

function _truncateJson(value, depth, maxDepth) {
  if (depth >= maxDepth) {
    if (Array.isArray(value)) return `<Array(${value.length})>`;
    if (value && typeof value === 'object') return '<Object>';
    if (typeof value === 'string') return truncateString(value, 200);
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => _truncateJson(item, depth + 1, maxDepth));
  }

  if (value && typeof value === 'object') {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      if (typeof val === 'string' && val.length > 200) {
        result[key] = truncateString(val, 200);
      } else {
        result[key] = _truncateJson(val, depth + 1, maxDepth);
      }
    }
    return result;
  }

  if (typeof value === 'string' && value.length > 200) {
    return truncateString(value, 200);
  }

  return value;
}
