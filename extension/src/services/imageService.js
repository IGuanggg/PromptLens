import { IMAGE_API_TYPES } from '../constants.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout, mapResponse, parseTemplateBody, replaceTemplate, getByPath } from '../utils/customApi.js';
import { ERROR_CODES, createAppError } from '../utils/errors.js';
import { normalizeImageResult, normalizeOpenAIImageResult } from '../utils/imageResult.js';
import { appendLog } from './logService.js';

export async function generateImages({
  prompt,
  negativePrompt = '',
  referenceImage = '',
  mode = 'standard',
  count = 4,
  width = 1024,
  height = 1024,
  settings = {}
}) {
  const api = settings?.imageApi || {};
  const type = api.type || IMAGE_API_TYPES.OPENAI_COMPATIBLE;

  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'IMAGE_GENERATE_START',
    provider: type,
    message: `开始生成图片: ${count}张 ${width}x${height}`,
    data: { mode, count, width, height, hasReference: !!referenceImage }
  });

  try {
    let result;
    if (type === IMAGE_API_TYPES.CUSTOM) {
      result = await callCustomImage({
        api, prompt, negativePrompt, referenceImage, mode, count, width, height, settings
      });
    } else {
      result = await callOpenAICompatibleImage({
        api, prompt, count, width, height
      });
    }

    const images = result.images || [];
    appendLog({
      level: 'info',
      apiType: 'image',
      event: 'IMAGE_GENERATE_SUCCESS',
      provider: type,
      message: `生成完成: ${images.length} 张图片`,
      data: { imagesCount: images.length }
    });

    return { images };
  } catch (error) {
    appendLog({
      level: 'error',
      apiType: 'image',
      event: 'IMAGE_GENERATE_ERROR',
      provider: type,
      message: `生成失败: ${error?.message || '未知错误'}`
    });
    throw error;
  }
}

// ── Provider implementations ──

async function callOpenAICompatibleImage({ api, prompt, count, width, height }) {
  if (!api.baseUrl || !api.apiKey || !api.model) {
    throw Object.assign(new Error('Image API 未配置。请在设置中填写 Base URL、API Key 和 Model。'), { code: 'CONFIG_MISSING' });
  }

  const size = api.size || `${width}x${height}`;
  const url = buildUrl(api.baseUrl, api.endpoint || '/v1/images/generations');
  const body = JSON.stringify({
    model: api.model,
    prompt,
    n: count,
    size,
    response_format: api.responseFormat || 'url'
  });

  const raw = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
    body
  }, 60000, { apiType: 'image', provider: 'openai-compatible-image' });

  return normalizeOpenAIImageResult(raw, 'openai-compatible-image', { width, height });
}

async function callCustomImage({ api, prompt, negativePrompt, referenceImage, mode, count, width, height, settings }) {
  const custom = api.custom || {};
  if (!api.baseUrl || !api.endpoint) {
    throw Object.assign(new Error('自定义 Image API 未配置。'), { code: 'CONFIG_MISSING' });
  }

  const size = api.size || `${width}x${height}`;
  const variables = {
    model: api.model || '',
    prompt,
    negativePrompt,
    referenceImage,
    width,
    height,
    size,
    count,
    mode,
    ...custom
  };

  const generateUrl = buildUrl(api.baseUrl, api.endpoint, variables);
  const method = custom.method || 'POST';

  const raw = await fetchJsonWithTimeout(generateUrl, {
    method,
    headers: buildHeaders({ ...custom, apiKey: api.apiKey }),
    body: method.toUpperCase() === 'GET' ? undefined : parseTemplateBody(custom.requestTemplate || '', variables)
  }, 60000, { apiType: 'image', provider: 'custom-image' });

  // Handle async polling
  const finalRaw = custom.requestMode === 'async'
    ? await pollCustomImage(raw, api, custom, variables)
    : raw;

  return normalizeImageResult(finalRaw, 'custom-image', {
    width,
    height,
    responseMap: custom.responseMap || {},
    requireImages: true
  });
}

async function pollCustomImage(initialRaw, api, custom, variables) {
  const responseMap = custom.responseMap || {};
  const taskId = getByPath(initialRaw, responseMap.taskId || 'id');
  const statusPath = custom.statusEndpoint;
  if (!taskId || !statusPath) return initialRaw;

  const maxPolls = 60;
  const interval = 1500;
  for (let i = 0; i < maxPolls; i++) {
    await wait(interval);
    const statusEndpoint = replaceTemplate(statusPath, { ...variables, id: taskId, taskId });
    const statusUrl = buildUrl(api.baseUrl, statusEndpoint, { ...variables, id: taskId, taskId });
    const raw = await fetchJsonWithTimeout(statusUrl, {
      method: 'GET',
      headers: buildHeaders({ ...custom, apiKey: api.apiKey })
    }, 60000, { apiType: 'image', provider: 'custom-image' });
    const status = String(getByPath(raw, responseMap.status || 'status') || '').toLowerCase();
    if (['succeeded', 'success', 'completed', 'done', 'finished'].includes(status)) return raw;
    if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
      throw createAppError({
        code: ERROR_CODES.TASK_FAILED,
        message: `Image task failed: ${status}`,
        provider: 'custom-image',
        raw,
        retryable: false
      });
    }
  }

  throw createAppError({
    code: ERROR_CODES.TIMEOUT,
    message: 'Image task polling timeout',
    provider: 'custom-image',
    retryable: true
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
