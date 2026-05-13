import { buildHeaders, buildUrl, parseTemplateBody } from '../utils/customApi.js';
import { getProviderSize } from '../utils/size.js';

/** Build a custom image API request that matches the legacy custom API flow.
 * Used by both generateImages and the Options test button. */
export function buildCustomImageRequest({
  api,
  prompt,
  outputSize,
  count = 1,
  mode = 'standard',
  negativePrompt = '',
  referenceImage = ''
}) {
  const custom = api.custom || {};
  const width = outputSize?.width || 1080;
  const height = outputSize?.height || 1080;
  const size = outputSize?.size || `${width}x${height}`;
  const dashscopeSize = outputSize?.dashscopeSize || `${width}*${height}`;
  const sizeFormat = api.sizeFormat || 'x';
  const providerSize = getProviderSize({ requestedSize: size, dashscopeSize, sizeFormat });

  const variables = {
    ...custom,
    model: api.model || '',
    prompt,
    negativePrompt,
    referenceImage,
    width,
    height,
    size,
    dashscopeSize,
    providerSize,
    aspectRatio: outputSize?.aspectRatio || api.aspectRatio || '',
    resolutionPreset: outputSize?.resolutionPreset || api.resolutionPreset || '',
    sizeMode: outputSize?.sizeMode || api.sizeMode || '',
    count,
    mode
  };

  const urlSettings = { ...variables, apiKey: api.apiKey || '' };
  const url = buildUrl(api.baseUrl, api.endpoint, urlSettings);
  const method = (custom.method || 'POST').toUpperCase();
  const headers = buildHeaders({ ...custom, apiKey: api.apiKey });
  const body = method === 'GET' ? undefined : parseTemplateBody(custom.requestTemplate || '', variables);

  return { url, method, headers, body, variables, providerSize, sizeFormat };
}
