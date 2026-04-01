# Device Profile Contract

> Owner Domain: `K-DEV-*`

## K-DEV-001 设备画像结构

设备画像（`LocalDeviceProfile`）包含以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `os` | string | 操作系统标识（`linux`/`darwin`/`windows`） |
| `arch` | string | CPU 架构（`amd64`/`arm64`） |
| `total_ram_bytes` | int64 | 主机总内存（字节） |
| `available_ram_bytes` | int64 | 主机当前可用内存（字节） |
| `gpu` | `LocalGpuProfile` | GPU 信息（available/vendor/model/VRAM/memory_model） |
| `python` | `LocalPythonProfile` | Python 运行时（available/version） |
| `npu` | `LocalNpuProfile` | NPU 信息（available/ready/vendor/runtime/detail） |
| `disk_free_bytes` | int64 | 可用磁盘空间（字节） |
| `ports` | `[]LocalPortAvailability` | 端口可用性列表 |

`CollectDeviceProfile` RPC 返回当前设备的完整画像快照。

`LocalGpuProfile` 追加以下字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `total_vram_bytes` | int64? | GPU 总显存（字节）；无法可靠探测时为空 |
| `available_vram_bytes` | int64? | GPU 当前可用显存（字节）；无法可靠探测时为空 |
| `memory_model` | enum | `discrete | unified | unknown` |

## K-DEV-002 GPU 检测策略

GPU 检测按以下优先级执行（首个成功即返回）：

1. NVIDIA 命令行探测：`nvidia-smi --query-gpu=name,memory.total,memory.free --format=csv,noheader,nounits` 成功
   - `available=true`
   - `vendor=nvidia`
   - `memory_model=discrete`
   - `model/total_vram_bytes/available_vram_bytes` 按返回值填充
2. Apple Silicon / unified memory 主机：
   - `vendor=apple`
   - `memory_model=unified`
   - `total_vram_bytes/available_vram_bytes` 允许复用 host RAM 指标
3. 以上均未命中：
   - `available=false`
   - `memory_model=unknown`
   - `total_vram_bytes/available_vram_bytes` 为空

## K-DEV-003 GPU 检测覆盖范围

Phase 1 的显存探测以 NVIDIA `nvidia-smi` 与 Apple unified memory 为主。以下供应商/运行时仍标记为 deferred：

- AMD（ROCm）
- Intel（oneAPI）

当 host 无法可靠给出 VRAM/unified memory 数值时，`CollectDeviceProfile` 不得报错；调用方必须将此视为“低置信度硬件画像”，而不是缺省为 0。

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

> **触发点枚举**：daemon 不主动周期性采集。画像仅在以下时机刷新：(1) `CollectDeviceProfile` RPC，(2) `ResolveModelInstallPlan`/`ResolveProfile` 执行面归一化流程内，(3) `StartLocalAsset`/`StartLocalService` 流程内（`K-DEV-009`）。

未来可按需引入 TTL 缓存（不超过 60 秒），但必须保证以下场景强制刷新：

- `ResolveModelInstallPlan` 调用时
- `ResolveProfile` 调用时
- 用户显式请求设备画像时

推荐、profile requirement 展示与 install preflight 必须共享同一份 `LocalDeviceProfile` 真相源，不得为 recommendation 额外维护第二套私有硬件探测。

## K-DEV-009 运行时设备画像重校验

`StartLocalAsset` / `StartLocalService` 在执行启动流程前，必须重新采集设备画像并校验硬件兼容性（复用 `K-DEV-007` 规则）：

- 不通过时返回 warning（附加在响应中），但不阻断启动流程（Phase 1）。
- Phase 2 可升级为阻断策略（需新增配置开关）。
