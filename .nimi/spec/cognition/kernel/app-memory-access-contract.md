# Cognition App Memory Access Contract

> Owner Domain: `C-APMEM-*`

## Scope

本契约定义第三方 Nimi App 访问 Cognition memory、knowledge 与 skill 的产品级
权限边界。它不接管 Cognition 既有服务真相，也不把 app 自己的 SQLite、缓存、
对话记录或知识库变成 Nimi 权限。

当前第三方公共权限全部处于 `reserved`；因此下述正向能力尚未准入，所有受保护
端点必须返回 typed `unavailable` 或 deny。未来准入必须遵守 Platform
`P-PERM-017` 的原子 admission 要求。

## C-APMEM-001 Cognition Owns Protected Memory Policy

Cognition 是 Nimi-owned memory、knowledge 与 skill 资源选择器和资源策略的唯一
owner。Runtime 只负责调用方 principal/session/account 绑定、Runtime-owned 权限
决策和端点前置校验；Realm 只负责 Realm-owned 数据与云端策略。Desktop、SDK、
Kit、app host 与 renderer 都不能自创平行策略。

App 自己创建并维护的数据属于 `app_owned_authority`，不经过 Cognition，也不得
创建 Nimi permission row。只有读取或修改 Nimi/Cognition 拥有的资源时，才进入
本契约。

## C-APMEM-002 Public Permission Mapping

第三方产品表面只能使用以下公共 permission id：

- `memory.read`
- `memory.write`
- `knowledge.read`
- `knowledge.write`

Skill 执行尚无已准入的第三方公共 permission id，因此不得通过开放字符串、
内部 operation id 或现有 memory/knowledge 权限推导。新增 skill 权限必须先修改
Platform 公共 catalog 并完成独立 admission。

公共 permission id 不等于 endpoint、table、collection id 或内部 policy enum。
Cognition 可以把一个用户意图展开为精确内部检查，但这些检查不得泄露到 manifest、
SDK 请求或用户审批 UI。

## C-APMEM-003 Owner-Selected Resource Boundary

未来正向准入时，Cognition owner picker 产生 bounded selector：

- `memory.read`：用户选择的 memory collection 与时间范围；
- `memory.write`：用户选择的可写 memory collection；
- `knowledge.read`：用户选择的 knowledge base；
- `knowledge.write`：用户选择的可写 knowledge base。

Selector 及其 digest 由 owner 生成，app 不能提交 resource id 作为权限证据。每个
端点必须重新验证当前 decision、selector、resource ownership、account、principal、
session、revision 与 endpoint policy；缺失、过期、撤销或不匹配均 fail-close。

## C-APMEM-004 No Implicit Projection Or Write

聊天 transcript、prompt context、缓存、background job、replay 或 display path 不得
隐式生成 Nimi memory/knowledge truth。写入必须经过相应已准入的 write permission、
owner-selected target、typed audit reason 与 Cognition 原子写入。

读取权限不能推导写入权限，write 也不能自动扩展到其他 collection、persona、
knowledge base 或 account。Batch、retry 与异步任务必须继承同一 bounded decision，
不能扩大 selector。

## C-APMEM-005 Conversation-Derived Memory

将 app conversation 转换为 Nimi memory 时，必须同时满足：

- 已准入且当前有效的 `memory.write` decision；
- Cognition owner-selected collection；
- Runtime-derived calling app principal 与 account；
- canonical conversation anchor 与 persona relation；
- typed audit event。

`app_id` 仅可作为显示 metadata，不能作为 owner、selector 或正向授权 key。没有
上述完整事实时，不得由后台任务或缓存补写。

## C-APMEM-006 Local App Principal Is Only A Caller Subject

`local_app_principal_id` 只用于 caller、access-control 与 audit subject。Cognition
必须从 RuntimeAgent/Cognition canonical relations 解析 agent、persona、conversation、
memory collection 与 knowledge base owner，禁止从以下信息推导资源所有权或权限：

- display `app_id`；
- project path 或 package path；
- process id；
- local-app record；
- permission decision 本身；
- app-local cache 或 SQLite。

有效 session、Developer Mode、项目启动批准、publisher tier、bundled identity 或
first-party binding 都不能替代当前受保护资源 decision。

## C-APMEM-007 First-Party And Third-Party Separation

Bundled first-party 产品只能使用各自已准入的 service entitlement。第三方开发版
Zhiyu 是独立 local-development principal，不能继承 shipped Zhiyu 的 agent、memory、
knowledge 或 service entitlement。First-party entitlement 不写入第三方 permission
ledger，也不能作为第三方正向 fallback。

## C-APMEM-008 Audit And Revocation

未来 admitted decision 的创建、拒绝、过期、撤销和每次写操作必须产生 owner audit。
Account switch、principal tombstone、selector/resource policy 变化或 decision revoke
必须使后续端点调用立即失败。App 只看到公共 posture，不得读取 decision id、selector
digest、内部 operation/resource identity 或其他 app 的状态。

## C-APMEM-009 Current Admission Posture

当前 `memory.read`、`memory.write`、`knowledge.read`、`knowledge.write` 均为
`reserved`，没有第三方正向 mutation/read path。Catalog 条目、manifest 声明、mock
approval 或单独 CRUD endpoint 都不能宣称 admission 完成。

## Fact Sources

- `.nimi/spec/platform/kernel/app-permission-contract.md` — `P-PERM-*`
- `.nimi/spec/platform/kernel/tables/nimi-app-permission-catalog.yaml`
- `.nimi/spec/runtime/kernel/grant-service.md` — Runtime owner-internal decision boundary
- `.nimi/spec/runtime/kernel/runtime-agent-service-contract.md` — RuntimeAgent relations
- `.nimi/spec/cognition/kernel/memory-service-contract.md` — memory owner truth
- `.nimi/spec/cognition/kernel/knowledge-service-contract.md` — knowledge owner truth
- `.nimi/spec/cognition/kernel/skill-service-contract.md` — skill owner truth
- `.nimi/spec/sdks/kernel/nimi-permission-client-contract.md` — public SDK projection
