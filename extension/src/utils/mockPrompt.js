export function mockPromptResult(provider) {
  return {
    tags: [
      'cinematic',
      'concept art',
      'high detail',
      'soft lighting',
      'atmospheric',
      'sharp focus',
      'rich texture',
      'depth of field',
      'digital art'
    ],
    zh: '一幅电影感概念艺术作品，主体清晰突出，拥有明确轮廓、精致材质和富有表现力的姿态；场景具有前景、中景和背景层次，环境元素服务于整体故事氛围；整体风格为高质量数字插画与电影视觉设计，色彩统一而克制，局部高光形成视觉焦点；采用稳定构图，中景视角，焦点清晰，背景略带景深虚化；柔和主光配合边缘光和环境光，营造沉浸、细腻、具有叙事感的氛围；画面包含丰富细节、真实材质、空气感和高分辨率渲染。',
    en: 'A cinematic concept art image with a clear and prominent main subject, well-defined silhouette, refined material textures, and an expressive pose. The scene has strong foreground, midground, and background depth, with environmental elements supporting a narrative atmosphere. High-quality digital illustration and cinematic production design style, cohesive restrained color palette, subtle highlight accents, stable composition, medium shot perspective, sharp subject focus, slight background depth of field, soft key light, rim light, ambient light, rich details, realistic materials, atmospheric depth, and polished high-resolution rendering.',
    provider,
    raw: { mock: true }
  };
}

export function normalizePromptResult(result, provider) {
  return {
    tags: Array.isArray(result?.tags) ? result.tags : [],
    zh: String(result?.zh || ''),
    en: String(result?.en || ''),
    provider: result?.provider || provider,
    raw: result?.raw || result || {}
  };
}
