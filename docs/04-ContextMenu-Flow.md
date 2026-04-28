# 右键图片发送到插件流程文档

## 目标

用户在网页图片上右键，点击“图片转提示词”，把当前图片发送到 Side Panel。

## 流程

```text
右键图片
→ 点击“图片转提示词”
→ background.js 获取 info.srcUrl
→ 保存 pendingImage
→ 打开 Side Panel
→ sidepanel.js 读取 pendingImage
→ 展示图片
→ 用户点击反推
```

## 权限

需要：
- contextMenus
- storage
- sidePanel
- activeTab
- downloads

## 关键代码

```js
chrome.contextMenus.create({
  id: 'image-to-prompt',
  title: '图片转提示词',
  contexts: ['image']
});
```

点击后保存：

```js
await chrome.storage.local.set({ pendingImage: payload });
```
