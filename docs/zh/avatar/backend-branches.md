# 后端分支

Avatar 的后端是一个封闭联合，且只包含
`live2d | vrm | nimi2d`。Avatar 自己的唯一分支工厂负责验证模型，并穷举
选择对应后端。视觉包或第三方 App 不能在运行时注册其他渲染器。

## 共同分支接口

每个分支都提供相同的后端无关结构：

| 接口 | 用途 |
| --- | --- |
| `kind` | 已验证的 `live2d`、`vrm` 或 `nimi2d` 判别字段 |
| `nominalBounds` | 正数逻辑尺寸与归一化身体中心 |
| `projection` | 活动、情绪、动作、表情与重置操作 |
| `surface` | Avatar 管理的渲染组件 |
| `metadata()` | 分支内部诊断信息 |
| `shutdown()` | 释放渲染、音频与呈现资源 |

载体只使用这组共同接口。后端元数据不会变成跨后端产品事实，渲染器标识也不
会穿过后端无关接口。

## Live2D

Live2D 分支加载并验证 Cubism 模型，在 Avatar 界面完成渲染，计算范围受限的
命中区域，并消费本地音频以驱动口型。只有 Live2D 分支提供本地
`setParameter` 扩展。Avatar 自己的呈现转换代码必须先确认分支类型，才能
调用该扩展。

## VRM

VRM 分支加载通过验证的 VRM 模型及其类型化能力配置。能力配置记录人形骨骼、
表情、注视支持、姿态限制和可用的确定性动作路由。缺失骨骼或表情时，对应
路由会明确失败，不会伪装成功。

VRM 是当前已支持的 Avatar 后端分支，不是未来占位，也不是面向第三方的公开
驱动接口。

## Nimi2D

Nimi2D 分支加载经过摘要验证的 Nimi2D 包及其能力配置，创建 Nimi2D
composer，并渲染准入后的图层计划。能力配置决定表情、语音嘴部、待机生命感
和手势动作通道是否可用。

Nimi2D 包内部语义仍归 Nimi2D 管理。Avatar 只消费验证后的包与能力配置，
不会重新定义它们的结构或内容治理含义。

## 后端无关的呈现路径

Runtime 的呈现结果以类型化语义输入进入 Avatar。Avatar 先保持其含义，再由
当前分支转换成渲染器本地操作：

| 语义输入 | 分支操作示例 |
| --- | --- |
| 活动或动作 | Live2D 动作组、VRM 确定性路由或 Nimi2D 动作通道 |
| 情绪或表情 | Live2D 参数/表情栈、VRM 表情管理器或 Nimi2D 表情通道 |
| 语音 | 分支音频消费者与渲染器本地嘴部权重 |
| 界面边界 | 分支逻辑边界与命中区域协议 |

重置与关闭只清除 Avatar 管理的本地状态，不会改变 Runtime 的呈现、连续性、
参与关系或来源关系。

## 场景：选择后端分支

1. Runtime 授权一个视觉包。
2. 通过验证的原生宿主在受保护的数据根目录下完成物化。
3. Avatar 验证模型清单。
4. 唯一分支工厂选择 `live2d`、`vrm` 或 `nimi2d`。
5. 类型未知、能力配置不完整或边界无效时，载体保持非就绪状态。

增加第四种后端需要明确的产品决策和完整的类型化实现；系统不会使用占位分支
或插件回退。

## 来源依据

- [`.nimi/spec/avatar/embodiment-surface.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/avatar/embodiment-surface.authority.yaml)
- [`.nimi/spec/nimi2d/asset-package.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/nimi2d/asset-package.authority.yaml)
