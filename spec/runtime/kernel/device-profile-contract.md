# Device Profile Contract

> Owner Domain: `K-DEV-*`

## K-DEV-001 设备画像结构

设备画像（`LocalDeviceProfile`）包含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `os` | string | 操作系统标识（`linux`/`darwin`/`windows`） |
| `arch` | string | CPU 架构（`amd64`/`arm64`） |
| `gpu` | `LocalGpuProfile` | GPU 信息（available/vendor/model） |
| `python` | `LocalPythonProfile` | Python 运行时（available/version） |
| `npu` | `LocalNpuProfile` | NPU 信息（available/ready/vendor/runtime/detail） |
| `disk_free_bytes` | int64 | 可用磁盘空间（字节） |
| `ports` | `[]LocalPortAvailability` | 端口可用性列表 |

`CollectDeviceProfile` RPC 返回当前设备的完整画像快照。

## K-DEV-002 GPU 检测策略

GPU 检测按以下优先级执行（首个成功即返回）：

1. 环境变量覆盖：`NIMI_GPU_AVAILABLE=true/false` → 直接采信。
2. 设备文件检测：`/dev/nvidia0` 存在 → `available=true, vendor=nvidia`。
3. 命令行探测：`nvidia-smi --query-gpu=name --format=csv,noheader` 成功 → `available=true, vendor=nvidia, model=<output>`。
4. 以上均未命中 → `available=false`。

## K-DEV-003 GPU 检测覆盖范围

Phase 1 仅检测 NVIDIA GPU。以下平台/供应商标记为 deferred：

- Apple Silicon（Metal/MPS）
- AMD（ROCm）
- Intel（oneAPI）

Phase 1 在 macOS/Apple Silicon 上 `gpu.available` 始终为 `false`（引擎通过 CPU 或 Metal 自行适配，不依赖 runtime GPU 检测）。

## K-DEV-004 NPU 检测策略

Phase 1 的 NPU 检测完全由环境变量驱动，不执行 OS 级硬件探测：

- `NIMI_NPU_AVAILABLE=true` → `available=true`
- `NIMI_NPU_READY=true` → `ready=true`（仅当 `available=true`）
- `NIMI_NPU_VENDOR` → `vendor`
- `NIMI_NPU_RUNTIME` → `runtime`

所有环境变量缺失时：`available=false, ready=false`。

## K-DEV-005 Python 运行时检测

Python 检测按以下顺序尝试：

1. `python3 --version` → 解析版本号。
2. `python --version` → 解析版本号（fallback）。
3. 以上均失败 → `available=false`。

成功时 `available=true, version=<major>.<minor>.<patch>`。

## K-DEV-006 端口可用性探测

端口空闲判定使用 `net.Listen("tcp", ":<port>")` 尝试绑定：

- 绑定成功（立即释放）→ `available=true`
- 绑定失败（`EADDRINUSE` 或其他）→ `available=false`

`CollectDeviceProfile` 默认探测端口列表：引擎默认端口（`K-LENG-005` 中各引擎的默认端口）。调用方可通过请求参数指定额外端口。

## K-DEV-007 硬件-引擎兼容性判定

安装计划解析（`ResolveModelInstallPlan`）根据以下规则生成 warnings：

| 引擎名特征 | 硬件要求 | 不满足时 warning |
|---|---|---|
| 包含 `cuda`/`nvidia`/`gpu` | `gpu.available=true` | `WARN_GPU_REQUIRED` |
| 包含 `python`/`py` | `python.available=true` | `WARN_PYTHON_REQUIRED` |
| 包含 `npu` | `npu.available=true && npu.ready=true` | `WARN_NPU_REQUIRED` |

warning 不阻止安装，仅在 `InstallPlanDescriptor.warnings` 中输出。

## K-DEV-008 设备画像缓存策略

Phase 1 不缓存设备画像：每次 `CollectDeviceProfile` 调用都实时采集所有字段。

> **触发点枚举**：daemon 不主动周期性采集。画像仅在以下时机刷新：(1) `CollectDeviceProfile` RPC，(2) `ResolveModelInstallPlan`/`ResolveDependencies` 流程内，(3) `StartLocalModel`/`StartLocalService` 流程内（`K-DEV-009`）。

未来可按需引入 TTL 缓存（不超过 60 秒），但必须保证以下场景强制刷新：

- `ResolveModelInstallPlan` 调用时
- `ResolveDependencies` 调用时
- 用户显式请求设备画像时

## K-DEV-009 运行时设备画像重校验

`StartLocalModel` / `StartLocalService` 在执行启动流程前，必须重新采集设备画像并校验硬件兼容性（复用 `K-DEV-007` 规则）：

- 不通过时返回 warning（附加在响应中），但不阻断启动流程（Phase 1）。
- Phase 2 可升级为阻断策略（需新增配置开关）。
