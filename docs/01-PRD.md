# 浏览器插件产品需求文档 PRD

## 产品名称

正式：PromptLens

## 产品定位

PromptLens 是一个浏览器侧边栏插件，用于把网页图片快速转成 AI 绘图提示词。用户在网页图片上右键，选择“图片转提示词”，图片进入插件侧边栏后，用户点击“反推”即可得到中文提示词、英文提示词和风格标签。

## 核心流程

```text
网页图片
→ 右键图片
→ 图片转提示词
→ 图片进入 Side Panel
→ 点击反推
→ 得到中文 Prompt / English Prompt / tags
→ 复制、优化或继续生成图片
```

## MVP 功能

1. 右键图片菜单
2. 发送图片到 Side Panel
3. 顶部 Prompt API / Image API 状态显示器
4. 点击反推生成 Prompt
5. 中文提示词、英文提示词、标签展示
6. 复制中文、复制英文
7. 优化中文、优化英文
8. 图像生成接口独立配置
9. mock 生成 4 张图
10. 下载单张 / 下载全部

## 接口分层

### Prompt / Vision 接口

用于：
- 看图
- 反推提示词
- 优化提示词
- 翻译提示词

支持：
- OpenAI-compatible
- Claude / Anthropic-compatible

### Image Generation 接口

用于：
- 文生图
- 图生图
- 混合生成 4 张
- 变体生成

支持：
- OpenAI Images
- ComfyUI
- Stable Diffusion WebUI
- Replicate
- Fal
- Custom

## 验收标准

1. 图片右键菜单出现“图片转提示词”
2. 点击后 Side Panel 自动打开
3. 图片显示在当前图片区
4. 点击反推后出现 mock Prompt
5. 顶部 API 状态器能显示未配置 / 正常 / 异常
6. 设置页能保存配置
7. mock 图片生成结果能显示 2 x 2 网格
