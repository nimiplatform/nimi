# SDK Realm/Runtime Behavior Guide

## 1. ready() 语义差异
Anchors: S-RUNTIME-015, S-REALM-019

Runtime `ready()` 是 fail-close，Realm `ready()` 是 fail-open。调用方必须按子路径差异处理可用性判断。

## 2. 中断与重建策略
Anchors: S-RUNTIME-028, S-RUNTIME-045, S-REALM-036

Runtime 通道中断发 `runtime.disconnected`，重建由调用方决策；Realm 重连策略实现可变但不允许静默丢事件。

## 3. Token 刷新路径
Anchors: S-REALM-014, S-REALM-028, S-REALM-029

默认无自动刷新；配置 refreshToken 后进入 401 触发刷新，并使用 single-flight 合并并发刷新。

## 4. 测试门读取顺序
Anchors: S-GATE-020, S-GATE-070, S-GATE-091

先过边界/一致性，再过 provider 对齐，最后确认 docs drift 与 consistency 同时通过。
