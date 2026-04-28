# 设置页 Options UI 设计文档

## Tabs

1. 通用设置
2. Prompt 接口
3. 图像生成接口
4. 默认参数
5. 历史与存储
6. 高级设置

## Prompt 接口

Provider：
- OpenAI-compatible
- Claude / Anthropic-compatible

OpenAI 字段：
- Base URL
- API Key
- Model
- Max Tokens
- Temperature

Anthropic 字段：
- Base URL
- API Key
- Model
- Anthropic Version
- Max Tokens
- Temperature

## 图像生成接口

Provider：
- OpenAI Images
- ComfyUI
- Stable Diffusion WebUI
- Replicate
- Fal
- Custom

ComfyUI 字段：
- Host
- Prompt API
- History API
- Upload API
- Workflow Name

SD WebUI 字段：
- Host
- txt2img API
- img2img API
- Sampler
- Steps
- CFG Scale

Custom 字段：
- Base URL
- API Key
- Model
- Generate API Path
- Status API Path

## 保存规则

设置保存到 `chrome.storage.local.settings`。
