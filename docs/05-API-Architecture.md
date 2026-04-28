# API 接口分层设计文档

## 两套接口体系

### Prompt / Vision

支持：
- OpenAI-compatible
- Claude / Anthropic-compatible

统一函数：

```js
generatePromptFromImage({ imageUrl, settings })
enhancePrompt({ text, language, settings })
```

统一返回：

```js
{
  tags: [],
  zh: '',
  en: '',
  provider: '',
  raw: {}
}
```

### Image Generation

支持：
- OpenAI Images
- ComfyUI
- SD WebUI
- Replicate
- Fal
- Custom

统一函数：

```js
generateImages({ prompt, negativePrompt, referenceImage, settings, mode, count })
```

统一返回：

```js
{
  images: [
    { id, url, thumbUrl, label, provider, width, height }
  ],
  provider: '',
  raw: {}
}
```
