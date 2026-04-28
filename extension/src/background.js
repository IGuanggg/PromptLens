import { appendLog, initLogService, setLogSettings } from './services/logService.js';
import { loadSettings } from './services/storageService.js';

const MENU_ID = 'image-to-prompt';
const POPUP_URL = 'src/sidepanel/sidepanel.html';
const POPUP_WIDTH = 440;
const POPUP_HEIGHT = 720;

let popupWindowId = null;

// Initialize logging on service worker start
(async () => {
  const settings = await loadSettings();
  setLogSettings(settings);
  await initLogService(settings);
})();

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({
    id: MENU_ID,
    title: '图片转提示词',
    contexts: ['image']
  });

  appendLog({
    level: 'info',
    apiType: 'system',
    event: 'EXTENSION_INSTALLED',
    message: '插件已安装/更新'
  });
});

// ── Toolbar icon click: open popup ──
chrome.action.onClicked.addListener(async () => {
  await openPopupWindow();
});

// ── Right-click context menu ──
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!info.srcUrl) return;

  const srcUrl = info.srcUrl;
  const isBlob = String(srcUrl).startsWith('blob:');

  appendLog({
    level: 'info',
    apiType: 'system',
    event: 'CONTEXT_MENU_CLICKED',
    message: `右键图片: ${isBlob ? 'blob URL' : 'normal URL'}`,
    data: { isBlob, pageUrl: tab?.url }
  });

  const basePayload = {
    srcUrl,
    url: srcUrl,
    tabId: tab?.id || null,
    pageUrl: tab?.url || '',
    pageTitle: tab?.title || '',
    source: 'context-menu',
    createdAt: Date.now()
  };

  // Blob URL handling
  if (isBlob && tab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, {
        type: 'FETCH_BLOB',
        blobUrl: srcUrl
      });

      if (response?.success && response.dataUrl) {
        const payload = { ...basePayload, dataUrl: response.dataUrl, displayUrl: response.dataUrl, recoverable: true, warning: '' };

        appendLog({
          level: 'info',
          apiType: 'system',
          event: 'BLOB_CONVERTED',
          message: 'Blob URL 已转换为 data URL'
        });

        await chrome.storage.local.set({ pendingImage: payload });
        await openPopupWindow(payload);
        return;
      }
    } catch (error) {
      appendLog({
        level: 'warn',
        apiType: 'system',
        event: 'BLOB_FETCH_FAILED',
        message: `Blob URL 获取失败: ${error?.message || ''}`
      });
    }
  }

  // Fallback
  const payload = isBlob
    ? { ...basePayload, dataUrl: '', displayUrl: '', recoverable: false, warning: '当前 blob 图片无法直接恢复，请尝试截图粘贴或本地上传' }
    : basePayload;

  await chrome.storage.local.set({ pendingImage: payload });

  appendLog({
    level: 'info',
    apiType: 'system',
    event: 'PENDING_IMAGE_SAVED',
    message: '图片已写入 pendingImage'
  });

  await openPopupWindow(payload);
});

// ── Listen for BLOB_CONVERTED from sidepanel ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'BLOB_CONVERTED' && message.payload) {
    chrome.storage.local.set({ pendingImage: message.payload });
    chrome.runtime.sendMessage({ type: 'IMAGE_SELECTED', payload: message.payload }).catch(() => {});
  }
});

// ── Track popup window close ──
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    popupWindowId = null;
  }
});

// ── Open popup window ──
async function openPopupWindow(payload) {
  // If window is already open, focus it and send the image
  if (popupWindowId !== null) {
    try {
      await chrome.windows.update(popupWindowId, { focused: true });
      if (payload) {
        // Small delay to let the window focus, then send
        setTimeout(() => {
          chrome.runtime.sendMessage({ type: 'IMAGE_SELECTED', payload }).catch(() => {});
        }, 300);
      }
      return;
    } catch {
      // Window was closed externally
      popupWindowId = null;
    }
  }

  try {
    // Load saved position or default center
    const storage = await chrome.storage.local.get('popupPosition');
    const pos = storage.popupPosition || {};

    const win = await chrome.windows.create({
      url: POPUP_URL,
      type: 'popup',
      width: pos.width || POPUP_WIDTH,
      height: pos.height || POPUP_HEIGHT,
      left: pos.left,
      top: pos.top,
      focused: true
    });

    popupWindowId = win.id;

    appendLog({
      level: 'info',
      apiType: 'system',
      event: 'POPUP_OPENED',
      message: `浮动窗口已打开 (id: ${win.id})`
    });
  } catch (error) {
    appendLog({
      level: 'error',
      apiType: 'system',
      event: 'POPUP_OPEN_FAILED',
      message: `浮动窗口打开失败: ${error?.message || ''}`
    });
  }
}
