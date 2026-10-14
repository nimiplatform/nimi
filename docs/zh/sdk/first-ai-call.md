# 在 Nimi App 中完成第一次 AI 调用

欢迎开发你的第一个 AI 原生 Nimi App！本指南将带你用几行代码发起一次真实的文本生成请求。

在这个过程中，你将直观体会到 Nimi 的核心设计理念：**应用代码无需接触 API Key、内部 gRPC 端口或厂商特定的路由逻辑——只需声明你想要完成的任务。**

---

## 1. 准备工作

发起调用前，请确认以下三项准备就绪：

1. **受管开发环境已启动**：在应用根目录运行 `pnpm dev`。应用会在 Nimi Desktop 托管的 Electron 窗口中启动，并自动注入安全宿主桥接（请勿在普通浏览器中直接打开裸渲染器 URL）。
2. **权限声明与会话已就绪**：确认 `nimi.app.yaml` 中已声明 `runtime.consume`。在 Nimi Home 的 Nimi Access 中查看当前开发应用的注册状态，确认会话已就绪（窗口成功启动不代表访问权限已就绪）。
3. **AI 能力意图已配置**：打开应用的 AI 设置面板，为 `text.generate` 能力指定首选执行模型（可选择 Nimi 中已就绪的本地模型，或已配置凭据的云端服务商）。

---

## 2. 编写文本生成逻辑

通过 App Tools 创建的项目已预置绑定宿主的客户端单例。在 `src/first-ai-call.ts` 中编写如下代码：

```ts
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

export async function generateText(prompt: string) {
  // 获取已绑定宿主会话的客户端单例
  const client = getNimiLocalAppClient();

  // 发起单轮文本生成请求
  const response = await client.ai.text.generateCandidate({
    messages: [
      { role: 'user', text: prompt }
    ],
  });

  return response.text;
}
```

### 幕后发生了什么？

- **零凭据暴露**：前端代码中没有任何 API Key、密钥令牌或私有端点。
- **自动身份解析**：Runtime 直接从受保护的宿主桥接中提取 App 身份，并读取该应用已保存的路由规则。
- **天然跨端可移植**：无论请求最终由本地显卡上的开源权重模型执行，还是交由远端云模型处理，应用层的调用契约完全一致。

---

## 3. 连接界面并触发调用

App Tools 默认模板使用 React。将以下组件保存为 `src/FirstAIExample.tsx`，并在你的产品页面中（需位于现有的 `WorkbenchRuntimeGate` 内部）渲染 `<FirstAIExample />`。请保留模板原有的登录、Runtime 就绪检查及 AI 设置控件：

```tsx
import { useState } from 'react';
import { generateText } from './first-ai-call';

export function FirstAIExample() {
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function generate() {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      setResult(await generateText(prompt));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '生成失败，请检查 AI 设置。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <label>
        你的问题
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <button disabled={busy || !prompt.trim()} onClick={generate}>
        {busy ? '生成中…' : '生成'}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && <pre style={{ whiteSpace: 'pre-wrap' }}>{result}</pre>}
    </section>
  );
}
```

---

## 4. 常见问题快速诊断

排查时请先区分请求是“仍在生成中”还是“已失败”，并在失败时保留完整的错误详情。下表中的 `principal-unauthorized` 与 `runtime-unavailable` 是 Lab 界面的展示分类，并非所有 SDK 调用都会直接返回这两个原始错误码：

| 异常提示 | 可能原因 | 解决办法 |
| :--- | :--- | :--- |
| `AI_CONFIG_NOT_FOUND` | 尚未保存该能力的模型偏好 | 打开 App 设置，为 `text.generate` 选择本地或云端模型并保存。 |
| `principal-unauthorized` | 当前会话或调用主体未获准执行该操作。 | 检查 Nimi Home 的登录与该应用的 Nimi Access 状态，并核对 `nimi.app.yaml` 中所需的访问声明；AI 调用需要 `runtime.consume`。 |
| `runtime-unavailable` | 本地 Runtime 服务未启动 | 检查终端中的 `pnpm dev:runtime` 是否正在运行。 |
| 模型无响应 / 超时 | 本地显存不足或远端网络延迟 | 查看 Runtime 终端输出，切换至更轻量的模型或检查网络连接。 |

---

## 接下来

- [探索完整 SDK 功能索引](/zh/sdk/) — 了解流式输出、Agent 编排与 Realm 资源
- [AI 能力配置规范](/zh/sdk/ai-config-surface) — 深入了解多模型路由分发与用户控制权
- [使用 Nimi Kit 打造丰富界面](/zh/platform/kit/use-kit-in-app) — 快速集成开箱即用的跨端 UI 组件

## Source Basis

- [`app-tools/templates/default-starter/src/shell/auth/local-app-client.ts`](https://github.com/nimiplatform/nimi/blob/main/app-tools/templates/default-starter/src/shell/auth/local-app-client.ts)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
