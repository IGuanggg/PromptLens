# 前端状态结构与任务拆分文档

## State

```js
{
  currentImage: null,
  apiStatus: {
    prompt: { status: 'unconfigured', message: '' },
    image: { status: 'unconfigured', message: '' }
  },
  prompts: { tags: [], zh: '', en: '' },
  generateSettings: {
    providerType: 'comfyui',
    mode: 'mixed',
    width: 1024,
    height: 1024,
    count: 4
  },
  results: [],
  taskStatus: { phase: 'waiting-image', message: '等待右键发送图片' },
  settings: {}
}
```

## 开发顺序

1. manifest + side panel
2. 右键菜单传图
3. Side Panel UI
4. Options 设置页
5. API 状态检测
6. Prompt Adapter
7. 反推功能
8. Prompt 优化
9. Image Adapter
10. 下载功能
