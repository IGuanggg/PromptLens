import { fetchJsonWithTimeout } from '../utils/customApi.js';
import { ERROR_CODES, createAppError } from '../utils/errors.js';
import { appendLog } from './logService.js';

export function extractTaskId(raw) {
  if (!raw) return null;
  return raw?.data?.id || raw?.id || raw?.task_id || raw?.data?.task_id || null;
}

function getByPath(obj, path) {
  return String(path || '').split('.').reduce((acc, k) => acc?.[k], obj);
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Classify a failed image task based on failure_reason.
 * Distinguishes moderation blocks from generic failures.
 */
export function normalizeImageTaskFailure(task, provider) {
  const failureReason = String(task?.failure_reason || task?.failureReason || '');
  const errorMessage = task?.error || task?.message || failureReason || '图片生成任务失败';

  if (failureReason === 'output_moderation') {
    return createAppError({
      code: ERROR_CODES.IMAGE_MODERATION_FAILED,
      message: '图片生成被安全审核拦截，可能是生成结果触发了图像服务的内容安全策略。请修改 Prompt 后重试。',
      provider,
      raw: task,
      retryable: false
    });
  }

  if (failureReason === 'input_moderation') {
    return createAppError({
      code: ERROR_CODES.IMAGE_INPUT_MODERATION_FAILED,
      message: '提示词或参考图触发输入审核，请修改 Prompt 或更换参考图后重试。',
      provider,
      raw: task,
      retryable: false
    });
  }

  return createAppError({
    code: ERROR_CODES.TASK_FAILED,
    message: `图片生成任务失败：${errorMessage}`,
    provider,
    raw: task,
    retryable: failureReason === 'error'
  });
}

export async function pollImageResult({ taskId, baseUrl, resultEndpoint, apiKey, pollIntervalMs, maxPollCount, provider }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_TASK_POLL_START', provider, message: `Polling ${taskId}`, data: { taskId, resultEndpoint } });

  for (let i = 0; i < maxPollCount; i++) {
    await wait(pollIntervalMs);
    const url = `${baseUrl.replace(/\/+$/, '')}${resultEndpoint}`;
    let raw;
    try {
      raw = await fetchJsonWithTimeout(url, { method: 'POST', headers, body: JSON.stringify({ id: taskId }) }, 30000, { apiType: 'image', provider });
    } catch (e) {
      if (i >= maxPollCount - 1) throw createAppError({ code: ERROR_CODES.TASK_FAILED, message: `Poll failed after ${i + 1} attempts`, provider, raw: { taskId }, retryable: true });
      continue;
    }

    if (raw?.code === -22) {
      throw createAppError({ code: ERROR_CODES.IMAGE_TASK_NOT_FOUND, message: `任务 ${taskId} 不存在或已过期`, provider, raw: { taskId, responseCode: -22 }, retryable: false });
    }

    const status = String(getByPath(raw, 'data.status') || raw?.status || '').toLowerCase();
    const progress = Number(getByPath(raw, 'data.progress') || raw?.progress || 0);

    appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_TASK_POLL', provider, message: `Poll ${i + 1}: ${status} ${progress}%`, data: { taskId, pollIndex: i, status, progress } });

    if (['succeeded','success','completed','done'].includes(status)) {
      const results = getByPath(raw, 'data.results') || raw?.results || [];
      appendLog({ level: 'info', apiType: 'image', event: 'IMAGE_TASK_SUCCEEDED', provider, message: `Task ${taskId} done`, data: { taskId, resultCount: results.length } });
      return { images: results.map((item, idx) => ({ id: item.id || `${taskId}_${idx}`, url: item.url || item.image || '', thumbUrl: item.url || item.image || '', label: `结果 ${idx + 1}`, provider, width: 0, height: 0 })), raw: { taskId, resultRaw: raw } };
    }

    if (['failed','error','canceled'].includes(status)) {
      const failureReason = getByPath(raw, 'data.failure_reason') || raw?.failure_reason || '';
      const errorMsg = getByPath(raw, 'data.error') || raw?.error || '';
      throw normalizeImageTaskFailure({ failure_reason: failureReason, error: errorMsg, status }, provider);
    }
  }

  throw createAppError({ code: ERROR_CODES.IMAGE_TASK_TIMEOUT, message: `任务轮询超时 (${maxPollCount}次)`, provider, raw: { taskId, maxPollCount }, retryable: true });
}
