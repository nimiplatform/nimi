# 实用配方

这些配方与 Nimi 随附的可运行示例直接对应。

运行 SDK 配方之前，请先启动 runtime：

```bash
nimi start
```

如果你希望 runtime 在前台运行并直接输出日志，可以改用 `nimi serve`。

只有当你直接执行 TypeScript 示例文件时才需要 Node.js。

## 核心配方

- SDK 快速入门：`examples/sdk/01-hello.ts`
- 流式输出：`examples/sdk/02-streaming.ts`
- 本地与云端切换：`examples/sdk/03-local-vs-cloud.ts`
- AI Provider 桥接：`examples/sdk/04-vercel-ai-sdk.ts`
- 多模态 runtime 路径：`examples/sdk/05-multimodal.ts`
- App 认证生命周期：`examples/sdk/advanced/app-auth.ts`
- 工作流 DAG：`examples/sdk/advanced/workflow.ts`
- 知识库索引与搜索：`examples/sdk/advanced/knowledge.ts`
- Mod 基线（`createHookClient` + `createModRuntimeClient`）：`examples/mods/mod-basic.ts`
- Runtime CLI 路径：`examples/runtime/cli-quickstart.sh`

`examples/sdk/05-multimodal.ts` 是在同一 runtime 接口上体验图像生成和 TTS 的最快方式。

![Nimi 多模态演示](../../assets/nimi-multimodal.gif)

## 运行

```bash
npx tsx examples/sdk/01-hello.ts
nimi run "Hello from Nimi"
nimi run "Hello from Nimi" --provider gemini
```

## 编译检查

```bash
pnpm --filter @nimiplatform/examples run check
```
