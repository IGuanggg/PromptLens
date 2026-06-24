import { DEFAULT_SETTINGS, loadSettings, saveSettings, resetSettings, deepMerge } from '../services/storageService.js';
import { clearDraft } from '../services/draftService.js';
import { clearHistory, createHistoryExportFilename, exportHistory, importHistory } from '../services/historyService.js';
import { getLogs, clearLogs, getLastCall, initLogService, setLogSettings, setLogLimit } from '../services/logService.js';
import { appendLog, updateLastCall } from '../services/logService.js';
import { testPromptTextApi, testPromptVisionApi } from '../services/promptService.js';
import { buildCustomImageRequest } from '../services/imageRequestBuilder.js';
import { discoverModels } from '../services/modelDiscoveryService.js';
import { RATIO_OPTIONS, RESOLUTION_PRESETS, getOutputSize, mapSizeForOpenAIImages, migrateResolutionPreset, migrateSizeMode } from '../utils/size.js';
import { findImageModelConfig, buildImageApiPayload, getImageModels } from '../data/imageModels.js';

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
let discoveredPromptModels = [];
let discoveredImageModels = [];

/** Safe getElementById + addEventListener with null-guard */
function on(id, event, handler) {
  const el = document.getElementById(id);
  if (!el) {
    console.warn(`[Options] missing #${id}`);
    return;
  }
  el.addEventListener(event, handler);
}

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

  // Load current image meta for "follow-reference" size preview
  try {
    const stored = await chrome.storage.local.get('currentImageMeta');
    if (stored.currentImageMeta?.width && stored.currentImageMeta?.height) {
      refImage = { width: stored.currentImageMeta.width, height: stored.currentImageMeta.height };
    }
  } catch { /* ignore */ }

  // Tab switching must always work, independent of other bindings
  bindTabs();

  // Restore saved form values first, so custom field visibility reflects user config
  fillForm(settings);

  try { bindActions(); } catch (e) { console.error('[Options] bindActions failed', e); }
  try { bindModelDiscovery(); } catch (e) { console.error('[Options] bindModelDiscovery failed', e); }
  try { bindCustomFields(); } catch (e) { console.error('[Options] bindCustomFields failed', e); }
  try { bindSizeControl(); } catch (e) { console.error('[Options] bindSizeControl failed', e); }
  try { loadSizeState(settings); } catch (e) { console.error('[Options] loadSizeState failed', e); }
  updateEndpointFromModel();
  const initModel = settings?.imageApi?.model || 'gpt-image-2';
  renderImageModelCapability(initModel);
  updateResolutionOptionsByModel(initModel);
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

function refreshCustomFieldsVisibility() {
  const promptType = document.getElementById('promptApiType');
  const imageType = document.getElementById('imageApiType');
  const customPrompt = document.getElementById('customPromptFields');
  const customImage = document.getElementById('customImageFields');
  if (!promptType || !imageType || !customPrompt || !customImage) return;
  customPrompt.classList.toggle('hidden', promptType.value !== 'custom-prompt');
  customImage.classList.toggle('hidden', imageType.value !== 'custom-image');
}

function bindCustomFields() {
  const promptType = document.getElementById('promptApiType');
  const imageType = document.getElementById('imageApiType');
  if (!promptType || !imageType) return;

  promptType.addEventListener('change', refreshCustomFieldsVisibility);
  imageType.addEventListener('change', () => {
    refreshCustomFieldsVisibility();
    updateEndpointFromModel();
    updateFinalSize();
  });
  refreshCustomFieldsVisibility();
}

