/**
 * Content script for PromptLens.
 *
 * Responsibilities:
 *  - Listen for FETCH_BLOB messages from background.js
 *  - Fetch blob URLs in the page's own context (where they are valid)
 *  - Convert the blob to a data URL and send it back
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'FETCH_BLOB' && message.blobUrl) {
    handleFetchBlob(message.blobUrl)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // keep the message channel open for async response
  }
});

/**
 * Fetch a blob URL in the page's context, read it as a data URL.
 */
async function handleFetchBlob(blobUrl) {
  try {
    const response = await fetch(blobUrl);
    if (!response.ok) {
      return { success: false, error: `Blob 请求失败 (HTTP ${response.status})` };
    }

    const blob = await response.blob();

    // Validate it's an image
    if (!blob.type || !blob.type.startsWith('image/')) {
      return { success: false, error: `非图片 MIME 类型: ${blob.type || 'unknown'}` };
    }

    // Convert blob → data URL
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('FileReader 读取失败'));
      reader.readAsDataURL(blob);
    });

    return { success: true, dataUrl, mimeType: blob.type, sizeBytes: blob.size };
  } catch (error) {
    return { success: false, error: error.message || 'Blob 处理失败' };
  }
}
