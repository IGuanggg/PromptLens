\# PromptLens 项目上下文



\## 项目定位



PromptLens 是一个 Chrome Manifest V3 浏览器插件，用于把网页图片、上传图片、粘贴图片转成 AI 文生图提示词，并继续调用 Image API 生成图片。



核心流程：



1\. 用户右键网页图片，点击“图片转提示词”

2\. 图片进入插件 Side Panel

3\. 用户点击“反推”

4\. Prompt API 分析图片，输出 tags、中文提示词、英文提示词

5\. 用户可以复制、优化、自定义补充提示词

6\. 用户可以点击“生成图片”或“生成多角度”

7\. Image API 生成结果图

8\. 支持历史记录、调试日志、下载图片



\## 当前重要决策



\### 1. 不做 ComfyUI



不要加入：

\- ComfyUI

\- workflowJson

\- workflowName

\- 节点映射

\- 工作流图



项目只走标准 HTTP API / OpenAI-compatible / DIY Custom API。



\### 2. 接口体系已收口



Prompt API 只保留：



\- OpenAI-compatible

\- Custom Prompt API



Image API 只保留：



\- OpenAI-compatible Image / OpenAI Images JSON

\- Custom Image API



不要恢复 Claude、Gemini、OpenRouter、Replicate、fal、Stability 等复杂 Provider。



\### 3. Prompt 反推模板



不要做复杂模板系统。



只保留一个内置反推模板：



用户需求：

请帮我分析这张图片，并生成一个能够指导 AI 作图工具重新创作类似作品的文生图提示词。



分析维度：

\- 主体内容

\- 场景设定

\- 风格参考

\- 色彩

\- 色调

\- 构图

\- 视角

\- 灯光氛围

\- 细节补充



输出 JSON：



{

&#x20; "tags": \[],

&#x20; "zh": "",

&#x20; "en": ""

}



注意：

\- 保持内置反推提示词不变

\- 设置页允许增加“自定义补充提示词”

\- 自定义补充提示词只作为附加要求合并，不覆盖内置模板

\- 不要输出具体艺术家姓名、品牌名、版权角色名、影视作品名、游戏 IP 名称

\- 不要使用“完全复刻”“一模一样”“同款”“仿某某艺术家”等表达



\### 4. 图片输入



支持：



\- 右键图片

\- 上传图片

\- 粘贴图片

\- 拖拽图片



调用 Prompt API 时图片优先级：



1\. currentImage.dataUrl

2\. currentImage.displayUrl

3\. currentImage.url



如果是 blob 或防盗链图片，优先转 dataURL。



\### 5. 调试日志



必须能知道是否真的调用接口。



必须记录：



\- API\_REQUEST\_START

\- API\_REQUEST\_SUCCESS

\- API\_REQUEST\_ERROR

\- PROMPT\_REVERSE\_START

\- PROMPT\_REVERSE\_SUCCESS

\- PROMPT\_REVERSE\_ERROR

\- IMAGE\_GENERATE\_START

\- IMAGE\_GENERATE\_SUCCESS

\- IMAGE\_GENERATE\_ERROR

\- IMAGE\_PAYLOAD\_SIZE

\- IMAGE\_SIZE\_MAPPED

\- MULTI\_ANGLE\_GENERATE\_START

\- MULTI\_ANGLE\_IMAGE\_START

\- MULTI\_ANGLE\_IMAGE\_SUCCESS

\- MULTI\_ANGLE\_IMAGE\_ERROR



日志必须脱敏：



\- API Key

\- Authorization

\- base64 图片内容



base64 只保留前 80 字符加 ...\[truncated]



\### 6. SSE 支持



Image API 可能返回 SSE 文本：



data: {"status":"running","progress":1}



data: {"status":"failed","failure\_reason":"output\_moderation","error":"..."}



需要支持：

\- parseSseText()

\- normalizeImageStreamResult()



如果 failure\_reason = output\_moderation，显示：

图片生成被安全审核拦截，可能是提示词与第三方内容过于相似。



不要把 SSE 解析失败笼统显示为 INVALID\_RESPONSE。



\### 7. 输出尺寸配置



