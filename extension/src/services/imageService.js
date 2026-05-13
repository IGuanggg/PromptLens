import { IMAGE_API_TYPES } from '../constants.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout, replaceTemplate, getByPath } from '../utils/customApi.js';
import { ERROR_CODES, createAppError } from '../utils/errors.js';
import { normalizeImageResult, normalizeOpenAIImageResult } from '../utils/imageResult.js';
import { mockImages } from '../utils/mockImages.js';
import { getOutputSize, mapSizeForOpenAIImages, getProviderSize } from '../utils/size.js';
import { createMultiAnglePrompts } from './anglePromptService.js';
import { appendLog } from './logService.js';
import { findImageModelConfig, getImageModelConfig, buildImageApiPayload, validateNanoBananaPayload, sanitizePromptForImageGeneration } from '../data/imageModels.js';
import { extractTaskId, pollImageResult, normalizeImageTaskFailure } from './imageTaskService.js';
import { buildCustomImageRequest } from './imageRequestBuilder.js';

export async function generateImages({
  prompt,
  negativePrompt = '',
  referenceImage = '',
  mode = 'standard',
  count = 4,
  width = 1080,
  height = 1080,
  size = `${width}x${height}`,
  dashscopeSize = `${width}*${height}`,
  outputSize = null,
  settings = {},
  trace = null
}) {
  const api = settings?.imageApi || {};
  const type = api.type || IMAGE_API_TYPES.OPENAI_COMPATIBLE;
  const logContext = createLogContext(trace, 'img');
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
    settings,
    trace: logContext
  };

  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'IMAGE_GENERATE_START',
    provider: type,
    message: `Image generate start: ${count} images, ${finalOutputSize.size}`,
    data: {
      ...logContext,
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
        ...logContext,
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

    return { images, provider: result.provider || type, raw: result.raw || null };
  } catch (error) {
    appendLog({
      level: 'error',
      apiType: 'image',
      event: 'IMAGE_GENERATE_ERROR',
      provider: type,
      message: `生成失败: ${error?.message || '未知错误'}`,
      data: {
        ...logContext,
        code: error?.code || '',
        status: error?.status || 0,
        provider: error?.provider || type,
        rawStatus: error?.raw?.status || '',
        rawError: error?.raw?.error || error?.raw?.failure_reason || ''
      }
    });
    throw error;
  }
}

