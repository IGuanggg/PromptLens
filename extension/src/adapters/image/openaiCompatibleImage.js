import { mockImages } from '../../utils/mockImages.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout } from '../../utils/customApi.js';
import { normalizeOpenAIImageResult } from '../../utils/imageResult.js';

export async function callOpenAICompatibleImage({ prompt, settings, count, width, height, debug }) {
  if (!settings?.baseUrl || !settings?.apiKey || !settings?.model) {
    return mockImages('openai-compatible-image-mock', 4);
  }

  const url = buildUrl(settings.baseUrl, settings.endpoint || '/v1/images/generations');
  const raw = await fetchJsonWithTimeout(url, {
    method: 'POST',
    headers: buildHeaders({ authType: 'bearer', apiKey: settings.apiKey }),
    body: JSON.stringify({
      model: settings.model,
      prompt,
      n: Number(count || 1),
      size: settings.size || `${width}x${height}`,
      quality: settings.quality || 'standard',
      response_format: settings.responseFormat || 'url'
    })
  }, settings.timeout || 60000, { provider: 'openai-compatible-image', debug: { ...debug, apiKey: settings.apiKey } });

  return normalizeOpenAIImageResult(raw, 'openai-compatible-image', {
    width,
    height,
    responseMap: settings.responseMap || { images: 'data' }
  });
}
