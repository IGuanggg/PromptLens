import { PROMPT_API_TYPES } from '../constants.js';
import { DEFAULT_PROMPT_TEMPLATE } from '../data/defaultPromptTemplate.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout, mapResponse, parseTemplateBody } from '../utils/customApi.js';
import { mockPromptResult, normalizePromptResult } from '../utils/mockPrompt.js';
import { appendLog } from './logService.js';

const PROMPT_TIMEOUT = 120000; // 2 minutes for vision requests

/**
 * Determine the best image URL to send to the vision API.
 * Priority: dataUrl > displayUrl > url
 */
function pickImageUrl(currentImage) {
  if (!currentImage) return { url: '', type: 'none' };
  if (currentImage.dataUrl) return { url: currentImage.dataUrl, type: 'dataUrl' };
  if (currentImage.displayUrl) return { url: currentImage.displayUrl, type: 'url' };
  if (currentImage.url) return { url: currentImage.url, type: 'url' };
  return { url: '', type: 'none' };
}

/**
 * Generate a prompt by reversing an image using the unified default template.
 *
 * @param {object} options
 * @param {object} options.currentImage  — full image object (has dataUrl, displayUrl, url, sizeBytes, etc.)
 * @param {string} [options.extraInstruction]
 * @param {object} options.settings
 * @param {boolean} [options.mockMode]   — if explicitly true, allow mock fallback
 */
export async function generatePromptFromImage({ currentImage, extraInstruction, settings, mockMode = false }) {
  const api = settings?.promptApi || {};
  const type = api.type || PROMPT_API_TYPES.OPENAI_COMPATIBLE;
  const image = pickImageUrl(currentImage);
  const mergedExtraInstruction = mergeExtraInstructions(api.customInstruction, extraInstruction);

  if (!image.url && !mockMode) {
    throw new Error('没有可用的图片。请先导入一张图片。');
  }

  const fullUrl = buildUrl(api.baseUrl || '', api.endpoint || '/v1/chat/completions');

  appendLog({
    level: 'info',
    apiType: 'prompt',
    event: 'PROMPT_REVERSE_START',
    provider: type,
    endpoint: fullUrl,
    message: '开始反推提示词',
    data: {
      provider: type,
      model: api.model || '',
      endpointFullUrl: fullUrl,
      imageInputType: image.type,
      hasImage: !!image.url,
      imageSizeBytes: currentImage?.sizeBytes || 0,
      hasExtraInstruction: !!mergedExtraInstruction,
      hasSettingsCustomInstruction: !!String(api.customInstruction || '').trim()
    }
  });

  try {
    const systemPrompt = DEFAULT_PROMPT_TEMPLATE.systemPrompt;
    const userPrompt = DEFAULT_PROMPT_TEMPLATE.buildUserPrompt(mergedExtraInstruction);

    let raw;
    if (type === PROMPT_API_TYPES.CUSTOM) {
      raw = await callCustomPrompt({ api, systemPrompt, userPrompt, imageUrl: image.url });
    } else {
      raw = await callOpenAICompatiblePrompt({ api, systemPrompt, userPrompt, imageUrl: image.url, imageType: image.type });
    }

    const parsed = parseChatResponse(raw);

    // ── Result validation ──
    const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
    const zh = String(parsed.zh || '').trim();
    const en = String(parsed.en || '').trim();

    if (!zh) {
      throw Object.assign(new Error('反推结果为空：模型未返回有效中文提示词'), {
        code: 'INVALID_RESPONSE',
        provider: type,
        status: 0,
        raw
      });
    }
    if (!en) {
      console.warn('[PromptPilot] 英文提示词为空');
    }

    appendLog({
      level: 'info',
      apiType: 'prompt',
      event: 'PROMPT_REVERSE_SUCCESS',
      provider: type,
      endpoint: fullUrl,
      message: `反推完成: ${tags.length} tags, zh=${zh.length} chars, en=${en.length} chars`,
      data: { tagsCount: tags.length, zhLength: zh.length, enLength: en.length }
    });

    return {
      tags,
      zh,
      en,
      provider: type,
      parseWarning: parsed.parseWarning || undefined,
      raw
    };

  } catch (error) {
    appendLog({
      level: 'error',
      apiType: 'prompt',
      event: 'PROMPT_REVERSE_ERROR',
      provider: type,
      endpoint: fullUrl,
      status: error?.status || 0,
      message: `反推失败: ${error?.message || '未知错误'}`,
      error: { code: error?.code || 'UNKNOWN', message: error?.message || '' }
    });

    // Only fall back to mock if user explicitly enabled mockMode
    if (mockMode) {
      console.warn('[PromptPilot] mockMode enabled, returning mock result after error:', error?.message);
      return mockPromptResult(type);
    }

    throw error;
  }
}

/**
 * Enhance / optimize an existing prompt via the AI provider.
 */