export async function generateMultiAngleImages({
  prompt = '',
  promptZh = '',
  promptEn = '',
  negativePrompt = '',
  referenceImage = '',
  extraPrompt = '',
  settings = {},
  outputSize = null
}) {
  const api = settings?.imageApi || {};
  const provider = api.type || IMAGE_API_TYPES.OPENAI_COMPATIBLE;
  const batchContext = createLogContext({ batchId: createTraceId('multi') }, 'multi');
  const finalOutputSize = outputSize || getOutputSize({
    sizeMode: api.sizeMode,
    aspectRatio: api.aspectRatio,
    resolutionPreset: api.resolutionPreset,
    customWidth: api.customWidth,
    customHeight: api.customHeight,
    referenceImage
  });

  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'MULTI_ANGLE_GENERATE_START',
    provider,
    message: `Multi-angle generation start: ${finalOutputSize.size}`,
    data: {
      ...batchContext,
      requestedSize: finalOutputSize.size,
      width: finalOutputSize.width,
      height: finalOutputSize.height,
      aspectRatio: finalOutputSize.aspectRatio,
      resolutionPreset: finalOutputSize.resolutionPreset
    }
  });

  const anglePrompts = createMultiAnglePrompts({
    basePrompt: prompt,
    promptZh,
    promptEn,
    referenceImage,
    extraPrompt
  });

  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'MULTI_ANGLE_PROMPT_CREATED',
    provider,
    message: 'Created multi-angle prompts',
    data: {
      ...batchContext,
      count: anglePrompts.length,
      angles: anglePrompts.map((item) => item.key)
    }
  });

  const images = [];
  const raw = {};

  for (const angle of anglePrompts) {
    const anglePrompt = angle.anglePromptEn || angle.anglePromptZh;
    const angleContext = createLogContext({
      batchId: batchContext.batchId,
      angleKey: angle.key
    }, `angle_${angle.key}`);
    appendLog({
      level: 'info',
      apiType: 'image',
      event: 'MULTI_ANGLE_IMAGE_START',
      provider,
      message: `Generating ${angle.label}`,
      data: {
        ...angleContext,
        angleKey: angle.key,
        label: angle.label,
        promptPreview: anglePrompt.slice(0, 240),
        requestedSize: finalOutputSize.size,
        provider
      }
    });

    try {
      // Sanitize angle prompt if enabled
      const shouldSanitize = settings?.promptApi?.enablePromptSanitizer !== false;
      const rawAnglePrompt = anglePrompt;
      const sanitizedAnglePrompt = shouldSanitize ? sanitizePromptForImageGeneration(rawAnglePrompt) : rawAnglePrompt;
      const finalAnglePrompt = sanitizedAnglePrompt || rawAnglePrompt;
      if (shouldSanitize && finalAnglePrompt !== rawAnglePrompt) {
        appendLog({ level: 'info', apiType: 'image', event: 'PROMPT_SANITIZER_APPLIED', provider, message: `Angle ${angle.label} prompt sanitized`, data: { enabled: true, changed: true, originalLength: rawAnglePrompt.length, sanitizedLength: finalAnglePrompt.length, mode: 'multi-angle', angleKey: angle.key } });
      }

      const result = await generateImages({
        prompt: finalAnglePrompt,
        negativePrompt,
        referenceImage,
        mode: 'multi-angle',
        count: 1,
        width: finalOutputSize.width,
        height: finalOutputSize.height,
        size: finalOutputSize.size,
        dashscopeSize: finalOutputSize.dashscopeSize,
        outputSize: finalOutputSize,
        settings,
        trace: angleContext
      });
      const image = (result.images || [])[0];
      if (!image) throw new Error(`${angle.label} 未返回图片`);

      images.push({
        ...image,
        label: angle.label,
        angleKey: angle.key,
        prompt: anglePrompt
      });
      raw[angle.key] = result.raw || null;

      appendLog({
        level: 'info',
        apiType: 'image',
        event: 'MULTI_ANGLE_IMAGE_SUCCESS',
        provider,
        message: `${angle.label} generated`,
        data: {
          ...angleContext,
          angleKey: angle.key,
          label: angle.label,
          requestedSize: finalOutputSize.size,
          provider
        }
      });
    } catch (error) {
      const failed = createFailedAngleResult(angle, anglePrompt, provider, finalOutputSize, error);
      images.push(failed);
      raw[angle.key] = serializeAngleError(error);

      appendLog({
        level: 'error',
        success: false,
        apiType: 'image',
        event: 'MULTI_ANGLE_IMAGE_ERROR',
        provider,
        message: `${angle.label} failed: ${error?.message || 'unknown error'}`,
        data: {
          ...angleContext,
          angleKey: angle.key,
          label: angle.label,
          promptPreview: anglePrompt.slice(0, 240),
          requestedSize: finalOutputSize.size,
          provider
        }
      });
    }
  }

  const failedCount = images.filter((image) => image.failed).length;
  const successCount = images.length - failedCount;
  appendLog({
    level: failedCount ? 'warn' : 'info',
    success: failedCount === 0,
    apiType: 'image',
    event: failedCount ? 'MULTI_ANGLE_GENERATE_ERROR' : 'MULTI_ANGLE_GENERATE_SUCCESS',
    provider,
    message: failedCount ? `Multi-angle completed with ${failedCount} failed` : 'Multi-angle generation completed',
    data: {
      ...batchContext,
      requestedSize: finalOutputSize.size,
      successCount,
      failedCount,
      angles: images.map((image) => ({ angleKey: image.angleKey, label: image.label, failed: !!image.failed }))
    }
  });

  if (successCount === 0) {
    const hint = createMultiAngleFailureHint({ api, outputSize: finalOutputSize });
    throw createAppError({
      code: ERROR_CODES.TASK_FAILED,
      message: hint ? `多角度生成全部失败。${hint}` : '多角度生成全部失败',
      provider,
      raw: {
        ...batchContext,
        requestedSize: finalOutputSize.size,
        providerSize: getProviderSize({
          requestedSize: finalOutputSize.size,
          dashscopeSize: finalOutputSize.dashscopeSize,
          sizeFormat: api.sizeFormat || 'x'
        }),
        sizeFormat: api.sizeFormat || 'x',
        hint,
        failedCount,
        angles: images.map((image) => ({
          angleKey: image.angleKey,
          label: image.label,
          errorMessage: image.errorMessage || ''
        })),
        responses: raw
      },
      retryable: false
    });
  }

  return {
    images,
    provider,
    mode: 'multi-angle',
    raw
  };
}

