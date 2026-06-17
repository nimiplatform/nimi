# 已废止的 Truth 指针

Realm 不再通过独立 truth 层定义世界或 persona 权威。当前权威是核心数据层：

- `WorldCore`
- `WorldCharacterCore`
- `RealmPersona`
- `RuntimeSourceSnapshot`
- `WorldCoreIngressPackage`
- `CorePatch`

Creator 工具和 Forge 必须直接创建或 patch 这些 core 对象。未来如果需要抽象
rule/truth，也必须从 core 数据模型反向派生，不能成为第二套世界/persona 真相。
