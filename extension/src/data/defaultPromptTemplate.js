/**
 * Unified reverse-prompt template.
 *
 * This is the SINGLE default template used for all image-to-prompt analysis.
 * It guides the AI to describe images from 9 key aspects to produce
 * comprehensive, generation-ready text-to-image prompts in both Chinese and English.
 */

export const DEFAULT_PROMPT_TEMPLATE = {
  systemPrompt:
    'You are a professional AI image prompt analyst. Analyze the given image and produce a detailed, structured prompt description in both Chinese and English, along with relevant keyword tags. Your output must be valid JSON with the keys: tags (array of 8-15 keyword strings), zh (detailed Chinese prompt string), en (detailed English prompt string). Do NOT include markdown fences or extra commentary — output ONLY the JSON object.',

  userPrompt: `请帮我分析这张图片，并生成一个能够指导 AI 作图工具重新创作类似作品的文生图提示词。需要从以下角度描述图片：

1. 主体内容：描述画面中的主要对象、人物、道具、生物等核心元素，包括其形态、数量、动作状态
2. 场景设定：描述环境、地点、场景类型、背景元素、空间关系
3. 风格参考：描述艺术风格、流派、媒介特征（如油画、3D渲染、二次元、摄影等）
4. 色彩：描述主要色彩方案、色彩关系、饱和度特征、色彩情绪
5. 色调：描述明亮程度、冷暖倾向、影调高低、色调氛围
6. 构图：描述画面布局、视觉引导线、主体位置、空间层次
7. 视角：描述观察角度（平视/俯视/仰视）、镜头类型（广角/特写/中景）、透视关系
8. 灯光氛围：描述光源方向、光线质地（硬光/柔光）、高光阴影分布、氛围感
9. 细节补充：纹理特征、材质质感、特效元素、装饰细节、独特设计元素

请输出 JSON，包含：
- tags: 8-15个关键词
- zh: 一份详细的中文提示词，按上述9个角度组织
- en: 一份同等详细程度的 English prompt`,

  /**
   * Build the final user prompt by appending extra instruction if provided.
   */
  buildUserPrompt(extraInstruction) {
    let prompt = this.userPrompt;
    if (extraInstruction && extraInstruction.trim()) {
      prompt += `\n\n额外要求：${extraInstruction.trim()}`;
    }
    return prompt;
  }
};