// ── Provider implementations ──

async function callOpenAICompatibleImage({ api, prompt, count, width, height, size, dashscopeSize, outputSize, trace }) {
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
        ...trace,
        requestedSize,
        providerSize,
        provider: 'openai-compatible-image',
        reason: 'Provider only supports fixed image sizes'
      }
    });
  }
  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'IMAGE_PAYLOAD_SIZE',
    provider: 'openai-compatible-image',
    message: `Image payload size: ${providerSize}`,
    data: { ...trace, requestedSize, providerSize, width, height, sizeFormat, provider: 'openai-compatible-image' }
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
  }, 300000, { apiType: 'image', provider: 'openai-compatible-image' });

  return normalizeOpenAIImageResult(raw, 'openai-compatible-image', { width, height });
}

// ── Draw API: channel-aware submit + async poll ──

async function callDrawApi({ api, prompt, referenceImage, width, height, dashscopeSize, outputSize, modelConfig, settings, trace }) {
  const baseUrl = (api.baseUrl || '').replace(/\/+$/, '');
  const submitUrl = `${baseUrl}${modelConfig.submitEndpoint}`;
  const resultEp = api.resultEndpoint || modelConfig.resultEndpoint || '/v1/api/result';
  const resultMethod = api.resultMethod || modelConfig.resultMethod || 'GET';
  const resultIdMode = api.resultIdMode || modelConfig.resultIdMode || 'query';
  const resultIdParam = api.resultIdParam || modelConfig.resultIdParam || 'id';
  const channel = modelConfig.channel;

  // ── Prompt sanitizer ──
  const rawPrompt = prompt;
  const shouldSanitize = settings?.promptApi?.enablePromptSanitizer !== false; // default true
  let sanitizedPrompt = rawPrompt;
  if (shouldSanitize && rawPrompt) {
    sanitizedPrompt = sanitizePromptForImageGeneration(rawPrompt);
    const changed = sanitizedPrompt !== rawPrompt;
    appendLog({
      level: 'info', apiType: 'image',
      event: changed ? 'PROMPT_SANITIZER_APPLIED' : 'PROMPT_SANITIZER_SKIPPED',
      provider: 'draw-api',
      message: changed ? 'Prompt sanitized before generation' : 'Prompt sanitizer skipped (no changes)',
      data: { ...trace, enabled: true, enabledFrom: 'promptApi.enablePromptSanitizer', changed, originalLength: rawPrompt.length, sanitizedLength: sanitizedPrompt.length, mode: 'single' }
    });
  } else {
    appendLog({
      level: 'info', apiType: 'image',
      event: 'PROMPT_SANITIZER_SKIPPED',
      provider: 'draw-api',
      message: 'Prompt sanitizer disabled',
      data: { ...trace, enabled: false, enabledFrom: 'promptApi.enablePromptSanitizer', originalLength: rawPrompt?.length || 0 }
    });
  }
  const finalPrompt = sanitizedPrompt || rawPrompt;

  // Resolve reference image URLs
  const refUrl = typeof referenceImage === 'string' ? referenceImage :
    (referenceImage?.dataUrl || referenceImage?.displayUrl || referenceImage?.url || '');
  const imagesArr = refUrl ? [refUrl] : [];

  // Build payload via shared v2 payload builder
  const { payload, safeRes, imageSize: finalImageSize } = buildImageApiPayload({
    model: api.model, prompt: finalPrompt,
    outputSize, channel, images: imagesArr,
    settings: settings || {}
  });

  if (safeRes !== outputSize?.resolutionPreset && safeRes) {
    appendLog({ level: 'warn', apiType: 'image', event: 'IMAGE_MODEL_CAPABILITY_ADJUSTED', provider: 'draw-api', message: `Resolution adjusted for ${api.model}`, data: { ...trace, model: api.model, fromResolution: outputSize?.resolutionPreset, toResolution: safeRes, reason: `model only supports: ${(getImageModelConfig(api.model)?.supportsResolutions || []).join(', ')}` } });
  }

  if (channel === 'nano-banana') {
    validateNanoBananaPayload(payload);
  }

  appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_REQUEST_BUILD', provider: 'draw-api', message: `${channel} request: ${payload.aspectRatio}${finalImageSize ? ' ' + finalImageSize : ''}`,
    data: { ...trace, model: api.model, channel, endpoint: submitUrl, aspectRatio: payload.aspectRatio, imageSize: finalImageSize, imagesCount: imagesArr.length, replyType: 'json' } });

  // Validate single-model consistency
  const selectedModel = api.model;
  if (payload.model !== selectedModel) {
    throw createAppError({
      code: ERROR_CODES.MODEL_MISMATCH,
      message: `模型不一致：选择的是 ${selectedModel}，实际请求是 ${payload.model}`,
      provider: 'draw-api',
      raw: { selectedModel, payloadModel: payload.model },
      retryable: false
    });
  }

  // Model-endpoint validation: if user overrides endpoint, verify it matches the model's expected endpoint
  if (api.customEndpointOverride && api.endpoint && api.endpoint !== modelConfig.submitEndpoint) {
    appendLog({ level: 'warn', apiType: 'image', event: 'MODEL_ENDPOINT_MISMATCH', provider: 'draw-api', message: `Endpoint mismatch`, data: { ...trace, model: api.model, channel, endpoint: api.endpoint, expectedEndpoint: modelConfig.submitEndpoint } });
    throw createAppError({
      code: ERROR_CODES.MODEL_MISMATCH,
      message: `当前模型 ${api.model} 与接口 ${api.endpoint} 不匹配。预期接口：${modelConfig.submitEndpoint}。请关闭自定义 Endpoint 或切换正确模型。`,
      provider: 'draw-api', raw: { model: api.model, endpoint: api.endpoint, expectedEndpoint: modelConfig.submitEndpoint }, retryable: false
    });
  }

  appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_MODEL_ROUTE', provider: 'draw-api', message: `Route: ${channel}`, data: { ...trace, selectedModel, channel, endpoint: submitUrl, resultEndpoint: resultEp, resultMethod, resultIdMode, resultIdParam, customEndpointOverride: api.customEndpointOverride || false } });
  appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_PAYLOAD_BUILT', provider: 'draw-api', message: `Payload: ${channel}`, data: { ...trace, channel, ...payload } });

  // Submit
  const submitTimeout = 300000;
  const headers = { 'Content-Type': 'application/json' };
  if (api.apiKey) headers.Authorization = `Bearer ${api.apiKey}`;

  const submitRaw = await fetchJsonWithTimeout(submitUrl, {
    method: 'POST', headers, body: JSON.stringify(payload)
  }, submitTimeout, { apiType: 'image', provider: 'draw-api' });

  const taskId = extractTaskId(submitRaw);
  if (!taskId) {
    // Fallback: parse direct result (might have inline images)
    return normalizeImageResult(submitRaw, 'draw-api', { width, height, requireImages: true });
  }

  // Fast return: if the API returned sync results (status=succeeded with results array), skip polling
  const syncStatus = String(submitRaw?.status || submitRaw?.data?.status || '').toLowerCase();
  const syncResults = submitRaw?.results || submitRaw?.data?.results || [];
  if (syncStatus === 'succeeded' && syncResults.length > 0) {
    appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_TASK_SYNC_RESULT', provider: 'draw-api', message: `Sync result for ${taskId}: ${syncResults.length} images`, data: { ...trace, taskId, resultCount: syncResults.length } });
    return {
      images: syncResults.map((item, idx) => ({
        id: item.id || `${taskId}_${idx}`,
        url: item.url || item.image || '',
        thumbUrl: item.url || item.image || '',
        label: `结果 ${idx + 1}`,
        provider: 'draw-api',
        width,
        height
      })),
      provider: 'draw-api',
      raw: { taskId, resultRaw: submitRaw }
    };
  }

  appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_TASK_SUBMITTED', provider: 'draw-api', message: `Task: ${taskId}`, data: { ...trace, taskId, model: api.model, channel } });

  // Poll
  const pollResult = await pollImageResult({
    taskId, baseUrl, resultEndpoint: resultEp,
    apiKey: api.apiKey,
    pollIntervalMs: api.pollIntervalMs || 3000,
    maxPollCount: api.maxPollCount || 240,
    provider: 'draw-api',
    resultMethod,
    resultIdMode,
    resultIdParam,
    trace
  });

  return { images: pollResult.images || [], provider: 'draw-api', raw: pollResult.raw || {} };
}

