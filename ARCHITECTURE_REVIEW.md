# PromptLens 架构审查报告

## 当前模块分层

- `extension/src/sidepanel/`：侧边栏 UI、用户操作入口、结果渲染、历史弹窗和调试抽屉。
- `extension/src/options/`：设置页 UI、配置读写、API 测试入口、尺寸预览。
- `extension/src/services/`：Prompt/Image 业务流程、历史、草稿、日志、下载、输入图片处理。
- `extension/src/data/`：模型能力、Provider 路由元数据、Grsai v2 payload 构造。
- `extension/src/utils/`：尺寸、HTTP、错误、格式化、模板、安全净化等通用能力。
- `extension/src/storage/`：IndexedDB 图片 Blob 存储。

## 主生成数据流

Side Panel 读取用户输入和当前图片
→ `loadSettings()`
→ `getOutputSize()`
→ `generateImages()` / `generateMultiAngleImages()`
→ `imageService` 根据 `settings.imageApi.type` 路由
→ Grsai v2 / OpenAI-compatible / Custom Image request
→ 日志记录 `IMAGE_GENERATE_START`、`IMAGE_PAYLOAD_SIZE`、`IMAGE_SIZE_MAPPED`
→ 结果渲染、Blob 持久化、历史保存。

## Options 测试 Image API 数据流

Options 表单读取当前配置
→ `getOutputSize()`
→ 按 Provider 类型优先路由：

- `custom-image` + 内置模型：使用 `buildImageApiPayload()` 构造 Grsai v2 payload。
- `custom-image` + 未知模型：使用 `buildCustomImageRequest()` 和用户 `requestTemplate`。
- `openai-compatible-image`：使用 OpenAI-compatible payload，并按 `sizeFormat` 映射尺寸。

这避免了模型名重叠时把 OpenAI-compatible 测试误路由到 Grsai v2 的问题。

## Provider 路由规则

- `api.type === "custom-image"` 且 `findImageModelConfig(api.model)` 命中内置模型：走 Grsai v2。
- `api.type === "custom-image"` 且模型未命中：走 Custom Image API 模板。
- `api.type === "openai-compatible-image"`：始终走 OpenAI-compatible，不受内置模型名影响。

## 旧 Storage Key 保留原因

以下 key 仍保留旧 `promptpilot` 前缀：

- `promptpilotDraft`
- `promptpilotHistory`
- `promptpilotLogs`
- `promptpilotLastCall`

原因是避免旧用户升级后丢失草稿、历史和调试日志。本次只清理用户不可见的 console 品牌前缀，不迁移 storage key。

## Legacy Adapter 审查

静态 import graph 显示以下文件目前不是主运行路径：

- `extension/src/adapters/image/custom.js`
- `extension/src/adapters/image/openaiCompatibleImage.js`
- `extension/src/adapters/image/index.js`
- `extension/src/adapters/prompt/custom.js`
- `extension/src/adapters/prompt/index.js`
- `extension/src/utils/image.js`
- `extension/src/utils/imageSize.js`

本次未删除这些文件，避免影响尚未扫描到的历史文档或外部引用。**暂不删除，待单独 dead-code PR 处理**：先标记 `@deprecated`，再删除，并用 `node scripts/verify.mjs` 回归。

## Side Panel 后续拆分建议

`sidepanel.js` 当前承担状态管理、事件绑定、渲染和业务调用，文件较大。建议下一轮低风险拆分：

- `sidepanel/historyView.js`：历史列表渲染、缩略图加载、历史操作按钮。
- `sidepanel/debugView.js`：调试抽屉、日志列表、日志详情。
- `sidepanel/resultsView.js`：生成结果卡片、失败卡片、下载按钮绑定。
- `sidepanel/imageInputView.js`：上传、拖拽、粘贴、预览状态渲染。

拆分时不要改变 `state` 结构、历史数据结构、按钮含义和生成流程。

## 本次新增验证

新增 `scripts/verify.mjs`，覆盖：

- 全部 extension JS 语法检查。
- `manifest.json` 解析。
- 1K / 2K / 4K 输出尺寸。
- OpenAI-compatible 尺寸映射。
- Grsai v2 payload。
- Custom Image 模板变量和认证方式。
- Provider 测试路由规则。
- Options / Side Panel DOM id 静态匹配。
- HTML 常见损坏标记检查。

运行：

```bash
node scripts/verify.mjs
```

## 当前结论

本次优化聚焦低风险防回归，没有修改 API Key 保存、storage key、默认 Grsai 配置、生成入口参数或历史记录结构。当前版本适合继续发布；后续主要工程改进是逐步拆分 `sidepanel.js` 和清理 legacy adapter。
