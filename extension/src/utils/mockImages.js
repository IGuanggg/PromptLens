export function mockImages(provider, count = 4) {
  const labels = ['参考风格', '创意变体', '结构草图', '线稿风格'];
  const stamp = Date.now();
  return {
    images: Array.from({ length: Number(count) || 4 }).map((_, index) => ({
      id: `mock_${stamp}_${index}`,
      url: createMockImageDataUrl(labels[index] || `结果 ${index + 1}`, index, 1024),
      thumbUrl: createMockImageDataUrl(labels[index] || `结果 ${index + 1}`, index, 512),
      label: labels[index] || `结果 ${index + 1}`,
      provider,
      width: 1024,
      height: 1024,
      createdAt: stamp
    })),
    provider,
    raw: { mock: true }
  };
}

function createMockImageDataUrl(label, index, size) {
  const palettes = [
    ['#0b0f14', '#2ee6b8', '#ffffff'],
    ['#101423', '#f6c453', '#ffffff'],
    ['#111827', '#7dd3fc', '#ffffff'],
    ['#160f1f', '#ff5c7a', '#ffffff']
  ];
  const [bg, accent, text] = palettes[index % palettes.length];
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <rect width="${size}" height="${size}" fill="${bg}"/>
      <circle cx="${size * 0.72}" cy="${size * 0.24}" r="${size * 0.18}" fill="${accent}" opacity="0.24"/>
      <rect x="${size * 0.16}" y="${size * 0.2}" width="${size * 0.68}" height="${size * 0.56}" rx="${size * 0.04}" fill="none" stroke="${accent}" stroke-width="${size * 0.018}"/>
      <path d="M ${size * 0.22} ${size * 0.66} L ${size * 0.4} ${size * 0.48} L ${size * 0.53} ${size * 0.6} L ${size * 0.65} ${size * 0.44} L ${size * 0.78} ${size * 0.66}" fill="none" stroke="${accent}" stroke-width="${size * 0.02}" stroke-linecap="round" stroke-linejoin="round"/>
      <text x="50%" y="${size * 0.84}" fill="${text}" font-family="Arial, sans-serif" font-size="${size * 0.052}" text-anchor="middle">${escapeSvg(label)}</text>
      <text x="50%" y="${size * 0.91}" fill="${accent}" font-family="Arial, sans-serif" font-size="${size * 0.032}" text-anchor="middle">${escapeSvg(providerLabel(index))}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function providerLabel(index) {
  return `PromptPilot Mock ${index + 1}`;
}

function escapeSvg(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