function bindModelDiscovery() {
  const promptInput = document.getElementById('promptModelInput');
  const promptSelect = document.getElementById('promptModelSelect');
  const imageInput = document.getElementById('imageModelInput');
  const imageSelect = document.getElementById('imageModelSelect');

  seedModelChoices('prompt', [promptInput?.value || settings?.promptApi?.model || 'gpt-4.1-mini']);
  seedModelChoices('image', [
    ...getImageModels().map((model) => model.id),
    imageInput?.value || settings?.imageApi?.model || 'gpt-image-2'
  ]);

  if (promptSelect && promptInput) {
    promptSelect.addEventListener('change', () => {
      if (!promptSelect.value) return;
      promptInput.value = promptSelect.value;
    });
  }

  if (imageSelect && imageInput) {
    imageSelect.addEventListener('change', () => {
      if (!imageSelect.value) return;
      imageInput.value = imageSelect.value;
      onModelChange();
    });
  }

  if (imageInput) {
    imageInput.addEventListener('input', () => {
      syncModelPickerSelection('image');
    });
  }

  if (promptInput) {
    promptInput.addEventListener('input', () => {
      syncModelPickerSelection('prompt');
    });
  }

  on('discoverPromptModelsBtn', 'click', () => handleDiscoverModels('prompt'));
  on('discoverImageModelsBtn', 'click', () => handleDiscoverModels('image'));
}

function seedModelChoices(kind, models) {
  const clean = [...new Set((models || []).map((model) => String(model || '').trim()).filter(Boolean))];
  if (kind === 'prompt') {
    discoveredPromptModels = clean;
  } else {
    discoveredImageModels = clean;
  }
  renderModelChoices(kind);
}

function renderModelChoices(kind) {
  const inputId = kind === 'prompt' ? 'promptModelInput' : 'imageModelInput';
  const listId = kind === 'prompt' ? 'promptModelList' : 'imageModelList';
  const selectId = kind === 'prompt' ? 'promptModelSelect' : 'imageModelSelect';
  const models = kind === 'prompt' ? discoveredPromptModels : discoveredImageModels;
  const input = document.getElementById(inputId);
  const datalist = document.getElementById(listId);
  const select = document.getElementById(selectId);
  if (!datalist || !select) return;

  const placeholder = kind === 'prompt' ? '选择已获取模型' : '选择模型';
  datalist.innerHTML = models.map((model) => `<option value="${escapeAttr(model)}"></option>`).join('');
  select.innerHTML = [
    `<option value="">${placeholder}</option>`,
    ...models.map((model) => `<option value="${escapeAttr(model)}">${escapeHtml(model)}</option>`)
  ].join('');

  if (input?.value && models.includes(input.value)) {
    select.value = input.value;
  }
}

function syncModelPickerSelection(kind) {
  const inputId = kind === 'prompt' ? 'promptModelInput' : 'imageModelInput';
  const selectId = kind === 'prompt' ? 'promptModelSelect' : 'imageModelSelect';
  const input = document.getElementById(inputId);
  const select = document.getElementById(selectId);
  if (!input || !select) return;
  select.value = [...select.options].some((option) => option.value === input.value) ? input.value : '';
}

async function handleDiscoverModels(kind) {
  const current = readForm();
  const api = kind === 'prompt' ? current.promptApi : current.imageApi;
  const button = document.getElementById(kind === 'prompt' ? 'discoverPromptModelsBtn' : 'discoverImageModelsBtn');
  const resultEl = document.getElementById(kind === 'prompt' ? 'promptModelDiscoverResult' : 'imageModelDiscoverResult');
  const input = document.getElementById(kind === 'prompt' ? 'promptModelInput' : 'imageModelInput');

  if (!api?.baseUrl) {
    setModelDiscoveryStatus(resultEl, '请先填写 Base URL', 'error');
    return;
  }

  button.disabled = true;
  setModelDiscoveryStatus(resultEl, '正在获取模型列表...', '');

  try {
    const result = await discoverModels({
      baseUrl: api.baseUrl,
      apiKey: api.apiKey,
      apiType: kind,
      provider: api.type || (kind === 'prompt' ? 'prompt-api' : 'image-api'),
      custom: api.custom || {},
      forceBearer: api.type !== 'custom-prompt' && api.type !== 'custom-image'
    });

    const merged = [
      ...(kind === 'prompt' ? discoveredPromptModels : discoveredImageModels),
      ...result.models
    ];
    seedModelChoices(kind, merged);
    syncModelPickerSelection(kind);
    setModelDiscoveryStatus(resultEl, `已获取 ${result.models.length} 个模型，可从下拉选择，也可继续手填`, 'success');

    appendLog({
      level: 'info',
      apiType: kind,
      event: 'MODEL_DISCOVERY_SUCCESS',
      provider: api.type || '',
      endpoint: result.url,
      method: 'GET',
      message: `发现 ${result.models.length} 个模型`,
      data: { count: result.models.length, selectedModel: input?.value || '' }
    });
  } catch (error) {
    setModelDiscoveryStatus(resultEl, `${error.message || '获取模型失败'}，可继续手动填写`, 'error');
    appendLog({
      level: 'warn',
      apiType: kind,
      event: 'MODEL_DISCOVERY_FAILED',
      provider: api?.type || '',
      message: error.message || '获取模型失败'
    });
  } finally {
    button.disabled = false;
  }
}

