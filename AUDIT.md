# PromptLens 尺寸升级审查报告

## 修改目标

把输出清晰度升级为 1K / 2K / 4K，并确保生成图片使用用户设置的比例和尺寸。

## 修改文件

- `extension/src/utils/size.js`
- `extension/src/services/storageService.js`
- `extension/src/options/options.html`
- `extension/src/options/options.css`
- `extension/src/options/options.js`
- `extension/src/sidepanel/sidepanel.js`
- `extension/src/services/imageService.js`
- `extension/src/services/historyService.js`
- `extension/src/adapters/image/openaiCompatibleImage.js`
- `extension/src/adapters/image/custom.js`
- `extension/src/utils/image.js`
- `extension/src/utils/mockImages.js`

## 审计发现 & 修复 (2026-05-11)

### 修复 1: `collectReferencedBlobIds` + 接入 `cleanupBlobs`

**问题**: `imageBlobStore.js` 的 `cleanupBlobs()` 接受 `referencedIds` 参数，但没有代码收集历史条目中的 blob ID 并传入。空 `referencedIds` 会导致所有 blob 被当作孤儿删除。

**修复**:
- 在 `historyService.js` 新增 `collectReferencedBlobIds()` — 扫描全部历史记录，收集 `thumbnailBlobId`、`sourceImageBlobId`、`image.blobId`、`resultBlobIds`、`results[].blobId`。
- 在 `sidepanel.js` 新增 `scheduleBlobCleanup()` — 2 秒防抖后执行清理。
- 在 `persistCurrentHistory`、`handleDeleteHistoryItem`、`handleClearHistory` 中调用清理。

### 修复 2: 缩略图 Blob 在保存时生成

**问题**: `createThumbnailBlob` 已在 `sidepanel.js` 导入但从未调用。`createHistoryItemFromState` 存储 `thumbnailBlobId`（来自 `currentImage.thumbnailBlobId`），但无代码设置该字段。

**修复**:
- 在 `persistSourceBlob()` 中，源图 Blob 保存成功后立即调用 `createThumbnailBlob(blob, { maxWidth: 256, maxHeight: 256 })` 生成 256px WebP 缩略图。
- 缩略图也保存到 IndexedDB，并将返回的 `blobId` 写入 `image.thumbnailBlobId`。
- 历史缩略图现在可走完整 5 级加载链：缩略图 blob → 源图 blob → 结果 blob → 远程 URL → 占位符。

### 修复 3: `persistSourceBlob` CORS 失败可诊断

**问题**: 右键 URL 图片的 remote fetch 静默失败，无法诊断 CORS/防盗链问题。

**修复**:
- 在 fetch 失败时写入 `BLOB_PERSIST_FETCH_FAILED` 日志事件，包含 sourceUrl 前缀和 isCors 标记。

### 修复 4: `updateResolutionDescription` 未定义（已定义）

**问题**: `options.js` 第 239 行调用 `updateResolutionDescription?.()`，但该函数未定义。虽不会崩溃（可选链），但 `#resolutionDescription` 描述文本永不更新。

**修复**:
- 在 `options.js` 中定义 `updateResolutionDescription()`，根据 `resolutionPreset`（1k/2k/4k）更新 `#resolutionDescription` 元素。
- 在 `loadSizeState()` 和 `resolutionPreset.change` 事件中调用该函数。

### 修复 5: 历史 base64 dataUrl → IndexedDB 迁移

**问题**: 旧历史条目中 `image.dataUrl` 仍存有大图 base64，占空间且不能被 IndexedDB 加载路径读取。

**修复**:
- 在 `historyService.js` 新增 `migrateHistoryImagesToBlobStore()` — 扫描含 base64 dataUrl 的历史条目，转存到 IndexedDB，设置 `blobId`/`sourceImageBlobId`，清空 `dataUrl`。
- 在 `sidepanel.js` init 流程中懒加载调用（静默失败不阻塞）。

### 验证: 非问题项

以下审计怀疑项经代码审查确认为非问题：

- **Issue 4**: `sidepanel-debug.js` 硬编码路径 — 该文件不存在，调试功能全部在 `sidepanel.js` 内联。
- **Issue 6**: 粘贴事件双重绑定 — `bindEvents()` 无 paste 绑定，按钮 + 键盘粘贴是互补关系。
- **Issue 7**: `openDockedPanel` 300ms 延迟 — 已添加注释说明 load-timing 竞态 + `pendingImage` storage fallback。
- **Issue 8**: 通知图标路径 — `extension/assets/icon128.png` 存在。
- **Issue 10**: `handleRegenerate` 锁 — `handleGenerate()` 首行即检查 `_isGenerating`，已受保护。

## 新尺寸规则

### Grsai API v2 升级 (2026-05-11)

**变更**：根据新版 Grsai API 文档将双通道旧端点迁移到统一端点。

