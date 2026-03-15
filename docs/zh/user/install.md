# 安装指南

::: tip Early Access
Nimi 目前处于 Early Access 阶段。核心功能已可使用，但 API 在版本迭代中可能调整。
:::

## 下载桌面应用

桌面应用是开始使用 Nimi 的最快方式。

| 平台 | 状态 |
|---|---|
| macOS (Apple Silicon) | 已发布 — [下载](https://nimi.xyz/download) |
| macOS (Intel) | 已发布 — [下载](https://nimi.xyz/download) |
| Windows | 即将推出 |
| Linux | CLI + SDK 可用（见下文） |

如果你偏好命令行或使用 Linux，请使用下方的 CLI 安装方式。

## 系统要求

- **操作系统**：macOS（Apple Silicon 或 Intel）或 Linux（x86_64、arm64）
- **磁盘空间**：至少 2 GB 可用空间，用于运行时和基础本地模型
- **网络**：初次安装和使用云端 Provider 时需要网络连接；模型下载完成后，本地生成可离线运行

## 安装方式

### curl 脚本（推荐）

```bash
curl -fsSL https://install.nimi.xyz | sh
```

该脚本会自动检测你的操作系统和架构，下载对应的二进制文件并将其添加到 PATH 中。

### npm 全局安装

```bash
npm install -g @nimiplatform/nimi
```

需要 Node.js 18 或更高版本。

## 验证安装

```bash
nimi version
```

该命令会输出已安装的 CLI 版本。

运行完整的环境检查：

```bash
nimi doctor
```

`nimi doctor` 会报告以下信息：

- CLI 版本
- 配置文件路径
- gRPC 守护进程健康状态
- 运行时模式与进程状态
- 本地引擎状态
- Provider 状态
- 已安装模型数量

## 启动运行时

### 后台模式（默认）

```bash
nimi start
```

在后台启动运行时守护进程，并将控制权返回给终端。运行时默认在 `127.0.0.1:46371` 上监听 gRPC 连接。

### 前台模式

```bash
nimi serve
```

在前台启动运行时，日志实时输出到 stdout。适用于调试或实时查看运行时活动。按 `Ctrl+C` 停止。

### 验证运行时是否已启动

```bash
nimi status
```

确认守护进程是否存活且可连接。

## 默认端点

运行时暴露的 gRPC 端点为：

```
127.0.0.1:46371
```

所有 CLI 命令和 SDK 客户端默认连接此端点。

## 更新 Nimi

### curl 脚本

重新运行安装脚本即可。它会用最新版本替换现有的二进制文件：

```bash
curl -fsSL https://install.nimi.xyz | sh
```

### npm

```bash
npm update -g @nimiplatform/nimi
```

更新后，重启运行时以应用更改：

```bash
nimi stop
nimi start
```

## 卸载

### curl 脚本安装

从 PATH 中删除二进制文件。默认位置取决于你的系统，安装脚本在安装过程中会输出路径。常见位置：

```bash
rm /usr/local/bin/nimi
```

删除配置目录：

```bash
rm -rf ~/.nimi
```

### npm 安装

```bash
npm uninstall -g @nimiplatform/nimi
```

删除配置目录：

```bash
rm -rf ~/.nimi
```

## 下一步

- [用户快速入门](index.md) -- 五分钟完成首次生成
- [CLI 命令参考](cli.md) -- 完整命令列表
- [故障排除](troubleshooting.md) -- 常见安装问题
