# PromptPilot 尺寸升级审查报告

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

## 新尺寸规则

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

OpenAI 兼容图像接口常见兼容尺寸为 `1024x1024`、`1536x1024`、`1024x1536`、`auto`。因此 1K / 2K / 4K 是 PromptPilot 的目标输出尺寸，实际发送尺寸可能被 provider 映射。
