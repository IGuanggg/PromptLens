/**
 * Sensitive data masking utilities.
 *
 * All masking is one-way — no sensitive values are ever logged in plaintext.
 */

/**
 * Mask a secret string: shows first 4 + "****" + last 4 chars.
 * Strings <= 8 chars are fully replaced with "****".
 */
export function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 8) return '****';
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
}

/** Semantic alias for maskSecret. */
export function maskApiKey(key) {
  return maskSecret(key);
}

/**
 * Mask an Authorization header value.
 * "Bearer sk-a1b2c3d4e5f6..." => "Bearer sk-a****...e5f6"
 * "Bearer short" => "Bearer ****"
 * Non-Bearer values pass through maskSecret.
 */
export function maskAuthorization(header) {
  const text = String(header || '');
  if (!text) return '';
  // Bearer token format
  const bearerMatch = text.match(/^(Bearer\s+)(.+)$/i);
  if (bearerMatch) {
    return bearerMatch[1] + maskSecret(bearerMatch[2]);
  }
  // Token / Key format
  return maskSecret(text);
}

/**
 * Mask base64-encoded image data in a string.
 * "data:image/png;base64,iVBORw0KGgo..." => "data:image/png;base64,iVBORw0KGgo...[...[truncated 12345 chars]]"
 */
export function maskBase64Image(value) {
  const text = String(value || '');
  if (!text) return '';
  // Detect data URL with base64 image
  const match = text.match(/^(data:image\/[^;]+;base64,)(.{0,80})(.*)$/s);
  if (!match) return text;
  const prefix = match[1];
  const first80 = match[2];
  const rest = match[3] || '';
  if (!rest || rest.length === 0) return text; // too short to need masking
  return `${prefix}${first80}...[truncated ${rest.length} chars]`;
}

/**
 * Clone a headers object and mask sensitive field values.
 * Masked keys: authorization, x-api-key, api-key, and any key containing "apikey".
 */
export function maskHeaders(headers) {
  if (!headers || typeof headers !== 'object') return headers;
  const safe = { ...headers };
  for (const key of Object.keys(safe)) {
    const lower = key.toLowerCase();
    if (
      lower === 'authorization' ||
      lower === 'x-api-key' ||
      lower === 'api-key' ||
      lower.includes('apikey')
    ) {
      safe[key] = maskSecret(safe[key]);
    }
  }
  return safe;
}

/**
 * Walk a parsed JSON body object/string and mask any base64 image strings.
 * Only operates on string bodies that parse as JSON.
 */
export function maskRequestBody(body, { logRequestBody = false } = {}) {
  if (!body) return undefined;
  if (typeof body !== 'string') return '<FormData or Blob>';

  // Try parsing as JSON - if it fails, just return a truncated preview
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body.length > 200 ? body.slice(0, 200) + '...[truncated]' : body;
  }

  if (!logRequestBody) {
    return `{ ... ${Object.keys(parsed).join(', ')} ... } (${body.length} bytes)`;
  }

  // Walk and mask
  return JSON.stringify(maskBase64InObject(parsed));
}

/** Recursively mask base64 data URLs in an object tree. */
function maskBase64InObject(obj) {
  if (typeof obj === 'string') return maskBase64Image(obj);
  if (Array.isArray(obj)) return obj.map(maskBase64InObject);
  if (obj && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = maskBase64InObject(value);
    }
    return result;
  }
  return obj;
}
