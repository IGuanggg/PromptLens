export function getByPath(obj, path, fallback = undefined) {
  if (!path) return fallback;
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cursor = obj;
  for (const part of parts) {
    if (cursor === undefined || cursor === null) return fallback;
    cursor = cursor[part];
  }
  return cursor === undefined ? fallback : cursor;
}

export function setByPath(obj, path, value) {
  const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let cursor = obj;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
  return obj;
}

export function normalizeImagesFromResponse(raw, responseMap = {}) {
  const mapped = getByPath(raw, responseMap.images) || getByPath(raw, responseMap.imageUrl);
  if (mapped) return Array.isArray(mapped) ? mapped : [mapped];
  if (Array.isArray(raw?.data)) return raw.data;
  if (Array.isArray(raw?.images)) return raw.images;
  if (Array.isArray(raw?.output)) return raw.output;
  if (raw?.imageUrl) return [raw.imageUrl];
  if (raw?.url || raw?.b64_json) return [raw];
  return [];
}