当前要升级为：



清晰度：

\- 1K / 标准：1920 × 1080，适合快速生成和普通预览

\- 2K / 高清：2560 × 1440，适合更清晰的作品输出

\- 4K / 超清：3840 × 2160，适合高质量大图输出



这些是 16:9 横图基准尺寸。



比例：

\- 1:1

\- 4:3

\- 3:4

\- 16:9

\- 9:16



尺寸映射：



1K：

\- 1:1 = 1080 × 1080

\- 16:9 = 1920 × 1080

\- 9:16 = 1080 × 1920

\- 4:3 = 1440 × 1080

\- 3:4 = 1080 × 1440



2K：

\- 1:1 = 1440 × 1440

\- 16:9 = 2560 × 1440

\- 9:16 = 1440 × 2560

\- 4:3 = 1920 × 1440

\- 3:4 = 1440 × 1920



4K：

\- 1:1 = 2160 × 2160

\- 16:9 = 3840 × 2160

\- 9:16 = 2160 × 3840

\- 4:3 = 2880 × 2160

\- 3:4 = 2160 × 2880



主尺寸来源必须是 getOutputSize()。



不要让生成图片固定回 1:1。



如果 provider 不支持该尺寸，可以在 adapter 层映射，但必须写日志：



\- requestedSize

\- providerSize

\- sizeFormat

\- provider



\### 8. 多角度生成



按钮“混合生成4张”已改成或需要改成：



生成多角度



点击后生成 4 张：



1\. 参考角度

2\. 侧面视角

3\. 背面视角

4\. 顶面视角 / 俯视



要求：

\- 保持同一主体

\- 保持服装、材质、色彩、场景、风格一致

\- 只是改变视角

\- 顺序请求，避免限流

\- 单张失败不要导致全部失败

\- 多角度生成也必须使用 getOutputSize()

\- 不要回退到 1:1



\### 9. UI 偏好



插件 UI 是深色科技风，主色是青绿色 / teal。



当前头部 UI 太丑，需要保持：

\- PromptLens 标题

\- 智能图像提示词助手

\- Prompt API 状态

\- Image API 状态

\- 最近调用状态

\- 调试

\- 历史

\- 刷新

\- 设置



但要优化布局、间距、按钮层级、状态芯片。



\### 10. 不要破坏现有功能



任何修改必须保证：



\- Prompt API 可用

\- Image API 可用

\- 右键图片可用

\- 上传图片可用

\- 粘贴图片可用

\- 拖拽图片可用

\- 反推可用

\- 生成图片可用

\- 生成多角度可用

\- SSE 解析可用

\- 错误卡片可用

\- 调试日志可用

\- 自定义提示词设置可用

\- 历史记录可用

\- 下载单张 / 下载全部可用

\- 不加入 ComfyUI

\- 不恢复复杂 Provider



\## 需要重点审查的问题



1\. 生成图片尺寸和设置比例不一致，曾经全部输出 1:1

2\. 需要搜索并清理错误硬编码：

&#x20;  - 1024x1024

&#x20;  - width: 1024

&#x20;  - height: 1024

&#x20;  - config.size

&#x20;  - settings.imageApi.size

&#x20;  - p720

&#x20;  - p1080

&#x20;  - qualityPreset

&#x20;  - standard

&#x20;  - ultra

3\. 允许 1024x1024 只作为 OpenAI fallback 映射存在

4\. 允许 p720 / p1080 只在迁移函数里存在

5\. 生成图片 payload 必须能在日志中看到真实 size

6\. 多角度生成也必须记录每个角度的请求和尺寸



\## 当前希望 Claude Code 做事方式



每次修改前先读：

\- CLAUDE.md

\- AUDIT.md 如果存在

\- package.json

\- manifest.json

\- extension/src/services/imageService.js

\- extension/src/services/promptService.js

\- extension/src/utils/size.js

\- extension/src/adapters/image/\*

\- extension/src/sidepanel/\*

\- extension/src/options/\*



每次修改后输出：

1\. 修改了哪些文件

2\. 为什么这么改

3\. 是否影响现有功能

4\. 如何测试

5\. 是否更新 AUDIT.md

