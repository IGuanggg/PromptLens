export function parseSize(size) {
  const [width, height] = String(size || '1080x1080').split('x').map(Number);
  return { width: width || 1080, height: height || 1080 };
}