**修改文件**：
- `extension/src/data/imageModels.js` — 所有模型 endpoint 更新，新增 `resultMethod`/`resultIdMode`，修复 `validateNanoBananaPayload`
- `extension/src/services/imageService.js` — `callDrawApi()` 载荷重构，同步结果快速返回
- `extension/src/services/imageTaskService.js` — 轮询默认值从 POST/json 改为 GET/query
- `extension/src/services/storageService.js` — 默认 `resultEndpoint` 更新，移除废弃字段

**端点变更**：
| 用途 | 旧 | 新 |
|------|----|----|
| 提交生成 | `POST /v1/draw/completions` 或 `/v1/draw/nano-banana` | `POST /v1/api/generate` |
| 结果轮询 | `POST /v1/draw/result` (JSON body) | `GET /v1/api/result?id={taskId}` |

**载荷变更**：
- `urls` → `images`（参考图字段）
- 新增 `replyType: "json"`
- 移除 `webHook`, `shutProgress`, `quality`
- gpt-image-2 的 `aspectRatio` 改为尺寸格式（如 `"1920x1080"`）
- nano-banana 的 `aspectRatio` 保持比例格式（如 `"1:1"`）

**同步快速返回**：提交后如 API 直接返回 `status: "succeeded"` + results，跳过轮询直接返回。

| 比例 | 1K / 标准 | 2K / 高清 | 4K / 超清 |
| --- | --- | --- | --- |
| 1:1 | 1080 x 1080 | 1440 x 1440 | 2160 x 2160 |
| 16:9 | 1920 x 1080 | 2560 x 1440 | 3840 x 2160 |
| 9:16 | 1080 x 1920 | 1440 x 2560 | 2160 x 3840 |
| 4:3 | 1440 x 1080 | 1920 x 1440 | 2880 x 2160 |
| 3:4 | 1080 x 1440 | 1440 x 1920 | 2160 x 2880 |

## 数据流

Options 设置页写入 `imageApi.sizeMode`、`imageApi.aspectRatio`、`imageApi.resolutionPreset`、`imageApi.customWidth`、`imageApi.customHeight`。

`chrome.storage.local` 中的 settings 会通过 `loadSettings()` 合并默认值并迁移旧字段。

Side Panel 读取 settings 后调用 `getOutputSize()`，得到 `width`、`height`、`size`、`dashscopeSize`、`aspectRatio`、`resolutionPreset`、`sizeMode`。

`imageService` 只接收并继续传递这个 `outputSize`，adapter 根据 `sizeFormat` 选择 `providerSize`。

最终 request payload 使用 `providerSize` 或自定义模板变量中的 `{{size}}` / `{{dashscopeSize}}`。

## 已清理旧字段

- `p720`：仅在 `migrateResolutionPreset()` 中作为旧值迁移到 `1k`。
- `p1080`：仅在 `migrateResolutionPreset()` 中作为旧值迁移到 `1k`。
- `qualityPreset`：未作为尺寸来源使用。
- `standard`：作为旧清晰度值迁移到 `1k`；其他出现位置是生成模式或英文注释，不是尺寸配置。
- `hd`：作为旧清晰度值迁移到 `2k`。
- `ultra`：作为旧清晰度值迁移到 `4k`。

## 硬编码检查

仍存在 `1024x1024`、`1536x1024`、`1024x1536`，仅用于 `mapSizeForOpenAIImages()` 的 OpenAI 兼容 fallback 映射，合法。

没有发现普通生成 payload 里硬编码 `1024x1024`、`width: 1024` 或 `height: 1024`。

没有发现 `config.size` 覆盖 `outputSize.size`。

`settings.imageApi.size` 只作为兼容字段保存，不作为主尺寸来源。主尺寸来源是 `getOutputSize()`。

生成图片日志包含 `requestedSize`；adapter payload 日志包含 `providerSize`。当 `sizeFormat = "openai-mapped"` 且尺寸被映射时，会写入 `IMAGE_SIZE_MAPPED`。

## 测试用例

1. 16:9 + 1K = 1920 x 1080
2. 16:9 + 2K = 2560 x 1440
3. 16:9 + 4K = 3840 x 2160
4. 9:16 + 1K = 1080 x 1920
5. 9:16 + 2K = 1440 x 2560
6. 9:16 + 4K = 2160 x 3840
7. 1:1 + 1K = 1080 x 1080
8. 多角度生成 + 9:16 + 2K = 1440 x 2560，并传递同一个 `outputSize`
9. 测试 Image API + 4K = 根据比例生成 4K requestedSize，若 openai-mapped 则记录 providerSize
10. Custom Image API 模板变量 `{{size}}` = `widthxheight`

## 已知限制

如果 provider 不支持原始 `requestedSize`，并且 `sizeFormat = "openai-mapped"`，会在 adapter 层映射为兼容尺寸，并在日志里记录 `IMAGE_SIZE_MAPPED`。

OpenAI 兼容图像接口常见兼容尺寸为 `1024x1024`、`1536x1024`、`1024x1536`、`auto`。因此 1K / 2K / 4K 是 PromptLens 的目标输出尺寸，实际发送尺寸可能被 provider 映射。
