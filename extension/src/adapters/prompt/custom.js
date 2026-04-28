import { REVERSE_IMAGE_SYSTEM_PROMPT, REVERSE_IMAGE_USER_PROMPT } from '../../prompts/reverseImagePrompt.js';
import { buildHeaders, buildUrl, fetchJsonWithTimeout, mapResponse, parseTemplateBody } from '../../utils/customApi.js';
import { mockPromptResult, normalizePromptResult } from '../../utils/mockPrompt.js';

function hasConfig(settings) {
  return Boolean(settings?.baseUrl && settings?.endpoint);
}

export async function generatePromptCustom({ imageUrl, imageBase64 = '', settings }) {
  if (!hasConfig(settings)) return mockPromptResult('custom-prompt-mock');

  const variables = {
    model: settings.model || '',
    imageUrl,
    imageBase64,
    prompt: REVERSE_IMAGE_USER_PROMPT,
    systemPrompt: REVERSE_IMAGE_SYSTEM_PROMPT,
    userPrompt: REVERSE_IMAGE_USER_PROMPT,
    language: 'both',
    temperature: settings.temperature ?? 0.2,
    maxTokens: settings.maxTokens ?? 1200,
    ...settings
  };

  const url = buildUrl(settings.baseUrl, settings.endpoint, variables);
  const method = settings.method || 'POST';
  const raw = await fetchJsonWithTimeout(url, {
    method,
    headers: buildHeaders(settings),
    body: method.toUpperCase() === 'GET' ? undefined : parseTemplateBody(settings.requestTemplate, variables)
  }, settings.timeout || 60000);

  const mapped = mapResponse(raw, settings.responseMap);
  return normalizePromptResult({ ...mapped, provider: 'custom', raw }, 'custom');
}
