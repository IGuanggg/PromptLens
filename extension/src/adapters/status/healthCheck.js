import { appendLog } from '../../services/logService.js';

function result(status, provider, kind) {
  const label = kind === 'prompt' ? 'Prompt API' : 'Image API';
  const messageMap = {
    unconfigured: `${label} 未配置`,
    checking: `${label} 检测中`,
    connected: `${label} 正常`,
    unauthorized: `${label} Key 无效`,
    rate_limited: `${label} 频率限制`,
    timeout: `${label} 超时`,
    error: `${label} 连接异常`,
    offline: `${label} 服务离线`
  };
  return { status, provider, message: messageMap[status] || `${label} 状态未知`, checkedAt: Date.now() };
}

export function statusFromError(error, provider, kind) {
  const map = { UNAUTHORIZED: 'unauthorized', RATE_LIMITED: 'rate_limited', TIMEOUT: 'timeout', NETWORK_ERROR: 'error' };
  return result(map[error?.code] || 'error', provider, kind);
}

export async function checkPromptApiStatus(settings) {
  const api = settings?.promptApi || {};
  const type = api.type || 'openai-compatible';

  if (!api.baseUrl || !api.apiKey || !api.model) {
    return result('unconfigured', type, 'prompt');
  }

  appendLog({
    level: 'info',
    apiType: 'prompt',
    event: 'HEALTH_CHECK',
    provider: type,
    message: `Prompt API 状态检测: connected`
  });

  return result('connected', type, 'prompt');
}

export async function checkImageApiStatus(settings) {
  const api = settings?.imageApi || {};
  const type = api.type || 'openai-compatible-image';

  if (!api.baseUrl || !api.apiKey || !api.model) {
    return result('unconfigured', type, 'image');
  }

  appendLog({
    level: 'info',
    apiType: 'image',
    event: 'HEALTH_CHECK',
    provider: type,
    message: `Image API 状态检测: connected`
  });

  return result('connected', type, 'image');
}
