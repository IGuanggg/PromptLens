export function statusText(status, kind) {
  const prefix = kind === 'prompt' ? 'Prompt API' : 'Image API';
  const map = {
    unconfigured: '未配置',
    checking: '检测中',
    connected: '正常',
    unauthorized: 'Key 无效',
    rate_limited: '频率限制',
    timeout: '超时',
    offline: '服务离线',
    error: '连接异常'
  };
  return `${prefix} ${map[status] || '未知'}`;
}
