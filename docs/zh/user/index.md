# 用户快速入门

::: warning 极速开发阶段
Nimi 目前仍处于极速开发阶段。核心流程已可使用，但合约、CLI 行为与桌面端能力都可能在版本之间快速调整。涉及行为边界时请以 `spec/` 为准，并将 `spec/future/` 视为 backlog，而不是发布承诺。
:::

从零开始，五分钟内完成你的第一次 AI 生成。无需编写代码。

## 1. 安装 Nimi

```bash
# macOS / Linux
curl -fsSL https://install.nimi.xyz | sh

# 或通过 npm 安装
npm install -g @nimiplatform/nimi
```

## 2. 启动运行时

```bash
nimi start
```

此命令会在后台启动 Nimi 运行时守护进程。

## 3. 验证环境

```bash
nimi doctor
nimi status
```

`nimi doctor` 会执行完整的环境检查：CLI 版本、配置路径、gRPC 健康状态、运行时模式、进程状态、本地引擎状态、Provider 状态以及已安装模型数量。`nimi status` 用于确认守护进程可以正常连接。

## 4. 第一次本地生成

```bash
nimi run "What is Nimi?"
```

运行时默认使用本地模型。如果模型尚未安装，Nimi 会提示你下载。模型就绪后，文本会以流式方式输出到终端。

## 5. 第一次云端生成

使用云端 Provider 进行一次性生成：

```bash
nimi run "What is Nimi?" --provider gemini
```

如果 Provider 的 API key 缺失，Nimi 会提示你输入一次并保存到运行时配置中。

## 6. 保存默认云端 Provider

避免每次都传 `--provider` 参数：

```bash
nimi provider set gemini --api-key-env NIMI_RUNTIME_CLOUD_GEMINI_API_KEY --default
export NIMI_RUNTIME_CLOUD_GEMINI_API_KEY=YOUR_KEY
```

然后使用已保存的默认 Provider：

```bash
nimi run "What is Nimi?" --cloud
```

`--provider` 用于一次性指定 Provider。`--cloud` 用于使用已保存的默认 Provider。

## 快速入门演示

![Nimi 快速入门演示](../../assets/nimi-quickstart.gif)

安装 Nimi，启动运行时，然后通过 CLI 运行你的第一个本地或云端提示。

## 下一步

- [安装指南](install.md) -- 详细的安装选项、系统要求与更新方法
- [CLI 命令参考](cli.md) -- 所有可用命令的完整列表
- [云端 Provider 配置](providers.md) -- 配置和管理云端 Provider
- [模型管理](models.md) -- 下载、列出和管理本地模型
- [桌面应用指南](desktop.md) -- 用于 AI 交互的图形界面
- [故障排除](troubleshooting.md) -- 常见错误及解决方法
