# CLI 命令参考

`nimi` CLI 所有面向用户的命令完整参考。命令按类别组织。

---

## 运行时生命周期

### `nimi start`

在后台启动运行时守护进程。

```bash
nimi start
```

守护进程默认在 `127.0.0.1:46371` 上监听 gRPC 连接，终端会话结束后仍保持运行。

### `nimi serve`

在前台启动运行时，日志实时输出到 stdout。

```bash
nimi serve
```

适用于调试。按 `Ctrl+C` 停止。

### `nimi stop`

停止正在运行的守护进程。

```bash
nimi stop
```

### `nimi status`

检查守护进程是否存活且可连接。

```bash
nimi status
```

报告进程状态和 gRPC 端点可达性。

### `nimi doctor`

运行完整的环境诊断。

```bash
nimi doctor
```

报告内容：

- CLI 版本
- 配置文件路径
- gRPC 守护进程健康状态
- 运行时模式
- 进程状态
- 本地引擎状态
- Provider 状态
- 已安装模型数量

获取机器可读输出：

```bash
nimi doctor --json
```

### `nimi health`

执行定向健康检查。

```bash
nimi health --source grpc
```

直接检查 gRPC 端点的可达性。

### `nimi version`

输出已安装的 CLI 版本。

```bash
nimi version
```

### `nimi logs`

查看运行时日志。

```bash
nimi logs --tail 100
```

显示运行时最近 100 行日志输出。

---

## 生成

### `nimi run`

根据提示词生成 AI 文本。

**本地生成（默认）：**

```bash
nimi run "What is Nimi?"
```

使用默认本地模型。如果模型未安装，Nimi 会提示你下载。

**一次性使用云端 Provider：**

```bash
nimi run "What is Nimi?" --provider gemini
```

将请求路由到指定的云端 Provider。如果 API key 缺失，Nimi 会提示你输入一次并保存。

**使用已保存的默认云端 Provider：**

```bash
nimi run "What is Nimi?" --cloud
```

使用通过 `nimi provider set ... --default` 保存的 Provider。

**自动下载缺失模型：**

```bash
nimi run "What is Nimi?" --yes
```

自动下载缺失的本地模型，无需确认提示。

---

## 模型管理

### `nimi model list`

列出所有已安装的本地模型。

```bash
nimi model list
```

获取机器可读输出：

```bash
nimi model list --json
```

### `nimi model pull`

下载指定模型。

```bash
nimi model pull --model-ref <ref>@latest
```

将 `<ref>` 替换为模型引用标识符。`@latest` 标签获取最新版本。

---

## Provider 管理

### `nimi provider list`

列出所有已配置的云端 Provider 及其状态。

```bash
nimi provider list
```

获取机器可读输出：

```bash
nimi provider list --json
```

### `nimi provider set`

配置云端 Provider 并可选择将其设为默认。

```bash
nimi provider set <provider> --api-key-env <ENV_VAR> --default
```

- `<provider>` -- Provider 名称（例如 `gemini`、`openai`、`anthropic`）
- `--api-key-env` -- 存放 API key 的环境变量名
- `--default` -- 将此 Provider 设为 `--cloud` 的默认值

### `nimi provider test`

测试已配置 Provider 的连接性和认证状态。

```bash
nimi provider test <provider>
```

发送一个轻量级请求来验证 Provider 是否可达以及 API key 是否有效。

---

## 另请参阅

- [用户快速入门](index.md) -- 快速上手
- [云端 Provider 配置](providers.md) -- 详细的 Provider 配置说明
- [模型管理](models.md) -- 下载和管理模型
- [故障排除](troubleshooting.md) -- 常见错误及修复方法
