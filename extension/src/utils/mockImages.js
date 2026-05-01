export function mockImages(provider, count = 4, width = 1080, height = 1080) {
  const labels = ['参考风格', '创意变体', '结构草图', '线稿风格'];
  const stamp = Date.now();
  return {
    images: Array.from({ length: Number(count) || 4 }).map((_, index) => ({
      id: `mock_${stamp}_${index}`,
      url: createMockImageDataUrl(labels[index] || `结果 ${index + 1}`, index, width, height),
      thumbUrl: createMockImageDataUrl(labels[index] || `结果 ${index + 1}`, index, 512, 512),
      label: labels[index] || `结果 ${index + 1}`,
      provider,
      width,
      height,
      createdAt: stamp
    })),
    provider,
    raw: { mock: true, width, height }
  };
}

function createMockImageDataUrl(label, index, width, height) {
  const palettes = [
    ['#0b0f14', '#2ee6b8', '#ffffff'],
    ['#101423', '#f6c453', '#ffffff'],
    ['#111827', '#7dd3fc', '#ffffff'],
    ['#160f1f', '#ff5c7a', '#ffffff']
  ];
  const [bg, accent, text] = palettes[index % palettes.length];
  const unit = Math.min(width, height);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <rect width="${width}" height="${height}" fill="${bg}"/>
      <circle cx="${width * 0.72}" cy="${height * 0.24}" r="${unit * 0.18}" fill="${accent}" opacity="0.24"/>
      <rect x="${width * 0.16}" y="${height * 0.2}" width="${width * 0.68}" height="${height * 0.56}" rx="${unit * 0.04}" fill="none" stroke="${accent}" stroke-width="${unit * 0.018}"/>
      <path d="M ${width * 0.22} ${height * 0.66} L ${width * 0.4} ${height * 0.48} L ${width * 0.53} ${height * 0.6} L ${width * 0.65} ${height * 0.44} L ${width * 0.78} ${height * 0.66}" fill="none" stroke="${accent}" stroke-width="${unit * 0.02}" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="50%" y="${height * 0.84}" fill="${text}" font-family="Arial, sans-serif" font-size="${unit * 0.052}" text-anchor="middle">${escapeSvg(label)}</text>
      <text x="50%" y="${height * 0.91}" fill="${accent}" font-family="Arial, sans-serif" font-size="${unit * 0.032}" text-anchor="middle">${escapeSvg(providerLabel(index))}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function providerLabel(index) {
  return `PromptLens Mock ${index + 1}`;
}

function escapeSvg(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