export async function enhancePrompt({ text, language, settings }) {
  if (!text || !text.trim()) {
    return { text: '', language, provider: 'none', raw: {} };
  }

  const api = settings?.promptApi || {};
  const type = api.type || PROMPT_API_TYPES.OPENAI_COMPATIBLE;

  appendLog({
    level: 'info',
    apiType: 'prompt',
    event: 'PROMPT_OPTIMIZE_START',
    provider: type,
    message: `优化${language === 'zh' ? '中文' : '英文'}提示词`
  });

  try {
    const systemPrompt = language === 'zh'
      ? '你是一个专业的 AI 图像提示词优化专家。请优化用户提供的提示词，使其更详细、更具表现力。只输出优化后的文本。'
      : 'You are a professional AI image prompt optimizer. Enhance the provided prompt to be more detailed and expressive. Output only the optimized text.';

    const userPrompt = language === 'zh'
      ? `请优化以下中文提示词：\n\n${text}`
      : `Please optimize this English prompt:\n\n${text}`;

    let resultText;
    if (type === PROMPT_API_TYPES.CUSTOM) {
      const result = await callCustomPrompt({ api, systemPrompt, userPrompt, imageUrl: '' });
      resultText = result.zh || result.en || text;
    } else {
      // Text-only optimization — no image needed
      const raw = await callOpenAICompatiblePrompt({ api, systemPrompt, userPrompt, imageUrl: '', imageType: 'none' });
      resultText = raw.en || raw.zh || text;
    }

    appendLog({
      level: 'info',
      apiType: 'prompt',
      event: 'PROMPT_OPTIMIZE_SUCCESS',
      provider: type,
      message: `优化完成 (${language})`
    });

    return { text: resultText, language, provider: type, raw: {} };
  } catch (error) {
    appendLog({
      level: 'error',
      apiType: 'prompt',
      event: 'PROMPT_OPTIMIZE_ERROR',
      provider: type,
      message: `优化失败: ${error?.message || ''}`
    });
    return { text, language, provider: type, raw: {} };
  }
}

// ── Test API calls (from options page) ──

/** Test text-only connectivity. No image. */
export async function testPromptTextApi(settings) {
  const api = settings?.promptApi || {};
  const type = api.type || PROMPT_API_TYPES.OPENAI_COMPATIBLE;

  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw new Error('请先填写 Base URL、API Key 和 Model');
  }

  const url = buildUrl(api.baseUrl, api.endpoint || '/v1/chat/completions');
  const body = JSON.stringify({
    model: api.model,
    messages: [
      { role: 'user', content: 'Hi, respond with just "OK".' }
    ],
    max_tokens: 10
  });

  appendLog({
    level: 'info', apiType: 'prompt', event: 'TEST_PROMPT_TEXT_START',
    provider: type, endpoint: url,
    message: '测试文本接口连通性'
  });

  const raw = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
    body
  }, 30000, { apiType: 'prompt', provider: type });

  appendLog({
    level: 'info', apiType: 'prompt', event: 'TEST_PROMPT_TEXT_SUCCESS',
    provider: type, message: '文本接口连通性测试通过'
  });

  return raw;
}

/** Test vision connectivity with a small embedded test image. */
export async function testPromptVisionApi(settings) {
  const api = settings?.promptApi || {};
  const type = api.type || PROMPT_API_TYPES.OPENAI_COMPATIBLE;

  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw new Error('请先填写 Base URL、API Key 和 Model');
  }

  // Tiny 1x1 PNG in base64 — just to verify the model accepts image_url blocks
  const testImageDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const url = buildUrl(api.baseUrl, api.endpoint || '/v1/chat/completions');
  const body = JSON.stringify({
    model: api.model,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Describe this image in one word.' },
        { type: 'image_url', image_url: { url: testImageDataUrl } }
      ]
    }],
    max_tokens: 20
  });

  appendLog({
    level: 'info', apiType: 'prompt', event: 'TEST_PROMPT_VISION_START',
    provider: type, endpoint: url,
    message: '测试视觉接口连通性',
    data: { imageUrlType: 'dataUrl', hasImageContentBlock: true }
  });

  const raw = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
    body
  }, 30000, { apiType: 'prompt', provider: type });

  const content = raw?.choices?.[0]?.message?.content || '';
  appendLog({
    level: 'info', apiType: 'prompt', event: 'TEST_PROMPT_VISION_SUCCESS',
    provider: type, message: `视觉接口测试通过: ${content}`,
    data: { responseContent: content }
  });

  return raw;
}

// ── Provider implementations ──

/**
 * OpenAI-compatible Vision request.
 * Image MUST be sent as an image_url content block, NOT as text.
 */