function setModelDiscoveryStatus(el, text, cls) {
  if (!el) return;
  el.textContent = text || '';
  el.className = `field-description model-discovery-status${cls ? ` ${cls}` : ''}`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value);
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
  on('sizeMode', 'change', (e) => {
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

  on('resolutionPreset', 'change', (e) => {
    resolutionPreset = migrateResolutionPreset(e.target.value);
    updateFinalSize();
    updateResolutionDescription();
  });

  on('customWidth', 'input', () => {
    customWidth = parseInt(document.getElementById('customWidth').value, 10) || 0;
    updateFinalSize();
  });

  on('customHeight', 'input', () => {
    customHeight = parseInt(document.getElementById('customHeight').value, 10) || 0;
    updateFinalSize();
  });

  // ── Model → Endpoint sync ──
  bindEndpointSync();
}

// ── Model-Endpoint coupling ──

function bindEndpointSync() {
  const modelSelect = document.querySelector('[name="imageApi.model"]');
  const overrideCb = document.getElementById('customEndpointOverrideCb');
  if (!modelSelect) return;

  modelSelect.addEventListener('change', onModelChange);
  if (overrideCb) overrideCb.addEventListener('change', updateEndpointFromModel);
}

function onModelChange() {
  const modelSelect = document.querySelector('[name="imageApi.model"]');
  const modelName = modelSelect?.value || 'gpt-image-2';
  updateEndpointFromModel();
  renderImageModelCapability(modelName);
  updateResolutionOptionsByModel(modelName);
}

function updateEndpointFromModel() {
  const modelSelect = document.querySelector('[name="imageApi.model"]');
  const modelName = modelSelect?.value || 'gpt-image-2';
  const apiType = document.getElementById('imageApiType')?.value || settings?.imageApi?.type || '';
  const modelConfig = findImageModelConfig(modelName);
  const isKnownDrawModel = apiType === 'custom-image' && modelConfig?.channel;
  const submitEp = isKnownDrawModel
    ? modelConfig.submitEndpoint
    : (apiType === 'openai-compatible-image' ? '/v1/images/generations' : '');
  const resultEp = isKnownDrawModel ? modelConfig.resultEndpoint : '';
  const input = document.getElementById('imageEndpointInput');
  const preview = document.getElementById('endpointPreview');
  const overrideCb = document.getElementById('customEndpointOverrideCb');
  const isOverride = overrideCb?.checked || false;

  if (input) {
    if (!isOverride && submitEp) input.value = submitEp;
    if (!isOverride && !submitEp && apiType === 'custom-image') input.value = '';
    input.readOnly = !isOverride && Boolean(submitEp);
  }
  if (preview) {
    if (isKnownDrawModel) {
      preview.textContent = `提交：${submitEp} | 结果：${resultEp}`;
    } else if (apiType === 'openai-compatible-image') {
      preview.textContent = `提交：${submitEp}；如接口不同，可勾选手动覆盖 Endpoint`;
    } else {
      preview.textContent = '自定义模型未内置路由，请填写 Endpoint 或 Request Template';
    }
  }
}

function renderImageModelCapability(modelName) {
  const el = document.getElementById('imageModelCapability');
  if (!el) return;
  const model = findImageModelConfig(modelName);
  if (!model) {
    el.innerHTML = `
      <div class="cap-title">自定义模型：${escapeHtml(modelName || '未填写')}</div>
      <div class="cap-desc">未匹配到内置模型能力，将按当前接口类型和 Endpoint 发送。尺寸能力以接口实际支持为准。</div>`;
    return;
  }

  const badges = (model.badges || []).map(b => {
    const warn = b === '快速' || (b === '1K' && model.maxResolution === '1K');
    return `<span class="model-cap-badge${warn ? ' warn' : ''}">${b}</span>`;
  }).join('');

  el.innerHTML = `
    <div class="cap-title">${model.displayName || model.name}</div>
    <div class="cap-meta">
      <div>接口组：${model.channelLabel}</div>
      <div>积分消耗：${model.creditCost || '-'} / 次</div>
      <div>提交接口：${model.submitEndpoint}</div>
      <div>结果接口：${model.resultEndpoint}</div>
      <div>最大尺寸：${model.maxSizeLabel}</div>
      <div>多角度：${model.supportsMultiAngle ? '支持' : '不建议'}</div>
    </div>
    <div class="cap-badges">${badges}</div>
    <div class="cap-desc">${model.description || ''}</div>`;
}

function updateResolutionOptionsByModel(modelName) {
  const select = document.getElementById('resolutionPreset');
  if (!select) return;
  const model = findImageModelConfig(modelName);
  const supported = model?.supportsResolutions || ['1k', '2k', '4k'];
  const current = resolutionPreset;

  const allOptions = [
    { value: '1k', label: '1K / 标准' },
    { value: '2k', label: '2K / 高清' },
    { value: '4k', label: '4K / 超清' }
  ];

  const filtered = allOptions.filter(o => supported.includes(o.value));
  select.innerHTML = filtered.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

  // Restore current value if still supported
  if (supported.includes(current)) {
    select.value = current;
  } else {
    resolutionPreset = supported[0] || '1k';
    select.value = resolutionPreset;
  }
  updateFinalSize();
  updateResolutionDescription();
}

function updateResolutionDescription() {
  const el = document.getElementById('resolutionDescription');
  if (!el) return;
  const preset = RESOLUTION_PRESETS[migrateResolutionPreset(resolutionPreset)] || RESOLUTION_PRESETS['1k'];
  el.textContent = preset?.description || '';
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

    // Show size compatibility hint when provider may remap the output size
    if (hint) {
      const sizeFormat = document.querySelector('[name="imageApi.sizeFormat"]')?.value || 'x';
      const mappedSize = getProviderSizeForFormat(size, { sizeFormat });
      const type = document.getElementById('imageApiType')?.value || '';
      const modelName = document.querySelector('[name="imageApi.model"]')?.value || '';
      const modelConfig = findImageModelConfig(modelName);
      // Show hint for OpenAI-mapped format (always remaps) or if mapped size differs for known models
      const willRemap = sizeFormat === 'openai-mapped' && mappedSize !== size.size;
      hint.classList.toggle('hidden', !willRemap);
    }
  } catch (error) {
    label.textContent = `最终尺寸：无效 - ${error.message || '尺寸错误'}`;
    label.className = 'final-size invalid';
    if (hint) hint.classList.add('hidden');
  }
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

function getProviderSizeForFormat(outputSize, api = {}) {
  const format = api.sizeFormat || 'x';
  if (format === '*') return outputSize.dashscopeSize;
  if (format === 'openai-mapped') return mapSizeForOpenAIImages(outputSize.size);
  return outputSize.size;
}

function bindActions() {
  on('saveBtn', 'click', async () => {
    settings = readForm();
    await saveSettings(settings);
    setLogSettings(settings);
    setLogLimit(settings?.advanced?.debugLogLimit || 200);

    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_SAVED', message: '设置已保存' });

    saveStatus.textContent = '已保存';
    setTimeout(() => saveStatus.textContent = '', 1800);
  });

  on('resetBtn', 'click', async () => {
    settings = await resetSettings();
    fillForm(settings);
    refreshCustomFieldsVisibility();
    loadSizeState(settings);
    setLogSettings(settings);

    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_RESET', message: '设置已恢复默认' });

    saveStatus.textContent = '已恢复默认';
    setTimeout(() => saveStatus.textContent = '', 1800);
  });

  on('exportBtn', 'click', () => {
    const safe = JSON.parse(JSON.stringify(readForm()));
    stripKeys(safe);
    const blob = new Blob([JSON.stringify(safe, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `promptlens-settings-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_EXPORTED', message: '设置已导出' });
  });

  on('importBtn', 'click', () => document.getElementById('importFile').click());
  on('importFile', 'change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const imported = JSON.parse(text);
    settings = deepMerge(DEFAULT_SETTINGS, imported);
    fillForm(settings);
    refreshCustomFieldsVisibility();
    saveStatus.textContent = '已导入，点击保存后生效';
    appendLog({ level: 'info', apiType: 'system', event: 'SETTINGS_IMPORTED', message: '设置文件已导入' });
  });

  // History actions
  on('clearHistoryOptionsBtn', 'click', async () => {
    if (!confirm('确定清空全部历史记录吗？')) return;
    await clearHistory();
    appendLog({ level: 'info', apiType: 'system', event: 'HISTORY_CLEARED', message: '历史记录已清空' });
    saveStatus.textContent = '历史记录已清空';
  });

  on('exportHistoryOptionsBtn', 'click', async () => {
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

  on('importHistoryOptionsBtn', 'click', () => document.getElementById('historyImportFile').click());
  on('historyImportFile', 'change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const payload = JSON.parse(await file.text());
    if (!['PromptLens', 'PromptPilot'].includes(payload?.app) || !Array.isArray(payload.items)) {
      throw new Error('历史文件格式无效');
    }
    await importHistory(payload.items);
    saveStatus.textContent = '历史记录已导入';
    appendLog({ level: 'info', apiType: 'system', event: 'HISTORY_IMPORTED', message: '历史记录已导入' });
  });

  on('clearDraftOptionsBtn', 'click', async () => {
    await clearDraft();
    saveStatus.textContent = '草稿已清空';
    appendLog({ level: 'info', apiType: 'system', event: 'DRAFT_CLEARED', message: '草稿已清空' });
  });

  // Debug log actions
  on('exportDebugLogsBtn', 'click', async () => {
    const logs = await getLogs();
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `promptlens-debug-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    saveStatus.textContent = `已导出 ${logs.length} 条日志`;
    appendLog({ level: 'info', apiType: 'system', event: 'LOGS_EXPORTED', message: `导出了 ${logs.length} 条日志` });
  });

  on('clearDebugLogsBtn', 'click', async () => {
    if (!confirm('确定清空全部调试日志吗？')) return;
    await clearLogs();
    saveStatus.textContent = '日志已清空';
    appendLog({ level: 'info', apiType: 'system', event: 'LOGS_CLEARED', message: '日志已清空' });
  });

  // Test Prompt API
  // Test text interface (no image)
  on('testPromptTextBtn', 'click', async () => {
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
  on('testPromptVisionBtn', 'click', async () => {
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

  // Test Image API — uses the same payload builder as the real generation flow
  on('testImageBtn', 'click', async () => {
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
      message: `手动测试 Image API 配置${realTest ? ' (真实出图)' : ''}`
    });

    try {
      const outputSize = getOutputSize({
        sizeMode: api.sizeMode,
        aspectRatio: api.aspectRatio,
        resolutionPreset: api.resolutionPreset,
        customWidth: api.customWidth,
        customHeight: api.customHeight,
        referenceImage: null
      });

      const modelConfig = findImageModelConfig(api.model);

      // Determine URL and payload by provider type first. Model names may overlap
      // between OpenAI-compatible providers and the built-in Grsai routes.
      let url, body;
      if (api.type === 'custom-image' && modelConfig?.channel) {
        // Known model — use v2 unified endpoint with channel-aware payload
        url = (api.baseUrl || '').replace(/\/+$/, '') + (api.endpoint || modelConfig.submitEndpoint);

        const testPrompt = realTest ? 'a simple test image of a sunset over mountains' : 'test';
        const { payload } = buildImageApiPayload({
          model: api.model,
          prompt: testPrompt,
          outputSize,
          channel: modelConfig.channel,
          images: [],
          settings: current
        });

        body = payload;

        appendLog({
          level: 'info',
          apiType: 'image',
          event: 'IMAGE_PAYLOAD_SIZE',
          provider: api.type,
          message: `Test image size: ${outputSize.size}`,
          data: {
            requestedSize: outputSize.size,
            width: outputSize.width,
            height: outputSize.height,
            channel: modelConfig.channel,
            provider: api.type
          }
        });
      } else if (api.type === 'custom-image') {
        // Unknown custom model — use user's requestTemplate/config (same as real generation)
        const testPrompt = realTest ? 'a simple test image of a sunset over mountains' : 'test';
        const request = buildCustomImageRequest({
          api, prompt: testPrompt, outputSize,
          count: 1, mode: 'standard'
        });

        url = request.url;
        body = request.body;
        // Override method/headers from the built request
        const fetchMethod = request.method;
        const fetchHeaders = request.headers;

        const ps = request.providerSize;
        const sf = request.sizeFormat || 'x';
        appendLog({
          level: 'info',
          apiType: 'image',
          event: 'IMAGE_PAYLOAD_SIZE',
          provider: api.type,
          message: `Test custom image size: ${outputSize.size}`,
          data: { requestedSize: outputSize.size, providerSize: ps, width: outputSize.width, height: outputSize.height, sizeFormat: sf, provider: api.type }
        });

        // Send with built method/headers (body is already a template-replaced string from customApi)
        const response = await fetch(url, {
          method: fetchMethod,
          headers: fetchHeaders,
          body: fetchMethod === 'GET' ? undefined : body
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
        return; // early return — already handled fetch + response
      } else {
        // Fallback: use old OpenAI-compatible format for openai-compatible-image type
        url = (api.baseUrl || '').replace(/\/+$/, '') + (api.endpoint || '/v1/images/generations');
        const providerSize = getProviderSizeForFormat(outputSize, api);

        if ((api.sizeFormat || 'x') === 'openai-mapped' && providerSize !== outputSize.size) {
          appendLog({
            level: 'info',
            apiType: 'image',
            event: 'IMAGE_SIZE_MAPPED',
            provider: api.type,
            message: `Test image size mapped: ${outputSize.size} -> ${providerSize}`,
            data: { requestedSize: outputSize.size, providerSize, reason: 'OpenAI-compatible provider only supports fixed image sizes' }
          });
        }

        appendLog({
          level: 'info',
          apiType: 'image',
          event: 'IMAGE_PAYLOAD_SIZE',
          provider: api.type,
          message: `Test image payload size: ${providerSize}`,
          data: { requestedSize: outputSize.size, providerSize, width: outputSize.width, height: outputSize.height, sizeFormat: api.sizeFormat || 'x', provider: api.type }
        });

        body = {
          model: api.model,
          prompt: realTest ? 'a simple test image of a sunset over mountains' : 'test',
          n: 1,
          size: providerSize
        };
      }

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
