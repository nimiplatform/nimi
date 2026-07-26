# 运行时配置

> 状态：当前生效。Active authority 位于
> `.nimi/spec/runtime/protected-session.authority.yaml` 与
> `.nimi/spec/runtime/service-operations.authority.yaml`。

Runtime 配置与 Product Control 是两个不同平面：

- `~/.nimi/nimi.json` 是固定的 Product Control 记录，也是
  `dataRoot.path` 唯一的产品发现 authority。
- Windows 上的 `%ProgramData%\Nimi\Runtime\Protected` 保存服务主体私有的
  状态、配置、凭据、会话、审计和 data-root 验证证据。
- Protected Runtime 只能保存与 Product Control 选择绑定的派生状态，不能选择
  或覆盖 `dataRoot.path`；两者不一致时必须 fail-closed 并进入 repair。

## 生产环境

生产 Runtime 不发现用户可写的 portable config。其私有配置位置由已安装的
protected service 固定，不允许用户配置，也不作为普通物理路径对外展示。

数据平面始终从 Product Control 读取，并只派生：

```text
<dataRoot>/models
<dataRoot>/dependencies
<dataRoot>/environments
<dataRoot>/apps
<dataRoot>/accounts
<dataRoot>/logs
<dataRoot>/audit
```

环境变量、argv、Desktop 状态、测试和 protected Runtime 状态都不能提供另一份
产品 data root。

## 显式 nonproduction portable 模式

`NIMI_RUNTIME_CONFIG_PATH` 仅是显式 nonproduction portable 配置入口，不存在
默认 portable config 路径。`~/.nimi/runtime/config.json` 与
`~/.nimi/config.json` 均已退役，不是发现或迁移输入。

Portable 配置：

- 必须使用当前 schema，内容无效时 fail-closed；
- 可以配置 nonproduction Runtime 行为与 provider setup；
- 不得包含 `dataRootRef` 或任何 `managedRoots` 值；
- 不得成为 Product Control 或生产 Runtime 私有状态；
- 只有显式提供时，`nimi doctor` 或 `nimi version` 才能以
  nonproduction 标签报告该入口。

`nimi provider set`、`unset` 或交互式 setup 的 provider mutation 仅在显式
提供这一 nonproduction 路径时可用。生产凭据和配置继续由 protected service
保管。

## 验证与写入

配置验证 fail-closed，不接受部分成功。服务私有写入与显式 portable 写入均使用
原子替换。每个字段的 reload 行为必须单独声明；未声明的字段不得被推断为可热重载。

## Runtime 配置不做的事情

- 不定位或选择 `dataRoot.path`。
- 不从 ProgramData 读取 Product Control。
- 不默认读取 `~/.nimi/runtime` 下的配置文件。
- 不通过 `doctor`、`version`、Desktop、SDK 或 app surface 暴露生产私有配置路径。
- 不允许 portable config 覆盖 Product Control 或 protected Runtime 的派生
  data-root 验证状态。
