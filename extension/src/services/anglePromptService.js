const ANGLE_DEFINITIONS = [
  {
    key: 'reference',
    label: '参考角度',
    zh: '保持参考图的原始视角和构图，重新创作类似作品。主体、服饰、材质、色彩、风格、光线、氛围和场景保持一致。',
    en: 'Keep the original viewing angle and composition of the reference image. Recreate a similar artwork while preserving the same subject, outfit, materials, colors, visual style, lighting, atmosphere, and scene design. Maintain visual consistency with the reference image.'
  },
  {
    key: 'side',
    label: '侧面视角',
    zh: '生成同一主体的侧面视角，约 90 度侧面观察。保持主体设计、服饰、材质、色彩、发型、配饰、比例、光线、氛围和整体风格一致。',
    en: 'Generate a side view of the same subject from the reference image. Preserve the same character or object design, clothing, materials, colors, hairstyle, accessories, proportions, lighting, atmosphere, and artistic style. The camera should view the subject from the side, around 90 degrees, while keeping the scene visually consistent.'
  },
  {
    key: 'back',
    label: '背面视角',
    zh: '生成同一主体的背面视角，从后方观察。展示背部轮廓和背面细节，同时保持主体设计、服饰、材质、色彩、比例、光线、氛围和整体风格一致。',
    en: 'Generate a back view of the same subject from the reference image. Preserve the same character or object design, clothing, materials, colors, hairstyle, accessories, proportions, lighting, atmosphere, and artistic style. The camera should view the subject from behind, showing the rear silhouette and back details, while keeping the scene visually consistent.'
  },
  {
    key: 'top',
    label: '顶面视角',
    zh: '生成同一主体的顶面视角或俯视视角，从上方观察。展示顶部结构、空间布局和整体轮廓，同时保持主体设计、材质、色彩、光线、氛围和整体风格一致。',
    en: 'Generate a top-down view of the same subject from the reference image. Preserve the same character or object design, clothing, materials, colors, proportions, lighting, atmosphere, and artistic style. The camera should look down from above, showing the top view and spatial layout, while keeping the scene visually consistent.'
  }
];

export function createMultiAnglePrompts({
  basePrompt = '',
  promptZh = '',
  promptEn = '',
  referenceImage = '',
  extraPrompt = ''
} = {}) {
  const sourceEn = normalizePrompt(promptEn || basePrompt || promptZh);
  const sourceZh = normalizePrompt(promptZh || basePrompt || promptEn);
  const extra = normalizePrompt(extraPrompt);
  const referenceHintEn = 'Based on the visual description extracted from the reference image.';

  return ANGLE_DEFINITIONS.map((angle) => ({
    key: angle.key,
    label: angle.label,
    anglePromptZh: joinPrompt(sourceZh, angle.zh, extra),
    anglePromptEn: joinPrompt(sourceEn, `${referenceHintEn} ${angle.en}`, extra)
  }));
}

function joinPrompt(...parts) {
  return parts
    .map((part) => normalizePrompt(part))
    .filter(Boolean)
    .join('\n\n');
}

function normalizePrompt(value) {
  return String(value || '').trim();
}
