export function parseSize(size) {
  const [width, height] = String(size || '1024x1024').split('x').map(Number);
  return { width: width || 1024, height: height || 1024 };
}
