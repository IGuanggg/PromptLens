export function parseSize(size) {
  const [width, height] = String(size || '720x720').split('x').map(Number);
  return { width: width || 720, height: height || 720 };
}
