# Runtime 参考

Nimi Runtime 是应用和桌面端使用的本地 AI 执行守护进程。

## 启动命令

```bash
nimi start
```

## 运维命令

```bash
nimi doctor
nimi status
nimi health --source grpc
nimi logs --tail 100
nimi stop
nimi version
nimi model list --json
nimi provider list --json
nimi run "Hello from Nimi"
nimi run "Hello from Nimi" --provider gemini
nimi run "Hello from Nimi" --cloud
```

需要直接查看 daemon 日志时，可使用前台模式：

```bash
nimi serve
```

## 源码开发入口

如果你是从源码开发 Nimi，而非使用已发布的二进制文件：

```bash
cd runtime
go run ./cmd/nimi serve
```

## 健康检查端点

- `GET /livez`
- `GET /readyz`
- `GET /v1/runtime/health`

## 源码参考

- Runtime 实现说明：[`runtime/README.md`](../../../runtime/README.md)
- Runtime 规范领域文档：[`spec/runtime`](../../../spec/runtime)
- Runtime 内核契约：[`spec/runtime/kernel`](../../../spec/runtime/kernel)
