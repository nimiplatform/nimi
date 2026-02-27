# SDK vNext 用户视角接口重构方案（Runtime + Realm Only, No Legacy）

- 日期：2026-02-27
- 文档类型：implementation plan（最终态方案）
- 目标：在不考虑兼容成本前提下，给出最清晰、最可维护的 SDK 接口。
- 核心决策：SDK 只提供两个一等客户端：`Runtime` 和 `Realm`。不提供 `NimiApp` 聚合层。

## 1. 核心判断

你提的方向成立：

```ts
import { Runtime, Realm } from '@nimiplatform/sdk';

const runtime = new Runtime(...);
const realm = new Realm(...);
```

这是更优抽象，因为：

1. 语义真实：两个系统就是独立系统，不伪装成一个“超级客户端”。
2. 配置清晰：每个客户端只接收自己域配置，没有“可选但至少一项”的歧义。
3. 生命周期真实：本地 runtime server 和远端 realm server 的连接策略本来就应独立。
4. 授权真实：`realm auth` 与 `runtime appAuth/scope` 是不同问题，应该分开。

## 2. vNext 总体形态

两层模型：

1. SDK 基础层：`Runtime` + `Realm`。
2. 应用编排层：业务代码自行编排两个客户端（或自建 helper），不内置 SDK 聚合类。

## 3. 用户接入体验

### 3.1 仅 runtime

```ts
import { Runtime } from '@nimiplatform/sdk';

const runtime = new Runtime({
  appId: 'app.acme.writer',
  transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
  connection: { mode: 'auto' },
});

await runtime.connect(); // 可选预热；未调用时首次请求自动建连
const out = await runtime.ai.text.generate({
  model: 'localai/qwen2.5',
  input: 'Write a short intro.',
});
await runtime.close();
```

### 3.2 仅 realm

```ts
import { Realm } from '@nimiplatform/sdk';

const realm = new Realm({
  baseUrl: 'https://realm.nimi.world',
  auth: { accessToken: 'token_xxx' },
});

const me = await realm.users.me();
```

### 3.3 runtime + realm（应用自行编排）

```ts
import { Runtime, Realm } from '@nimiplatform/sdk';

const runtime = new Runtime({
  appId: 'app.acme.writer',
  transport: { type: 'tauri-ipc' },
});
const realm = new Realm({ baseUrl: 'https://realm.nimi.world' });

await Promise.all([runtime.connect(), realm.connect()]);

// 未来若 runtime 需要 realm 侧授信材料：
const grant = await realm.raw.request<{ token: string }>({
  method: 'POST',
  path: '/api/creator/mods/control/grants/issue',
  body: { appId: 'app.acme.writer' },
});

const text = await runtime.ai.text.generate({
  model: 'litellm/gpt-4o-mini',
  input: 'hello',
  metadata: {
    realmGrantToken: grant.token,
  },
});
```

## 4. API 设计规则

## 4.1 Runtime 规则

1. `RuntimeOptions` 只包含 runtime 配置。
2. `Runtime` 生命周期：默认 `auto connect` + 可显式 `connect/ready/close`。
3. `Runtime` 内聚合 `auth/appAuth/ai/media/workflow/model/localRuntime/knowledge/app/audit/scope/raw`。
4. 不暴露 generated 深层路径作为主调用方式。

## 4.2 Realm 规则

1. `RealmOptions` 只包含 realm 配置。
2. `Realm` 不依赖 runtime。
3. `Realm` 配置必须实例隔离，禁止全局单例写入（禁 `OpenAPI` 全局污染）。

## 4.3 跨域编排规则

1. SDK 不提供 `NimiApp` 聚合类。
2. 跨域流程由业务方显式编排（先 `realm.getXxx` 再 `runtime.xxx`）。
3. SDK 只提供必要 helper type，不提供隐藏状态机。
4. 若后续沉淀复用流程，优先以“纯函数 helper”形态提供，不引入第三客户端对象。

## 4.4 互相取数的显式调用范式（固定模板）

### 范式 A：Realm -> Runtime（最常见）

场景：runtime 调用需要 realm 下发授信材料（grant/token/policy 快照）。

```ts
const grant = await realm.raw.request<{ token: string; version: string }>({
  method: 'POST',
  path: '/api/creator/mods/control/grants/issue',
  body: {
    appId,
    subjectUserId,
    scopes,
  },
});

const result = await runtime.ai.text.generate({
  model,
  input,
  metadata: {
    realmGrantToken: grant.token,
    realmGrantVersion: grant.version,
  },
});
```

约束：

