# 顶部 API 状态显示器设计文档

## 目标

右上角不放“提交图片”按钮，改成状态显示器：

```text
[Prompt API ● 正常] [Image API ● 未配置] [刷新] [设置]
```

## 状态

- unconfigured：未配置
- checking：检测中
- connected：正常
- unauthorized：Key 无效
- timeout：超时
- offline：服务离线
- error：连接异常

## 联动

- Prompt API 未连接时，反推按钮禁用
- Image API 未连接时，生成按钮禁用

## MVP 检测规则

第一版使用 mock 检测：

- 配置为空：unconfigured
- 配置完整：connected