async function callOpenAICompatiblePrompt({ api, systemPrompt, userPrompt, imageUrl, imageType }) {
  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw Object.assign(new Error('Prompt API 未配置。请在设置中填写 Base URL、API Key 和 Model。'), { code: 'CONFIG_MISSING' });
  }

  const fullUrl = buildUrl(api.baseUrl, api.endpoint || '/v1/chat/completions');

  // Build messages — if image is available, use vision content array
  const messages = [{ role: 'system', content: systemPrompt }];

  if (imageUrl && imageType !== 'none') {
    // Vision request: image as content block
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: userPrompt },
        { type: 'image_url', image_url: { url: imageUrl } }
      ]
    });
  } else {
    // Text-only request
    messages.push({ role: 'user', content: userPrompt });
  }

  const bodyObj = {
    model: api.model,
    messages,
    temperature: api.temperature ?? 0.2,
    max_tokens: api.maxTokens ?? 1200
  };
  const body = JSON.stringify(bodyObj);

  // Log request (without full base64)
  const bodyPreview = JSON.stringify({
    model: bodyObj.model,
    messages: bodyObj.messages.map((m) => {
      if (Array.isArray(m.content)) {
        return {
          role: m.role,
          content: m.content.map((c) =>
            c.type === 'image_url'
              ? { type: 'image_url', image_url: { url: c.image_url?.url?.slice(0, 80) + (c.image_url?.url?.length > 80 ? '...[truncated]' : '') } }
              : c
          )
        };
      }
      return m;
    }),
    temperature: bodyObj.temperature,
    max_tokens: bodyObj.max_tokens
  });

  appendLog({
    level: 'info',
    apiType: 'prompt',
    event: 'API_REQUEST_START',
    provider: api.type || 'openai-compatible',
    endpoint: fullUrl,
    method: 'POST',
    message: `POST ${fullUrl}`,
    requestPreview: {
      url: fullUrl,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${maskPreview(api.apiKey)}` },
      body: bodyPreview,
      hasImageContentBlock: !!(imageUrl && imageType !== 'none'),
      imageUrlType: imageType || 'none'
    }
  });

  const raw = await fetchJsonWithTimeout(fullUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
    body
  }, PROMPT_TIMEOUT, { apiType: 'prompt', provider: api.type || 'openai-compatible' });

  return raw;
}

function maskPreview(key) {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return key.slice(0, 4) + '****' + key.slice(-4);
}

function mergeExtraInstructions(...items) {
  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

async function callCustomPrompt({ api, systemPrompt, userPrompt, imageUrl }) {
  const custom = api.custom || {};
  if (!api.baseUrl || !api.endpoint) {
    throw Object.assign(new Error('自定义 Prompt API 未配置。'), { code: 'CONFIG_MISSING' });
  }

  const variables = {
    model: api.model || '',
    systemPrompt,
    userPrompt,
    imageUrl,
    temperature: api.temperature ?? 0.2,
    maxTokens: api.maxTokens ?? 1200,
    ...custom
  };

  const url = buildUrl(api.baseUrl, api.endpoint, variables);
  const method = custom.method || 'POST';

  appendLog({
    level: 'info',
    apiType: 'prompt',
    event: 'API_REQUEST_START',
    provider: 'custom-prompt',
    endpoint: url,
    method,
    message: `${method} ${url}`,
    requestPreview: { url, method }
  });

  const raw = await fetchJsonWithTimeout(url, {
    method,
    headers: buildHeaders({ ...custom, apiKey: api.apiKey }),
    body: method.toUpperCase() === 'GET' ? undefined : parseTemplateBody(custom.requestTemplate || '', variables)
  }, PROMPT_TIMEOUT, { apiType: 'prompt', provider: 'custom-prompt' });

  const mapped = mapResponse(raw, custom.responseMap || {});
  return { ...mapped, provider: 'custom-prompt', raw };
}

// ── Response parsing ──

function parseChatResponse(raw) {
  const content = raw?.choices?.[0]?.message?.content || '';
  if (!content) {
    throw Object.assign(new Error('模型返回了空内容。可能不支持视觉输入或接口配置有误。'), {
      code: 'INVALID_RESPONSE',
      raw
    });
  }

  // Try strict JSON parse
  try {
    const parsed = JSON.parse(content);
    return normalizePromptResult({ ...parsed, raw }, 'openai-compatible');
  } catch {
    // Try extractJson
    const extracted = extractJson(content);
    if (extracted) {
      return normalizePromptResult({ ...extracted, raw, parseWarning: 'extracted from text' }, 'openai-compatible');
    }

    // Can't extract JSON — put raw text into zh field with warning
    return normalizePromptResult({
      tags: [],
      zh: content,
      en: '',
      parseWarning: 'raw text, no JSON structure',
      raw
    }, 'openai-compatible');
  }
}

/**
 * Attempt to extract a JSON object from text that may contain markdown fences
 * or surrounding commentary.
 */
function extractJson(text) {
  if (!text) return null;

  // Try extracting from ```json ... ``` block
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1]); } catch {}
  }

  // Try finding first { ... } block
  const braceStart = text.indexOf('{');
  if (braceStart >= 0) {
    let depth = 0;
    let inString = false;
    let escapeNext = false;
    for (let i = braceStart; i < text.length; i++) {
      const ch = text[i];
      if (escapeNext) { escapeNext = false; continue; }
      if (ch === '\\') { escapeNext = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) {
        try { return JSON.parse(text.slice(braceStart, i + 1)); } catch { return null; }
      }}
    }
  }

  return null;
}