async function callCustomImage({ api, prompt, negativePrompt, referenceImage, mode, count, width, height, size, dashscopeSize, outputSize, settings, trace }) {
  const custom = api.custom || {};

  // ── Channel-aware routing for known models ──
  const modelConfig = findImageModelConfig(api.model);
  if (modelConfig?.channel) {
    return callDrawApi({ api, prompt, referenceImage, width, height, dashscopeSize, outputSize, modelConfig, settings, trace });
  }

  // ── Legacy custom API flow ──
  if (!api.baseUrl || !api.endpoint) {
    return mockImages('custom-image-mock', count || 4, width, height);
  }

  const request = buildCustomImageRequest({
    api,
    prompt,
    negativePrompt,
    referenceImage,
    outputSize: outputSize || {
      width,
      height,
      size: size || `${width}x${height}`,
      dashscopeSize: dashscopeSize || `${width}*${height}`,
      aspectRatio: api.aspectRatio || '',
      resolutionPreset: api.resolutionPreset || '',
      sizeMode: api.sizeMode || ''
    },
    count,
    mode
  });
  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'IMAGE_PAYLOAD_SIZE',
    provider: 'custom-image',
    message: `Custom image payload size: ${request.providerSize}`,
    data: { ...trace, requestedSize: request.variables.size, providerSize: request.providerSize, width, height, sizeFormat: request.sizeFormat, provider: 'custom-image' }
  });

  const raw = await fetchJsonWithTimeout(request.url, {
    method: request.method,
    headers: request.headers,
    body: request.body
  }, 300000, { apiType: 'image', provider: 'custom-image' });

  // Handle async polling
  const finalRaw = custom.requestMode === 'async'
    ? await pollCustomImage(raw, api, custom, request.variables)
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
    const statusUrl = buildUrl(api.baseUrl, statusEndpoint, { ...variables, apiKey: api.apiKey || '', id: taskId, taskId });
    const raw = await fetchJsonWithTimeout(statusUrl, {
      method: 'GET',
      headers: buildHeaders({ ...custom, apiKey: api.apiKey })
    }, 120000, { apiType: 'image', provider: 'custom-image' });
    const status = String(getByPath(raw, responseMap.status || 'status') || '').toLowerCase();
    if (['succeeded', 'success', 'completed', 'done', 'finished'].includes(status)) return raw;
    if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
      const failureReason = getByPath(raw, responseMap.failureReason || 'failure_reason') || raw?.failure_reason || '';
      const errorMsg = getByPath(raw, responseMap.error || 'error') || raw?.error || '';
      throw normalizeImageTaskFailure({ failure_reason: failureReason, error: errorMsg, status }, 'custom-image');
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

