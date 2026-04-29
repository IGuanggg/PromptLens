import { IMAGE_API_TYPES } from '../constants.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout, mapResponse, parseTemplateBody, replaceTemplate, getByPath } from '../utils/customApi.js';
import { ERROR_CODES, createAppError } from '../utils/errors.js';
import { normalizeImageResult, normalizeOpenAIImageResult } from '../utils/imageResult.js';
import { mockImages } from '../utils/mockImages.js';
import { getOutputSize, mapSizeForOpenAIImages } from '../utils/size.js';
import { appendLog } from './logService.js';

export async function generateImages({
  prompt,
  negativePrompt = '',
  referenceImage = '',
  mode = 'standard',
  count = 4,
  width = 720,
  height = 720,
  size = `${width}x${height}`,
  dashscopeSize = `${width}*${height}`,
  outputSize = null,
  settings = {}
}) {
  const api = settings?.imageApi || {};
  const type = api.type || IMAGE_API_TYPES.OPENAI_COMPATIBLE;
  const finalOutputSize = outputSize ? {
    ...outputSize,
    dashscopeSize: outputSize.dashscopeSize || `${outputSize.width}*${outputSize.height}`
  } : getOutputSize({
    sizeMode: api.sizeMode,
    aspectRatio: api.aspectRatio,
    resolutionPreset: api.resolutionPreset,
    customWidth: api.customWidth,
    customHeight: api.customHeight,
    referenceImage
  });
  const adapterInput = {
    prompt,
    negativePrompt,
    referenceImage,
    mode,
    count,
    width: finalOutputSize.width,
    height: finalOutputSize.height,
    size: finalOutputSize.size,
    dashscopeSize: finalOutputSize.dashscopeSize,
    outputSize: finalOutputSize,
    settings
  };

  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'IMAGE_GENERATE_START',
    provider: type,
    message: `Image generate start: ${count} images, ${finalOutputSize.size}`,
    data: {
      mode,
      count,
      width: finalOutputSize.width,
      height: finalOutputSize.height,
      requestedSize: finalOutputSize.size,
      dashscopeSize: finalOutputSize.dashscopeSize,
      sizeMode: finalOutputSize.sizeMode,
      aspectRatio: finalOutputSize.aspectRatio,
      resolutionPreset: finalOutputSize.resolutionPreset,
      hasReference: !!referenceImage
    }
  });

  try {
    let result;
    if (type === IMAGE_API_TYPES.CUSTOM) {
      result = await callCustomImage({ api, ...adapterInput });
    } else {
      result = await callOpenAICompatibleImage({ api, ...adapterInput });
    }

    const images = result.images || [];
    appendLog({
      level: 'info',
      apiType: 'image',
      event: 'IMAGE_GENERATE_SUCCESS',
      provider: type,
      message: `生成完成: ${images.length} 张图片`,
      data: {
        imagesCount: images.length,
        requestedSize: finalOutputSize.size,
        resultSizes: images.map((image) => ({
          id: image.id,
          width: image.width || 0,
          height: image.height || 0,
          resultSize: image.width && image.height ? `${image.width}x${image.height}` : ''
        }))
      }
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

async function callOpenAICompatibleImage({ api, prompt, count, width, height, size, dashscopeSize, outputSize }) {
  if (!api.baseUrl || !api.apiKey || !api.model) {
    return mockImages('openai-compatible-image-mock', count || 4, width, height);
  }

  const requestedSize = size || outputSize?.size || `${width}x${height}`;
  const sizeFormat = api.sizeFormat || 'x';
  const providerSize = getProviderSize({ requestedSize, dashscopeSize, sizeFormat });
  if (sizeFormat === 'openai-mapped' && providerSize !== requestedSize) {
    appendLog({
      level: 'info',
      apiType: 'image',
      event: 'IMAGE_SIZE_MAPPED',
      provider: 'openai-compatible-image',
      message: `Image size mapped: ${requestedSize} -> ${providerSize}`,
      data: {
        requestedSize,
        providerSize,
        provider: 'openai-compatible-image',
        reason: 'OpenAI-compatible provider only supports fixed image sizes'
      }
    });
  }
  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'IMAGE_PAYLOAD_SIZE',
    provider: 'openai-compatible-image',
    message: `Image payload size: ${providerSize}`,
    data: { requestedSize, providerSize, width, height, sizeFormat, provider: 'openai-compatible-image' }
  });
  const url = buildUrl(api.baseUrl, api.endpoint || '/v1/images/generations');
  const body = JSON.stringify({
    model: api.model,
    prompt,
    n: count,
    size: providerSize,
    response_format: api.responseFormat || 'url'
  });

  const raw = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
    body
  }, 60000, { apiType: 'image', provider: 'openai-compatible-image' });

  return normalizeOpenAIImageResult(raw, 'openai-compatible-image', { width, height });
}

async function callCustomImage({ api, prompt, negativePrompt, referenceImage, mode, count, width, height, size, dashscopeSize, outputSize, settings }) {
  const custom = api.custom || {};
  if (!api.baseUrl || !api.endpoint) {
    return mockImages('custom-image-mock', count || 4, width, height);
  }

  const requestedSize = size || outputSize?.size || `${width}x${height}`;
  const finalDashscopeSize = dashscopeSize || outputSize?.dashscopeSize || `${width}*${height}`;
  const sizeFormat = api.sizeFormat || 'x';
  const providerSize = getProviderSize({ requestedSize, dashscopeSize: finalDashscopeSize, sizeFormat });
  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'IMAGE_PAYLOAD_SIZE',
    provider: 'custom-image',
    message: `Custom image payload size: ${providerSize}`,
    data: { requestedSize, providerSize, width, height, sizeFormat, provider: 'custom-image' }
  });
  const variables = {
    ...custom,
    model: api.model || '',
    prompt,
    negativePrompt,
    referenceImage,
    width,
    height,
    size: requestedSize,
    dashscopeSize: finalDashscopeSize,
    providerSize,
    aspectRatio: outputSize?.aspectRatio || api.aspectRatio || '',
    resolutionPreset: outputSize?.resolutionPreset || api.resolutionPreset || '',
    sizeMode: outputSize?.sizeMode || api.sizeMode || '',
    count,
    mode
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

function getProviderSize({ requestedSize, dashscopeSize, sizeFormat }) {
  if (sizeFormat === '*') return dashscopeSize || requestedSize.replace('x', '*');
  if (sizeFormat === 'openai-mapped') return mapSizeForOpenAIImages(requestedSize);
  return requestedSize;
}
