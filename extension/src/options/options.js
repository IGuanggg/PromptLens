import { DEFAULT_SETTINGS, loadSettings, saveSettings, resetSettings, deepMerge } from '../services/storageService.js';
import { clearDraft } from '../services/draftService.js';
import { clearHistory, createHistoryExportFilename, exportHistory, importHistory } from '../services/historyService.js';
import { getLogs, clearLogs, getLastCall, initLogService, setLogSettings, setLogLimit } from '../services/logService.js';
import { appendLog, updateLastCall } from '../services/logService.js';
import { testPromptTextApi, testPromptVisionApi } from '../services/promptService.js';
import { RESOLUTION_PRESETS, getOutputSize, mapSizeForOpenAIImages, migrateResolutionPreset, migrateSizeMode } from '../utils/size.js';

const form = document.getElementById('settingsForm');
const saveStatus = document.getElementById('saveStatus');
let settings = DEFAULT_SETTINGS;

// ── Size control reactive state ──
let sizeMode = 'preset';
let aspectRatio = '1:1';
let resolutionPreset = '1k';
let customWidth = 1080;
let customHeight = 1080;
let refImage = null;

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

function setByPath(obj, path, value) {
  const parts = path.split('.');
  let cursor = obj;
  parts.slice(0, -1).forEach((part) => {
    cursor[part] = cursor[part] || {};
    cursor = cursor[part];
  });
  cursor[parts.at(-1)] = value;
}

async function init() {
  settings = await loadSettings();
  await initLogService(settings);
  setLogSettings(settings);
  setLogLimit(settings?.advanced?.debugLogLimit || 200);
  bindTabs();
  bindActions();
  bindCustomFields();
  bindSizeControl();
  loadSizeState(settings);
  fillForm(settings);
  renderLastCall();
  form.addEventListener('submit', (event) => event.preventDefault());
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      const key = tab.dataset.tab;
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('hidden', panel.dataset.panel !== key);
      });
    });
  });
}

function bindCustomFields() {
  const promptType = document.getElementById('promptApiType');
  const imageType = document.getElementById('imageApiType');
  const customPrompt = document.getElementById('customPromptFields');
  const customImage = document.getElementById('customImageFields');

  function updateVisibility() {
    customPrompt.classList.toggle('hidden', promptType.value !== 'custom-prompt');
    customImage.classList.toggle('hidden', imageType.value !== 'custom-image');
  }

  promptType.addEventListener('change', updateVisibility);
  imageType.addEventListener('change', updateVisibility);
  updateVisibility();
}

// ── Size control ──

function loadSizeState(s) {
  const api = s?.imageApi || {};
  sizeMode = migrateSizeMode(api.sizeMode || 'preset');
  aspectRatio = api.aspectRatio || api.selectedRatio || '1:1';
  resolutionPreset = migrateResolutionPreset(api.resolutionPreset || api.quality);
  customWidth = api.customWidth || 1080;
  customHeight = api.customHeight || 1080;

  document.getElementById('sizeMode').value = sizeMode;
  document.getElementById('resolutionPreset').value = resolutionPreset;
  document.getElementById('customWidth').value = customWidth;
  document.getElementById('customHeight').value = customHeight;

  document.querySelectorAll('#ratioButtons .ratio-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.ratio === aspectRatio);
  });

  updateSizePanelVisibility();
  updateFinalSize();
  updateResolutionDescription();
}

