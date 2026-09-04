# Carrier 视觉接受（Carrier Visual Acceptance）

**Carrier** 是渲染具身化（embodiment）的宿主表面，也就是 Agent 真正出现的地方。Carrier 视觉接受契约决定一份具身化能不能在某个 Carrier 上显示。"这个 Agent 能不能在这里出现"，由它说了算。

## Carrier 接受契约决定什么

| 判断 | 结果 |
| --- | --- |
| 具身化匹配 Carrier 的强类型契约 | 准入并渲染 |
| 具身化超出 Carrier 的契约 | 拒绝，或退回到一个准入的退化呈现 |
| 具身化结构非法 | 拒绝并返回强类型错误 |
| 具身化触犯 Carrier 策略 | 拒绝并返回强类型原因 |

Carrier **不会**默默渲染半个版本。契约说了算，结果只能是准入、退化呈现、拒绝三选一。

## 为什么由 Carrier 来决定

如果具身化可以在任何地方渲染，一份为桌面 Carrier 设计的高细节包，可能会把一台受限的移动 Carrier 拖垮；为某一种后端设计的包，可能会被尝试渲染到另一种后端上。

Carrier 视觉接受契约就是每个 Carrier 自己声明能承载什么。具身化要么匹配，要么不匹配；平台把这件事做成强类型的判断。

## 读者场景：在受限 Carrier 上加载一份重型具身化

用户安装了一份动作丰富的具身化包，想在受限的 Carrier 上查看（比如低功耗设备）。

1. **Carrier 声明自己的契约**：支持的后端、动作复杂度档位、资源大小上限。
2. **读取具身化包**：包内声明的需求条件。
3. **接受度评估**：Carrier 视觉接受契约做对比。
4. **判定为退化呈现**：完整的具身化超出 Carrier 的档位，契约决定退回到一个准入的退化呈现（例如静态或简化版本）。
5. **用户看到退化呈现**：附带强类型原因——"当前设备不支持这份具身化的完整动作档位"。

退化呈现是被准入的，不会有"半渲染"的意外。

## 读者场景：Carrier 拒收后端不匹配的具身化

具身化只支持 Live2D，Carrier 只支持 VRM。

1. **接受度评估**：Live2D 具身化对上 VRM-only 的 Carrier。
2. **拒收**：后端不匹配，不予准入。
3. **强类型错误**："当前 Carrier 不支持 Live2D 后端。"
4. **不做半渲染**：Carrier 不会尝试把 Live2D 套进 VRM 空间。

后端通过判别联合（discriminated union）来表达，使得这种不匹配在任何渲染尝试之前就能被识别出来。

## 读者场景：会话进行中具身化被更新

创作者在用户正在查看 Agent 的过程中，更新了具身化包。

1. **新具身化送达**：通过准入的更新通道。
2. **Carrier 重新评估**：接受度契约对新版本做核对。
3. **如准入**：Carrier 在准入的过渡契约范围内平滑切换。
4. **如未准入**：Carrier 保留旧版本，或进入 `degraded:embodiment-incompatible` 状态。
5. **用户看到状态**：要么是新具身化，要么是一个强类型的降级状态。

创作者的更新不会悄悄打断用户的会话。

## Acceptance 不做的事

| 关注点 | 不做的原因 |
| --- | --- |
| 决定身份 | Character 身份归 Realm，LocalAgent 执行身份归 Runtime；Carrier 只接受呈现 |
| 修改具身化包 | Carrier 是读方；包由创作者发布 |
| 在准入档位之外渲染 | 契约的上限是显式的 |

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