function createFailedAngleResult(angle, prompt, provider, outputSize, error) {
  return {
    id: `failed_${angle.key}_${Date.now()}`,
    url: '',
    thumbUrl: '',
    label: angle.label,
    angleKey: angle.key,
    provider,
    width: outputSize.width,
    height: outputSize.height,
    prompt,
    failed: true,
    errorMessage: error?.message || '该角度生成失败'
  };
}

function serializeAngleError(error) {
  return {
    error: error?.message || 'unknown error',
    code: error?.code || '',
    status: Number(error?.status || 0),
    rawStatus: error?.raw?.status || error?.raw?.data?.status || '',
    rawError: error?.raw?.error || error?.raw?.failure_reason || error?.raw?.message || error?.raw?.data?.error || error?.raw?.data?.failure_reason || ''
  };
}

function createMultiAngleFailureHint({ api, outputSize }) {
  const sizeFormat = api.sizeFormat || 'x';
  if (api.type !== IMAGE_API_TYPES.CUSTOM && sizeFormat !== 'openai-mapped') {
    const mapped = mapSizeForOpenAIImages(outputSize.size);
    if (mapped !== outputSize.size) {
      return `当前请求尺寸为 ${outputSize.size}，OpenAI 兼容接口通常不支持该尺寸；请在设置中把 Image API 的 Size Format 改为 OpenAI mapped，或改用 1K/1:1 后重试。`;
    }
  }
  if (sizeFormat === 'openai-mapped' && ['2k', '4k'].includes(outputSize.resolutionPreset)) {
    return '当前为高清多角度连续生成，请尝试切换到 1K 或确认模型支持当前比例的图像生成。';
  }
  return '';
}

function createTraceId(prefix = 'req') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLogContext(trace, fallbackPrefix = 'req') {
  const requestId = trace?.requestId || createTraceId(fallbackPrefix);
  const context = { requestId };
  if (trace?.batchId) context.batchId = trace.batchId;
  if (trace?.angleKey) context.angleKey = trace.angleKey;
  return context;
}
