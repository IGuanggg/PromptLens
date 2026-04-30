import { mockImages } from '../../utils/mockImages.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout } from '../../utils/customApi.js';
import { normalizeOpenAIImageResult } from '../../utils/imageResult.js';
import { mapSizeForOpenAIImages } from '../../utils/size.js';
import { appendLog } from '../../services/logService.js';

export async function callOpenAICompatibleImage({ prompt, settings, count, width, height, size, dashscopeSize, outputSize, debug }) {
  if (!settings?.baseUrl || !settings?.apiKey || !settings?.model) {
    return mockImages('openai-compatible-image-mock', count || 4, width, height);
  }

  const url = buildUrl(settings.baseUrl, settings.endpoint || '/v1/images/generations');
  const requestedSize = size || outputSize?.size || `${width}x${height}`;
  const sizeFormat = settings.sizeFormat || 'x';
  const providerSize = getProviderSize({
    requestedSize,
    dashscopeSize: dashscopeSize || outputSize?.dashscopeSize || `${width}*${height}`,
    sizeFormat
  });
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
    data: { requestedSize, providerSize, width, height, sizeFormat, provider: 'openai-compatible-image' }
  });
  const body = {
    model: settings.model,
    prompt,
    n: Number(count || 1),
    size: providerSize,
    response_format: settings.responseFormat || 'url'
  };
  if (settings.quality) body.quality = settings.quality;

  const raw = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: buildHeaders({ authType: 'bearer', apiKey: settings.apiKey }),
    body: JSON.stringify(body)
  }, settings.timeout || 60000, { apiType: 'image', provider: 'openai-compatible-image', debug: { ...debug, apiKey: settings.apiKey } });

  return normalizeOpenAIImageResult(raw, 'openai-compatible-image', {
    width,
    height,
    responseMap: settings.responseMap || { images: 'data' }
  });
}

function getProviderSize({ requestedSize, dashscopeSize, sizeFormat }) {
  if (sizeFormat === '*') return dashscopeSize || requestedSize.replace('x', '*');
  if (sizeFormat === 'openai-mapped') return mapSizeForOpenAIImages(requestedSize);
  return requestedSize;
}
