# Runtime 配置规范

Runtime 的基础配置与产品控制（Product Control）遵循严格的分层设计：

- `~/.nimi/nimi.json` 是产品控制的权威记录文件，定义数据根目录 `dataRoot.path` 的基准路径。
- 系统受保护区域（如 Windows 上的 `%ProgramData%\Nimi\Runtime\Protected`）保存服务内部凭据、会话状态与验证凭证。
- Runtime 严格遵循 Product Control 声明的存储根路径，确保平台各层级数据的一致性与安全性。

## 生产环境数据目录组织

在标准生产环境中，所有本地核心数据均统一组织在由 Product Control 声明的数据根目录下：

```text
<dataRoot>/models         # 本地 AI 模型权重文件与 GGUF 存储
<dataRoot>/dependencies   # 本地推理驱动及加速库依赖
<dataRoot>/environments   # 运行时受控执行环境
<dataRoot>/apps           # 安装的本地 Nimi App 程序包
<dataRoot>/accounts       # 本地用户账户与会话数据
<dataRoot>/logs           # 系统滚动服务日志
<dataRoot>/audit          # 本地安全审计账本（SQLite）
```

集中式目录布局杜绝了磁盘散落占用，方便统一备份、迁移与空间清理。

## 非生产可移植模式（Nonproduction Portable Mode）

在自动化测试或开发者隔离调试场景中，可通过环境变量 `NIMI_RUNTIME_CONFIG_PATH` 指定自定义配置文件：
- **格式严格校验**：自定义配置文件必须遵循最新的官方配置 Schema；
- **凭据隔离**：可移植配置仅用于配置本地端口与非敏感调试参数，第三方 API 凭据仍由受保护的本地存储安全保管。

## 配置的原子性写入与生效周期

- **原子更新**：配置文件的修改均采用临时写入后原子重命名的机制，避免因并发写入或异常断电导致文件损坏；
- **生效周期**：配置参数在服务启动时加载校验；配置调整在守护进程重启后生效。

## Source Basis

- [`.nimi/spec/runtime/protected-session.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/protected-session.authority.yaml)
- [`.nimi/spec/runtime/service-operations.authority.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/spec/runtime/service-operations.authority.yaml)