1. Realm 返回值原样进入 Runtime 入参，不做隐式缓存魔改。
2. 必须在 Runtime 调用元数据中带上 `grantVersion`，便于审计与回放。
3. Realm 失败和 Runtime 失败分开上报，禁止吞并错误源。

### 范式 B：Runtime -> Realm

场景：runtime 产物需要落回 realm（帖子/世界状态/通知）。

```ts
const media = await runtime.media.video.generate({...});

await realm.posts.create({
  content: '...',
  attachments: media.artifacts.map((a) => ({ uri: a.uri, mimeType: a.mimeType })),
  traceId: media.trace.traceId,
});
```

约束：

1. 回写必须携带 runtime `traceId`，建立跨系统链路。
2. Runtime 成功 + Realm 失败必须显式补偿（重试队列/死信），不能默默丢失。

### 范式 C：双向预检

场景：执行前需同时满足 realm 权限 + runtime 健康。

```ts
const [policy, health] = await Promise.all([
  realm.raw.request<{ allowed: boolean }>({
    method: 'POST',
    path: '/api/auth/policy/check',
    body: { appId, subjectUserId, action: 'ai.generate' },
  }),
  runtime.health(),
]);

if (!policy.allowed) throw new Error('AUTH_DENIED');
if (health.status !== 'healthy') throw new Error('RUNTIME_UNAVAILABLE');
```

约束：

1. 预检结果只用于当前请求，不作为全局状态长期缓存。
2. 授权与健康判断必须带时间戳并落审计事件。

### 范式 D：生命周期独立 + 数据桥接

场景：同时使用 `runtime` 与 `realm`，但连接状态与鉴权逻辑完全不同。

```ts
await runtime.connect();
await runtime.ready();

await realm.connect();
await realm.ready();

const grant = await realm.raw.request<{ token: string; version: string }>({
  method: 'POST',
  path: '/api/creator/mods/control/grants/issue',
  body: { appId, subjectUserId, scopes },
});
const output = await runtime.ai.text.generate({
  model,
  input,
  metadata: { realmGrantToken: grant.token, realmGrantVersion: grant.version },
});
await realm.posts.create({ content: output.text, traceId: output.trace.traceId });

await runtime.close();
await realm.close();
```

约束：

1. `connect/ready/close` 由 `Runtime`、`Realm` 各自负责，禁止互相代理生命周期。
2. Realm 授权材料只通过显式参数传入 Runtime，不允许 Runtime 隐式读取 Realm 内部状态。
3. Runtime 产物回写 Realm 必须显式带 `traceId`，建立可审计链路。
4. 跨域流程由应用层函数编排（use-case orchestration），SDK 不内建隐藏状态机。

## 5. 错误与事件模型

统一错误对象：

```ts
class NimiError extends Error {
  code: NimiErrorCode;
  reasonCode: string;
  actionHint: string;
  source: 'sdk' | 'runtime' | 'realm';
  traceId?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}
```

统一事件：

1. `runtime.connected`
2. `runtime.disconnected`
3. `ai.route.decision`
4. `media.job.status`
5. `auth.token.issued`
6. `error`

关键规则：取消必须是独立错误码（`OPERATION_ABORTED`），不得映射为 timeout。

## 6. Breaking 策略（一次性）

1. 删除 `createNimiClient`。
2. 删除“单入口混合 runtime/realm 配置”的模型。
3. 删除 `realm.OpenAPI` 全局写入依赖。
4. 删除所有兼容壳与 deprecated 旧入口。
5. 文档示例统一为 `new Runtime()` / `new Realm()`。

## 7. 交付切片

### Slice A：Runtime 客户端定型

1. 落地 `Runtime` 类。
2. 落地生命周期和模块分层。
3. 完成 runtime-only smoke。

### Slice B：Realm 客户端定型

1. 落地 `Realm` 类。
2. 完成实例级配置隔离。
3. 完成 realm-only smoke。

### Slice C：跨域编排范式

1. 提供官方“应用编排 recipe”（代码模板，不是客户端对象）。
2. 提供 helper types（如 `RuntimeAuthMaterial`）。
3. 完成 runtime+realm 场景 E2E。

### Slice D：文档与门禁切换

1. 重写 README/docs。
2. CI 增加 `no-createNimiClient`、`no-global-openapi-config`。
3. 旧 API 路径 hard fail。

## 8. 验收标准

1. API 不再出现“可选字段 + 至少一项”约束。
2. Runtime-only 和 Realm-only 都可独立接入。
3. 跨域场景通过显式编排实现，可读、可测、可审计。
4. SDK 中不存在全局配置污染。
