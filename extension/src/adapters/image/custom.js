import { mockImages } from '../../utils/mockImages.js';
import { REQUEST_MODES } from '../../constants.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout, getByPath, parseTemplateBody, replaceTemplate } from '../../utils/customApi.js';
import { ERROR_CODES, createAppError } from '../../utils/errors.js';
import { normalizeImageResult } from '../../utils/imageResult.js';

export async function callCustomImageApi({ prompt, negativePrompt, referenceImage, settings, defaults = {}, mode, count, width = 720, height = 720, size, dashscopeSize, outputSize, debug }) {
  if (!settings?.baseUrl || !settings?.generateApiPath) return mockImages('custom-image-mock', count || 4, outputSize?.width || width, outputSize?.height || height);

  const variables = {
    ...settings,
    model: settings.model || '',
    prompt,
    negativePrompt,
    referenceImage,
    width: outputSize?.width || width,
    height: outputSize?.height || height,
    size: size || outputSize?.size || `${width}x${height}`,
    dashscopeSize: dashscopeSize || outputSize?.dashscopeSize || `${width}*${height}`,
    aspectRatio: outputSize?.aspectRatio || settings.aspectRatio || '',
    resolutionPreset: outputSize?.resolutionPreset || settings.resolutionPreset || '',
    sizeMode: outputSize?.sizeMode || settings.sizeMode || '',
    count,
    mode,
    steps: settings.steps || defaults.steps || '',
    cfgScale: settings.cfgScale || defaults.cfgScale || '',
    seed: settings.seed || defaults.seed || defaults.seedMode || 'random'
  };

  const generateUrl = buildUrl(settings.baseUrl, settings.generateApiPath, variables);
  const method = settings.method || 'POST';
  const generated = await fetchJsonWithTimeout(generateUrl, {
    method,
    headers: buildHeaders(settings),
    body: method.toUpperCase() === 'GET' ? undefined : parseTemplateBody(settings.requestTemplate, variables)
  }, settings.timeout || 60000, { provider: 'custom', debug: { ...debug, apiKey: settings.apiKey || settings.customHeaderValue } });

  const finalRaw = settings.requestMode === REQUEST_MODES.ASYNC
    ? await pollCustomImageResult(generated, settings, variables, debug)
    : generated;

  return normalizeImageResult(finalRaw, 'custom', {
    width,
    height,
    responseMap: settings.responseMap,
    requireImages: true
  });
}

async function pollCustomImageResult(initialRaw, settings, variables, debug) {
  const map = settings.responseMap || {};
  const taskId = getByPath(initialRaw, map.taskId || 'id');
  const statusPath = settings.statusEndpoint || settings.statusApiPath;
  if (!taskId || !statusPath) return initialRaw;

  const attempts = Number(settings.maxPollCount || settings.maxPollAttempts || 60);
  const interval = Number(settings.pollInterval || 1500);
  for (let index = 0; index < attempts; index += 1) {
    await wait(interval);
    const statusEndpoint = replaceTemplate(statusPath, { ...variables, id: taskId, taskId });
    const statusUrl = buildUrl(settings.baseUrl, statusEndpoint, { ...variables, id: taskId, taskId });
    const raw = await fetchJsonWithTimeout(statusUrl, {
      method: 'GET',
      headers: buildHeaders(settings)
    }, settings.timeout || 60000, { provider: 'custom', debug: { ...debug, apiKey: settings.apiKey || settings.customHeaderValue } });
    const status = String(getByPath(raw, map.status || 'status') || '').toLowerCase();
    if (['succeeded', 'success', 'completed', 'done', 'finished'].includes(status)) return raw;
    if (['failed', 'error', 'canceled', 'cancelled'].includes(status)) {
      throw createAppError({
        code: ERROR_CODES.TASK_FAILED,
        message: `Custom image task failed: ${status}`,
        provider: 'custom',
        raw,
        retryable: false
      });
    }
  }

  throw createAppError({
    code: ERROR_CODES.TIMEOUT,
    message: 'Custom image task polling timeout',
    provider: 'custom',
    retryable: true
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