function bindSizeControl() {
  document.getElementById('sizeMode').addEventListener('change', (e) => {
    sizeMode = e.target.value;
    updateSizePanelVisibility();
    updateFinalSize();
  });

  document.querySelectorAll('#ratioButtons .ratio-btn').forEach((btn) => {
    btn.addEventListener('click', (event) => {
      event.preventDefault();
      document.querySelectorAll('#ratioButtons .ratio-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      aspectRatio = btn.dataset.ratio;
      updateFinalSize();
    });
  });

  document.getElementById('resolutionPreset').addEventListener('change', (e) => {
    resolutionPreset = migrateResolutionPreset(e.target.value);
    e.target.value = resolutionPreset;
    updateResolutionDescription();
    updateFinalSize();
  });

  document.querySelector('[name="imageApi.sizeFormat"]')?.addEventListener('change', updateFinalSize);
  document.getElementById('imageApiType')?.addEventListener('change', updateFinalSize);

  document.getElementById('customWidth').addEventListener('input', () => {
    customWidth = parseInt(document.getElementById('customWidth').value, 10) || 0;
    updateFinalSize();
  });

  document.getElementById('customHeight').addEventListener('input', () => {
    customHeight = parseInt(document.getElementById('customHeight').value, 10) || 0;
    updateFinalSize();
  });
}

function updateSizePanelVisibility() {
  const presetGroup = document.getElementById('sizePresetGroup');
  const customGroup = document.getElementById('sizeCustomGroup');
  presetGroup.classList.toggle('hidden', sizeMode !== 'preset');
  customGroup.classList.toggle('hidden', sizeMode !== 'custom');
}

function updateFinalSize() {
  const label = document.getElementById('finalSizeLabel');
  const hint = document.getElementById('sizeCompatibilityHint');
  try {
    const size = getOutputSize({
      sizeMode,
      aspectRatio,
      resolutionPreset,
      customWidth,
      customHeight,
      referenceImage: refImage
    });
    label.textContent = `最终尺寸：${size.width} × ${size.height}`;
    label.className = 'final-size';
    hint?.classList.toggle('hidden', !shouldShowCompatibilityHint(size, getCurrentImageApiDraft()));
  } catch (error) {
    label.textContent = `最终尺寸：无效 - ${error.message || '尺寸错误'}`;
    label.className = 'final-size invalid';
    hint?.classList.add('hidden');
  }
}

function updateResolutionDescription() {
  const description = document.getElementById('resolutionDescription');
  if (!description) return;
  description.textContent = RESOLUTION_PRESETS[resolutionPreset]?.description || RESOLUTION_PRESETS['1k'].description;
}

function readSizeStateInto(api) {
  api.sizeMode = migrateSizeMode(sizeMode);
  api.aspectRatio = aspectRatio;
  api.resolutionPreset = migrateResolutionPreset(resolutionPreset);
  api.customWidth = customWidth || 1080;
  api.customHeight = customHeight || 1080;
  delete api.selectedRatio;
  delete api.quality;

  try {
    const sz = getOutputSize({
      sizeMode: api.sizeMode,
      aspectRatio: api.aspectRatio,
      resolutionPreset: api.resolutionPreset,
      customWidth: api.customWidth,
      customHeight: api.customHeight,
      referenceImage: refImage
    });
    api.finalWidth = sz.width;
    api.finalHeight = sz.height;
    api.size = sz.size;
  } catch {
    api.finalWidth = 1080;
    api.finalHeight = 1080;
    api.size = '1080x1080';
  }
}

function getCurrentImageApiDraft() {
  return {
    type: document.getElementById('imageApiType')?.value || settings?.imageApi?.type || '',
    sizeFormat: document.querySelector('[name="imageApi.sizeFormat"]')?.value || settings?.imageApi?.sizeFormat || 'x'
  };
}

function shouldShowCompatibilityHint(outputSize, api = {}) {
  if ((api.sizeFormat || 'x') === 'openai-mapped' && mapSizeForOpenAIImages(outputSize.size) !== outputSize.size) {
    return true;
  }
  return false;
}

function getProviderSizeForFormat(outputSize, api = {}) {
  const format = api.sizeFormat || 'x';
  if (format === '*') return outputSize.dashscopeSize;
  if (format === 'openai-mapped') return mapSizeForOpenAIImages(outputSize.size);
  return outputSize.size;
}

function bindActions() {
  document.getElementById('saveBtn').addEventListener('click', async () => {
    settings = readForm();
    settings = await saveSettings(settings);
    setLogSettings(settings);
    setLogLimit(settings?.advanced?.debugLogLimit || 200);

    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_SAVED', message: '设置已保存' });

    saveStatus.textContent = '已保存';
    setTimeout(() => saveStatus.textContent = '', 1800);
  });

  document.getElementById('resetBtn').addEventListener('click', async () => {
    settings = await resetSettings();
    fillForm(settings);
    bindCustomFields();
    loadSizeState(settings);
    setLogSettings(settings);

    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_RESET', message: '设置已恢复默认' });

    saveStatus.textContent = '已恢复默认';
    setTimeout(() => saveStatus.textContent = '', 1800);
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    const safe = JSON.parse(JSON.stringify(readForm()));
    stripKeys(safe);
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `promptpilot-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_EXPORTED', message: '设置已导出' });
  });

  document.getElementById('importBtn').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = JSON.parse(text);
    settings = deepMerge(DEFAULT_SETTINGS, imported);
    fillForm(settings);
    bindCustomFields();
    saveStatus.textContent = '已导入，点击保存后生效';
    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_IMPORTED', message: '设置文件已导入' });
  });

  // History actions
  document.getElementById('clearHistoryOptionsBtn').addEventListener('click', async () => {
    if (!confirm('确定清空全部历史记录吗？')) return;
    await clearHistory();
    appendLog({ level: 'info', apiType: 'system', event: 'HISTORY_CLEARED', message: '历史记录已清空' });
    saveStatus.textContent = '历史记录已清空';
  });

  document.getElementById('exportHistoryOptionsBtn').addEventListener('click', async () => {
    const payload = await exportHistory();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = createHistoryExportFilename();
    a.click();
    URL.revokeObjectURL(url);
    appendLog({ level: 'info', apiType: 'system', event: 'HISTORY_EXPORTED', message: '历史记录已导出' });
  });

  document.getElementById('importHistoryOptionsBtn').addEventListener('click', () => document.getElementById('historyImportFile').click());
  document.getElementById('historyImportFile').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const payload = JSON.parse(await file.text());
    if (payload?.app !== 'PromptPilot' || !Array.isArray(payload.items)) {
      throw new Error('历史文件格式无效');
    }
    await importHistory(payload.items);
    saveStatus.textContent = '历史记录已导入';
    appendLog({ level: 'info', apiType: 'system', event: 'HISTORY_IMPORTED', message: '历史记录已导入' });
  });

  document.getElementById('clearDraftOptionsBtn').addEventListener('click', async () => {
    await clearDraft();
    saveStatus.textContent = '草稿已清空';
    appendLog({ level: 'info', apiType: 'system', event: 'DRAFT_CLEARED', message: '草稿已清空' });
  });

  // Debug log actions
  document.getElementById('exportDebugLogsBtn').addEventListener('click', async () => {
    const logs = await getLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `promptpilot-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    saveStatus.textContent = `已导出 ${logs.length} 条日志`;
    appendLog({ level: 'info', apiType: 'system', event: 'LOGS_EXPORTED', message: `导出了 ${logs.length} 条日志` });
  });

  document.getElementById('clearDebugLogsBtn').addEventListener('click', async () => {
    if (!confirm('确定清空全部调试日志吗？')) return;
    await clearLogs();
    saveStatus.textContent = '日志已清空';
    appendLog({ level: 'info', apiType: 'system', event: 'LOGS_CLEARED', message: '日志已清空' });
  });

  // Test Prompt API
  // Test text interface (no image)
  document.getElementById('testPromptTextBtn').addEventListener('click', async () => {
    const current = readForm();
    const api = current?.promptApi || {};
    const resultEl = document.getElementById('testPromptResult');

    if (!api.baseUrl || !api.apiKey || !api.model) {
      resultEl.textContent = '请先填写 Base URL、API Key 和 Model';
      resultEl.className = 'test-result error';
      return;
    }

    resultEl.textContent = '测试文本接口中...';
    resultEl.className = 'test-result';

    try {
      await testPromptTextApi(current);
      resultEl.textContent = '✓ 文本接口连接成功';
      resultEl.className = 'test-result success';
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        resultEl.textContent = '✗ API Key 无效';
      } else if (error?.status === 429) {
        resultEl.textContent = '⚠ 频率限制';
      } else {
        resultEl.textContent = `✗ ${error.message || '连接失败'}`;
      }
      resultEl.className = 'test-result error';
    }
  });

  // Test vision interface (with test image)
  document.getElementById('testPromptVisionBtn').addEventListener('click', async () => {
    const current = readForm();
    const api = current?.promptApi || {};
    const resultEl = document.getElementById('testPromptResult');

    if (!api.baseUrl || !api.apiKey || !api.model) {
      resultEl.textContent = '请先填写 Base URL、API Key 和 Model';
      resultEl.className = 'test-result error';
      return;
    }

    resultEl.textContent = '测试图片接口中...';
    resultEl.className = 'test-result';

    try {
      const raw = await testPromptVisionApi(current);
      const content = raw?.choices?.[0]?.message?.content || '';
      if (content) {
        resultEl.textContent = `✓ 视觉接口连接成功（返回: ${content.slice(0, 50)}）`;
        resultEl.className = 'test-result success';
      } else {
        resultEl.textContent = '⚠ 接口连通但返回为空 — 模型可能不支持视觉输入';
        resultEl.className = 'test-result warn';
      }
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        resultEl.textContent = '✗ API Key 无效';
      } else if (error?.status === 429) {
        resultEl.textContent = '⚠ 频率限制';
      } else if (error?.message?.includes('不支持') || error?.message?.includes('vision')) {
        resultEl.textContent = '⚠ 模型可能不支持视觉输入';
        resultEl.className = 'test-result warn';
      } else {
        resultEl.textContent = `✗ ${error.message || '连接失败'}`;
      }
      resultEl.className = 'test-result error';
    }
  });

  // Test Image API
  document.getElementById('testImageBtn').addEventListener('click', async () => {
    const current = readForm();
    const api = current?.imageApi || {};
    const resultEl = document.getElementById('testImageResult');
    const realTest = document.getElementById('realImageTest').checked;

    if (!api.baseUrl || !api.apiKey || !api.model) {
      resultEl.textContent = '请先填写 Base URL、API Key 和 Model';
      resultEl.className = 'test-result error';
      return;
    }

    resultEl.textContent = '检测中...';
    resultEl.className = 'test-result';

    appendLog({
      level: 'info',
      apiType: 'image',
      event: 'TEST_IMAGE_API',
      provider: api.type,
      message: `手动测试 Image API 配置${realTest ? ' (真实出图)' : ''}`,
      data: {
        sizeMode: api.sizeMode,
        aspectRatio: api.aspectRatio,
        resolutionPreset: api.resolutionPreset
      }
    });

    try {
      const url = (api.baseUrl || '').replace(/\/+$/, '') + (api.endpoint || '/v1/images/generations');
      const outputSize = getOutputSize({
        sizeMode: api.sizeMode,
        aspectRatio: api.aspectRatio,
        resolutionPreset: api.resolutionPreset,
        customWidth: api.customWidth,
        customHeight: api.customHeight,
        referenceImage: null
      });
      const providerSize = getProviderSizeForFormat(outputSize, api);
      if ((api.sizeFormat || 'x') === 'openai-mapped' && providerSize !== outputSize.size) {
        appendLog({
          level: 'info',
          apiType: 'image',
          event: 'IMAGE_SIZE_MAPPED',
          provider: api.type,
          message: `Test image size mapped: ${outputSize.size} -> ${providerSize}`,
          data: {
            requestedSize: outputSize.size,
            providerSize,
            reason: 'Provider only supports fixed image sizes'
          }
        });
      }
      appendLog({
        level: 'info',
        apiType: 'image',
        event: 'IMAGE_PAYLOAD_SIZE',
        provider: api.type,
        message: `Test image payload size: ${providerSize}`,
        data: {
          requestedSize: outputSize.size,
          providerSize,
          width: outputSize.width,
          height: outputSize.height,
          aspectRatio: outputSize.aspectRatio,
          resolutionPreset: outputSize.resolutionPreset,
          sizeMode: outputSize.sizeMode,
          sizeFormat: api.sizeFormat || 'x',
          provider: api.type
        }
      });
      const body = realTest
        ? { model: api.model, prompt: 'a simple test image', n: 1, size: providerSize }
        : { model: api.model, prompt: 'test', n: 1, size: providerSize };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${api.apiKey}` },
        body: JSON.stringify(body)
      });

      if (response.ok) {
        resultEl.textContent = `✓ 连接成功 (HTTP ${response.status})${realTest ? '' : ' — 仅做连通性验证'}`;
        resultEl.className = 'test-result success';
      } else if (response.status === 401 || response.status === 403) {
        resultEl.textContent = `✗ API Key 无效 (HTTP ${response.status})`;
        resultEl.className = 'test-result error';
      } else if (response.status === 429) {
        resultEl.textContent = `⚠ 频率限制 (HTTP ${response.status})`;
        resultEl.className = 'test-result warn';
      } else {
        resultEl.textContent = `⚠ HTTP ${response.status}`;
        resultEl.className = 'test-result warn';
      }
    } catch (error) {
      resultEl.textContent = `✗ 连接失败: ${error.message}`;
      resultEl.className = 'test-result error';
    }
  });
}

// ═══ Settings form ═══

function fillForm(value) {
  form.querySelectorAll('[name]').forEach((el) => {
    const current = getByPath(value, el.name);
    if (el.type === 'checkbox') {
      el.checked = Boolean(current);
    } else {
      el.value = current ?? '';
    }
  });
}

function readForm() {
  const output = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  form.querySelectorAll('[name]').forEach((el) => {
    let value;
    if (el.type === 'checkbox') {
      value = el.checked;
    } else if (el.type === 'number') {
      value = el.value === '' ? 0 : Number(el.value);
    } else {
      value = el.value;
    }
    setByPath(output, el.name, value);
  });
  // Capture size control state
  readSizeStateInto(output.imageApi || {});
  return output;
}

function stripKeys(obj) {
  for (const [key, value] of Object.entries(obj)) {
    if (key.toLowerCase().includes('apikey')) obj[key] = '';
    if (value && typeof value === 'object') stripKeys(value);
  }
}

async function renderLastCall() {
  const el = document.getElementById('lastCallDisplay');
  const last = await getLastCall();
  if (!last) {
    el.innerHTML = '<span class="muted">暂无调用记录</span>';
    return;
  }
  const icon = last.success ? '✓' : '✗';
  const cls = last.success ? 'success' : 'error';
  el.innerHTML = `<span class="${cls}">${icon} ${last.apiType} | ${last.provider} | ${last.method} ${last.endpoint} | ${last.status} | ${last.durationMs}ms | ${last.message}</span>
    <br><small class="muted">${new Date(last.createdAt).toLocaleString()}</small>`;
}

init().catch((error) => {
  console.error(error);
  saveStatus.textContent = error.message || '初始化失败';
});
