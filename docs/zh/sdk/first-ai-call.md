# 在 Nimi App 中完成第一次 AI 调用

使用 App 已绑定宿主的 SDK client，发起一次真实文本生成。Nimi Home 建立 App 会话，Runtime 在执行时读取该 App 已保存的 AI 配置并选择实现。

本页承接[创建 Nimi App](/zh/start/create-an-app)，示例对应公开 App Tools 0.2.7 默认模板。保留生成的 SDK/Kit 绑定；App 渲染进程不需要自行取得 gRPC 地址、账号 ID、会话 token 或指定调用者身份。

## 调用前准备

1. 在兼容的 Nimi Home 开发环境中运行项目的 `pnpm dev`，使用它启动的受管 Electron 窗口，不要直接用浏览器打开渲染页面。
2. 在 `nimi.app.yaml` 声明 `runtime.consume`，并通过宿主完成 App 所需的访问授权。声明权限与实际获得访问能力是两件事。
3. 在 App 的 AI 设置或 Nimi Home 的 App 设置中配置 `text.generate`。本地路线使用这台机器当前选择的模型；云端路线需要相应的连接器和目标配置。保存配置不等于生成已经成功。

环境要求见[开发环境与当前可用范围](/zh/start/install)，共享设置和宿主接入见[在 App 中使用 Kit](/zh/platform/kit/use-kit-in-app)。

## 发起文本生成

默认模板已在 `src/shell/auth/local-app-client.ts` 中导出 `getNimiLocalAppClient()`，直接复用即可。已有 App 的文件布局不同时，使用该项目对应的、已绑定宿主的 client。

```ts
// src/first-ai-call.ts in the default App Tools 0.2.7 starter
import { getNimiLocalAppClient } from './shell/auth/local-app-client.js';

export async function generateText(prompt: string) {
  const client = getNimiLocalAppClient();
  return await client.ai.text.generateCandidate({
    messages: [{ role: 'user', text: prompt }],
  });
}
```

从 App 的实际操作中调用 `generateText()`，展示返回的 `text`。等待时显示加载状态；失败时展示实际错误和可行的恢复动作，不能用示例回答冒充 Runtime 输出。

请求传入对话内容，不自行选择模型、连接器、执行地址、fallback 或机器绑定。Runtime 从受保护宿主会话确定 App 身份，再使用当前本地或云端配置。提供商凭据仍由 Runtime 管理。

## 处理第一次失败

| 失败情况 | 下一步 |
| --- | --- |
| App 会话未建立或访问被拒绝 | 回到受管启动与宿主授权流程，不要换成直连 Node/gRPC client，也不要自行传入身份。 |
| `AI_CONFIG_NOT_FOUND` 或缺少 `text.generate` 意图 | 在该 App 的 AI 设置中保存能力意图，再重试实际调用。 |
| 本地模型或云端配置不可用 | 检查该 App 当前设置，以及 Runtime 所选模型或连接器状态。保留真实错误；路线已配置不能证明执行成功。 |
| Runtime 已断开 | 恢复原有 Nimi Home／Runtime 开发实例，必要时重新打开受管 App，再重试同一操作。 |
| 请求发出后执行失败 | 查看 typed error 及其可用的原因、行动提示，不在客户端伪造 fallback 或悄悄切换提供商。 |

排查接入时，同一个 client 提供 `auth.status()` 和 `aiConfig.get()`。它们只读取当前状态，不能代替一次实际生成。其他环境问题见[排错指南](/zh/start/troubleshooting)。

## 确认结果

运行 App 仓库已有的检查，再在实际受管窗口中通过它自己的 client 完成一次请求。分别确认等待、成功和实际遇到的失败。成功返回一句问候，可以证明首次能力调用已经完成，不能据此宣称完整产品旅程或公开分发已就绪。

第三方 App 不需要把 Nimi 主仓的 SDK／Lab 全量测试复制成先修步骤；应使用该项目实际声明的 scripts。

## 来源依据

- [`app-tools/templates/default-starter/src/shell/auth/local-app-client.ts`](https://github.com/nimiplatform/nimi/blob/main/app-tools/templates/default-starter/src/shell/auth/local-app-client.ts)
- [`sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts`](https://github.com/nimiplatform/nimi/blob/main/sdks/typescript/core/app/local-app-runtime-platform-ai-config.ts)
- [`kit/shell/renderer/src/bridge/local-app.ts`](https://github.com/nimiplatform/nimi/blob/main/kit/shell/renderer/src/bridge/local-app.ts)
- [`.nimi/spec/sdks/feature-clients.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/sdks/feature-clients.authority.yaml)
