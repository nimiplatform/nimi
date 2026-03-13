# 故障排除

## 常见错误

| 错误信息 | 含义 | 解决方法 |
|---|---|---|
| `runtime is not running` | Nimi 守护进程未启动或无法连接 | 运行 `nimi start` 启动守护进程 |
| `model ... is not installed` | 请求了本地生成，但所需模型未下载 | 使用 `--yes` 参数重新运行命令以自动下载，或手动执行 `nimi model pull --model-ref <ref>@latest` |
| `cloud credentials for <provider> are missing or invalid` | 请求的云端 Provider 的 API key 未配置或已被拒绝 | 使用 `--provider <provider>` 重新运行以输入 key，或通过 `nimi provider set <provider> --api-key-env <ENV_VAR> --default` 保存 |

---

## 运行时无法启动

### 端口冲突

运行时默认监听 `127.0.0.1:46371`。如果另一个进程占用了该端口，运行时将无法启动。

检查端口占用情况：

```bash
lsof -i :46371
```

停止冲突的进程或终止残留的 Nimi 实例，然后重试：

```bash
nimi start
```

### 已有实例在运行

如果之前的守护进程仍在运行，先停止它：

```bash
nimi stop
nimi start
```

### 权限问题

在某些系统上，Nimi 的二进制文件或数据目录可能缺少必要的权限。请确认二进制文件具有可执行权限，且 `~/.nimi/` 目录对当前用户可写。

### 前台调试

在前台启动运行时以直接查看日志输出：

```bash
nimi serve
```

日志会输出到 stdout，帮助你立即定位启动失败的原因。

---

## 模型下载失败

### 网络问题

模型下载需要稳定的网络连接。如果下载中途失败：

1. 检查网络连接
2. 重新运行下载命令：

```bash
nimi model pull --model-ref <ref>@latest
```

Nimi 会根据需要恢复或重新开始下载。

### 磁盘空间不足

本地模型可能有数 GB 大小。下载前请确认有足够的可用磁盘空间：

```bash
df -h ~
```

如有需要释放空间后重试下载。

### 重试失败的下载

直接重新运行下载命令即可：

```bash
nimi model pull --model-ref <ref>@latest
```

---

## Provider 认证错误

### API Key 错误

如果云端 Provider 返回认证错误，请验证 API key 是否正确。你可以通过运行一次性命令重新输入：

```bash
nimi run "test" --provider <provider>
```

如果已保存的 key 无效，Nimi 会提示你重新输入。

### Key 过期或已被撤销

API key 可能从 Provider 的管理面板中过期或被撤销。从 Provider 处生成新的 key，然后更新配置：

```bash
nimi provider set <provider> --api-key-env <ENV_VAR> --default
export <ENV_VAR>=YOUR_NEW_KEY
```

### 速率限制

云端 Provider 会实施速率限制。如果你收到速率限制错误：

- 等待几秒后重试
- 在 Provider 的管理面板中检查使用配额
- 考虑升级你在 Provider 处的订阅方案

### 测试 Provider 连接性

验证 Provider 是否可达且 key 是否有效：

```bash
nimi provider test <provider>
```

---

## 桌面应用问题

### 应用无法启动

- 确认你的操作系统满足系统要求
- 在 macOS 上，在"系统设置"的"隐私与安全性"中允许该应用
- 重新下载并安装应用

### 白屏

- 重启应用
- 删除 Nimi Desktop 缓存目录后重新启动
- 在 Linux 上，检查 GPU 驱动或 Wayland 兼容性问题

### Mod 加载错误

- 在运行时配置面板中禁用有问题的 Mod
- 检查 Mod 与当前 Nimi 版本的兼容性
- 从 Mod Hub 重新安装该 Mod
- 如果应用无响应，在终端中手动运行 `nimi start` 启动运行时，并使用 `nimi doctor` 验证环境

---

## 收集诊断信息

报告问题时，请收集以下诊断信息以协助调试。

### 完整环境报告

```bash
nimi doctor --json
```

生成机器可读的 JSON 报告，包含完整的环境信息：CLI 版本、配置路径、gRPC 健康状态、运行时模式、进程状态、引擎状态、Provider 状态和模型数量。

### 最近的运行时日志

```bash
nimi logs --tail 100
```

显示运行时最近 100 行日志输出。如需更多历史记录可增大行数。

### 运行时状态

```bash
nimi status
```

确认守护进程是否正在运行且 gRPC 端点是否可达。

---

## 获取帮助

如果本指南无法解决你的问题：

- **GitHub Issues**：在 [github.com/nimiplatform/nimi/issues](https://github.com/nimiplatform/nimi/issues) 提交 Bug 报告或功能请求
- **Discord 社区**：加入 Nimi Discord，获取其他用户和开发团队的实时帮助

提交 Issue 时，请附上 `nimi doctor --json` 的输出以及 `nimi logs --tail 100` 中的相关日志。

## 另请参阅

- [用户快速入门](index.md) -- 从头开始
- [安装指南](install.md) -- 安装与更新 Nimi
- [CLI 命令参考](cli.md) -- 所有可用命令
- [云端 Provider 配置](providers.md) -- Provider 配置详情
