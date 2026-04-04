# Video Food Map — Audit & Workflow Diagrams

> Generated 2026-04-04 | Based on current codebase + spec review

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     Renderer (React + Vite)                     │
│  App.tsx → SurfaceSwitcher → 5 Surfaces                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────┐ ┌─────────┐ │
│  │ Discover │ │NearbyMap │ │VideoMap  │ │Review │ │  Menu   │ │
│  │ (detail) │ │ (global) │ │(per-vid) │ │ Queue │ │(stage3) │ │
│  └──────────┘ └──────────┘ └──────────┘ └───────┘ └─────────┘ │
│        │                                     │                  │
│   ┌─────────────────────────────────────────────┐               │
│   │  bridge/invoke.ts → @tauri-apps/api/core    │               │
│   └──────────────────────┬──────────────────────┘               │
└──────────────────────────┼──────────────────────────────────────┘
                           │ Tauri IPC
┌──────────────────────────┼──────────────────────────────────────┐
│                    Tauri Backend (Rust)                          │
│  main.rs → 7 Tauri Commands                                    │
│  ┌────────────┐ ┌──────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ db.rs      │ │ db_queries.rs│ │ probe.rs   │ │settings.rs │ │
│  │ (SQLite)   │ │ (write logic)│ │ (geocode)  │ │ (JSON file)│ │
│  └────────────┘ └──────────────┘ └────────────┘ └────────────┘ │
│  ┌────────────────────┐  ┌───────────────┐  ┌────────────────┐  │
│  │ runtime_daemon.rs  │  │script_runner.rs│  │desktop_paths.rs│  │
│  │ (auto-start nimi)  │  │ (find tsx bin) │  │ (data dir)     │  │
│  └────────────────────┘  └───────────────┘  └────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ spawns tsx subprocess
┌──────────────────────────┼──────────────────────────────────────┐
│                    Probe Scripts (TypeScript)                    │
│  run-bilibili-food-video-probe.mts                              │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │ bilibili-food-video- │  │ bilibili-food-video-extraction   │ │
│  │ probe.mts (orchestr) │  │ .mts (prompt, coverage, STT)     │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐ │
│  │ bilibili-food-video- │  │ bilibili-food-video-probe-audio  │ │
│  │ comment.mts (screen) │  │ .mts (WAV split for long audio)  │ │
│  └──────────────────────┘  └──────────────────────────────────┘ │
└──────────────────────────┬──────────────────────────────────────┘
                           │ gRPC
┌──────────────────────────┼──────────────────────────────────────┐
│               nimi-runtime (Go gRPC daemon)                     │
│  STT (audio.transcribe)  |  Text (text.generate)               │
│  local whisper / cloud   |  local LLM / cloud LLM              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Main Workflow: Video Import (End-to-End)

```mermaid
flowchart TD
    A[用户粘贴 Bilibili 链接] --> B[点击 '导入并解析']
    B --> C{importMutation.mutate}
    C --> D[Tauri IPC: video_food_map_import_video]
    D --> E[extract_bvid_hint 提取 BV 号]
    E --> F[db::queue_import]
    F --> F1{BVID 已存在?}
    F1 -->|是| F2[复用已有 import row, 标记 running]
    F1 -->|否| F3[INSERT 新 import row]
    F2 --> G[返回 queued ImportRecord 给前端]
    F3 --> G
    G --> H[前端收到 record, 开始 1.5s 轮询 snapshot]
    G --> I[后台 thread::spawn 开始异步处理]

    I --> J[set_import_stage → resolving]
    J --> K[probe::run_probe]

    subgraph probe["Probe Script 执行流"]
        K --> K1[extractBvid 解析 BV 号]
        K1 --> K2[resolveVideoMetadata<br/>调用 Bilibili View API + Tag API]
        K2 --> K3[fetchPlayUrl<br/>调用 Bilibili playurl API]
        K3 --> K4[chooseBestAudioUrl<br/>优选标准 CDN, 避开 MCDN]

        K4 --> K5{fetchSubtitleTranscript<br/>调用 Player V2 API}
        K5 -->|有平台字幕| K6[直接使用平台字幕<br/>selectedSttModel = platform/bilibili-subtitle]
        K5 -->|无平台字幕| K7[走 Runtime STT]

        K7 --> K7a{音频 URL 直传成功?}
        K7a -->|是| K7b[全量转写<br/>coverage = full]
        K7a -->|否| K7c[下载音频 → FFmpeg 切分<br/>按段转写, coverage 可能 leading_segments_only]

        K6 --> K8[fetchPublicComments<br/>调用 Reply API, 最多 20 条]
        K7b --> K8
        K7c --> K8

        K8 --> K9[filterCommentCluesForExtraction<br/>初筛评论]
        K9 --> K10[runtime.ai.text.generate<br/>构建 extraction prompt, 连同评论线索一起送]
        K10 --> K11[extractJsonObject 从 LLM 输出提取 JSON]
        K11 --> K12[normalizeExtractionJsonToSimplified<br/>繁体 → 简体]
        K12 --> K13[mergeCommentCluesIntoExtraction<br/>评论线索合并进结构化结果]
        K13 --> K14[saveProbeArtifacts<br/>写本地 .tmp 文件]
    end

    K14 --> L[set_import_stage → geocoding]
    L --> M[db::complete_import_by_id]

    subgraph geocode_flow["Geocoding 与 Venue 写入"]
        M --> M1[parse_venue_inputs<br/>从 extraction_json.venues 解析]
        M1 --> M2[infer_import_city_hint<br/>从标题/描述/标签/评论/地址推断城市]
        M2 --> M3[load_existing_venue_user_state<br/>保留已有确认/收藏状态]
        M3 --> M4[DELETE 旧 venues → 逐条重建]

        M4 --> M5{对每个 venue}
        M5 --> M6[build_geocode_query]
        M6 --> M7{地址够具体 或 店名+城市可查?}
        M7 -->|否| M8[geocode = skipped]
        M7 -->|是| M9[geocode_address<br/>高德地理编码 API]
        M9 --> M9a{地理编码成功?}
        M9a -->|否| M9b[高德 POI 文字搜索 fallback]
        M9a -->|是| M10[resolved + 坐标]
        M9b --> M9c{POI 搜索成功?}
        M9c -->|是| M10
        M9c -->|否| M11[geocode = failed]

        M10 --> M12[resolve_review_state]
        M11 --> M12
        M8 --> M12

        M12 --> M13{判定 review_state}
        M13 -->|geocode resolved + confidence != low + 有店名| M14[map_ready]
        M13 -->|needs_review 或 无店名| M15[review]
        M13 -->|无地址 或 geocode failed| M16[search_only 或 review]

        M14 --> M17[INSERT venue row<br/>带 user_confirmed / is_favorite 继承]
        M15 --> M17
        M16 --> M17
    end

    M17 --> N[UPDATE imports SET status = succeeded]
    N --> O[前端 snapshot 轮询拿到最新数据]

    I -->|probe 失败| P[explain_import_error 友好化]
    P --> Q[mark_import_failed_by_id]
    Q --> O
```

---

## 3. Map Promotion 逻辑 (VFM-DISC-001 / VFM-DISC-007)

```mermaid
flowchart TD
    A[VenueRecord] --> B{should_show_on_map?}
    B --> C{review_state == map_ready<br/>OR user_confirmed?}
    C -->|否| D[不上图, 仅列表/Review]
    C -->|是| E{latitude != null<br/>AND longitude != null?}
    E -->|否| D
    E -->|是| F[加入 map_points → 出现在地图上]

    style F fill:#22c55e,color:#fff
    style D fill:#f97316,color:#fff
```

---

## 4. Review State 判定逻辑 (resolve_review_state)

```mermaid
flowchart TD
    A[VenueInput + GeocodeOutcome] --> B{geocode resolved<br/>AND confidence != low<br/>AND venue_name 非空?}
    B -->|是| C[map_ready]
    B -->|否| D{needs_review<br/>OR venue_name 为空?}
    D -->|是| E[review]
    D -->|否| F{address_text 为空?}
    F -->|是| G[search_only]
    F -->|否| H{geocode failed?}
    H -->|是| E
    H -->|否| G

    style C fill:#22c55e,color:#fff
    style E fill:#eab308,color:#000
    style G fill:#3b82f6,color:#fff
```

---

## 5. STT 模型选择工作流 (VFM-PIPE-002 / VFM-PIPE-009)

```mermaid
flowchart TD
    A[开始转写] --> B{平台字幕可用?<br/>Player V2 API 有字幕轨}
    B -->|是| C[直接用平台字幕<br/>model = platform/bilibili-subtitle<br/>coverage = full]
    B -->|否| D[读取用户 Settings 中的 STT 路由配置]
    D --> E[resolveConfiguredSttTarget<br/>决定 local/cloud + model + connectorId]
    E --> F{URL 直传转写成功?}
    F -->|是| G[全量转写 coverage = full]
    F -->|否| H[下载音频 bytes]
    H --> I{视频 > 300秒?}
    I -->|是| J[FFmpeg 切分为多段 WAV]
    I -->|否| K[整段发送]
    J --> L[逐段转写, 拼接 transcript]
    K --> L
    L --> M[coverage = full 或 leading_segments_only]

    style C fill:#22c55e,color:#fff
```

---

## 6. 用户 Curation 工作流 (VFM-DISC-008)

```mermaid
flowchart TD
    A[用户在 Discover/Review/VideoMap 中操作]

    subgraph confirm["确认操作"]
        B[点击 '确认这家店'] --> C[Tauri: video_food_map_set_venue_confirmation]
        C --> D[UPDATE venues SET user_confirmed = 1]
        D --> E{已有坐标?}
        E -->|是| F[should_show_on_map = true → 出现在地图]
        E -->|否| G[user_confirmed = true 但仍不上图]
    end

    subgraph favorite["收藏操作"]
        H[点击 '加入收藏'] --> I[Tauri: video_food_map_toggle_venue_favorite]
        I --> J[TOGGLE is_favorite]
        J --> K[收藏不改变 review_state<br/>不影响上图资格]
    end

    subgraph cancel["取消操作"]
        L[点击 '取消确认'] --> M[SET user_confirmed = 0]
        M --> N[如果原 review_state != map_ready → 从地图消失]
    end

    A --> B
    A --> H
    A --> L
```

---

## 7. Duplicate Intake 防重逻辑 (VFM-PIPE-007)

```mermaid
flowchart TD
    A[用户提交 URL] --> B[extract_bvid_hint 提取 BV 号]
    B --> C[ensure_import_row]
    C --> D{SELECT id FROM imports<br/>WHERE bvid = ?}
    D -->|找到已有 row| E[UPDATE: status=running,<br/>source_url 更新,<br/>error_message 清空]
    D -->|未找到| F[INSERT 新 import row]
    E --> G[复用同一 import_id]
    F --> G
    G --> H[probe 完成后 replace_venues<br/>DELETE 旧 venues → 重建]
    H --> I[保留已有 user_confirmed / is_favorite]

    style I fill:#22c55e,color:#fff
```

---

## 8. 评论线索补充工作流 (VFM-DISC-005)

```mermaid
flowchart TD
    A[probe 完成初步提取后] --> B[fetchPublicComments<br/>Bilibili Reply API<br/>无需登录, 最多 20 条]
    B --> C[flattenReplies 展平嵌套回复]
    C --> D[filterCommentCluesForExtraction<br/>第一轮: 无 extraction → 全部送入]
    D --> E[LLM extraction prompt<br/>评论作为补充上下文一起送给 LLM]
    E --> F[extractJsonObject 得到结构化结果]
    F --> G[filterCommentCluesForExtraction<br/>第二轮: 有 extraction → 按 venue_name 匹配]
    G --> H[mergeCommentCluesIntoExtraction<br/>匹配的评论线索写入 extraction JSON]
    H --> I[前端展示: 筛出的评论线索面板]
    I --> J{评论提到的地址线索}
    J -->|补充了店名/地址| K[可能让 geocoding 成功 → 从 review 提升到 map_ready]
    J -->|与已有证据矛盾| L[保持 review 状态, 不静默覆盖]
```

---

## 9. Runtime Route Settings 工作流 (VFM-SHELL-009)

```mermaid
flowchart TD
    A[App 启动] --> B[loadVideoFoodMapSettings<br/>从 settings.json 读取]
    A --> C[loadVideoFoodMapRuntimeOptions<br/>调用 list-runtime-route-options.mts]
    C --> D[ensure_running → 确保 nimi-runtime gRPC 在线]
    D --> E[runtime SDK 查询可用 connectors + models]
    E --> F[返回 stt catalog + text catalog<br/>含 options, loadStatus, issues]

    B --> G[前端渲染 Route Settings Panel]
    F --> G

    G --> H[用户选择 STT: local/cloud → connector → model]
    G --> I[用户选择 Text: local/cloud → connector → model]

    H --> J[saveVideoFoodMapSettings<br/>写入 settings.json]
    I --> J
    J --> K[下次导入时 probe 读取 settings<br/>通过 NIMI_VIDEO_FOOD_MAP_SETTINGS_JSON 传入]
```

---

## 10. 前端 Surface 切换与数据流

```mermaid
flowchart LR
    subgraph sidebar["侧边栏 (始终可见)"]
        S1[SearchField 搜索]
        S2[SelectField 状态筛选]
        S3[收藏列表 Top 3]
        S4[视频导入列表 SidebarItems]
    end

    subgraph surfaces["主区域 (Surface 切换)"]
        D[视频清单 Discover<br/>VenueDetailPanel<br/>视频信息+店铺列表+评论线索+转写文本+操作按钮]
        NM[发现地图 NearbyMap<br/>全局 MapSurface + 侧边统计+点位详情]
        VM[单视频地图 VideoMap<br/>当前视频的 MapSurface + 店铺列表]
        RV[待确认 Review<br/>未确认 venues 列表 + 确认/收藏/查看按钮]
        MN[点菜建议 Menu<br/>Stage 3 占位]
    end

    S1 --> |filterImports| D
    S1 --> |filterMapPoints| NM
    S2 --> |ReviewFilter| D
    S4 --> |selectedImportId| D
    S4 --> |selectedImportId| VM

    D --> |onSwitchToVideoMap| VM
    NM --> |查看所属视频| D
    RV --> |回到视频详情| D
```

---

## 11. Spec 合规审计摘要

| Spec Rule | 状态 | 实现位置 | 备注 |
|-----------|------|----------|------|
| **VFM-SHELL-001** Standalone App | **OK** | `apps/video-food-map/` | 独立 Tauri app |
| **VFM-SHELL-002** Core Surfaces | **OK** | App.tsx SurfaceSwitcher | 5 个 surface 全部注册 |
| **VFM-SHELL-003** Runtime + SDK | **OK** | probe 通过 SDK Runtime gRPC | 不直接调 provider |
| **VFM-SHELL-005** Kit-First | **OK** | 全部使用 nimi-kit/ui 组件 | Button, Surface, SearchField, etc. |
| **VFM-SHELL-009** Route Settings | **OK** | settings.rs + App.tsx 设置面板 | STT + Text 两路, 来自 runtime |
| **VFM-PIPE-001** Canonical Unit | **OK** | 1 video = 1 import record | bvid 唯一索引 |
| **VFM-PIPE-002** Extraction Order | **OK** | subtitle-first → STT fallback → extraction → comments | 严格按序 |
| **VFM-PIPE-003** Coverage Disclosure | **OK** | extractionCoverage 字段 | state + segments + duration |
| **VFM-PIPE-004** Structured Minimum | **OK** | VenueRecord 含全部必要字段 | creator_mid 作为 primary key |
| **VFM-PIPE-005** Fail-Close Store | **OK** | resolve_review_state | 无坐标不上图 |
| **VFM-PIPE-006** Multi-Venue Sep | **OK** | extraction_json.venues → 多条 venue rows | 一视频多店分离 |
| **VFM-PIPE-007** Duplicate Intake | **OK** | ensure_import_row by bvid | 复用 + 保留 user state |
| **VFM-PIPE-010** Cookieless | **OK** | 全部用 Bilibili public API | playurl + player v2 + reply |
| **VFM-PIPE-012** FFmpeg | **OK** | probe-audio.mts | 跨平台 WAV 切分 |
| **VFM-DISC-001** Map Promotion | **OK** | should_show_on_map | (map_ready OR confirmed) AND 有坐标 |
| **VFM-DISC-002** Search Dimensions | **OK** | filter.ts matchesSearch | creator/area/venue/dish/cuisine/flavor/reviewState |
| **VFM-DISC-004** Confirmation Order | **OK** | subtitle → transcript → extraction → comment | 按 PIPE-002 |
| **VFM-DISC-005** Comment Completion | **OK** | comment screening + merge | 矛盾不静默覆盖 |
| **VFM-DISC-006** Review Queue | **OK** | review surface | 未确认记录不丢弃 |
| **VFM-DISC-007** Geocoding Gate | **OK** | geocode_address + should_show_on_map | 文字线索不直接上图 |
| **VFM-DISC-008** User Curation | **OK** | confirm + favorite mutations | favorite 不改 review state |
| **VFM-MENU-001** Stage-3 | **OK** | Menu surface 为占位 | 不阻塞 stage-1 |

### 潜在改进点 (非 spec 违规)

1. **address_is_specific 判定**: 当前使用关键词匹配 (号/路/街 等), 对非标准地址格式可能误判
2. **geocode 两步 fallback**: 先地理编码 → 再 POI 搜索, 但没有 retry 机制; 高德 API 短暂不可用会直接 failed
3. **Review Queue 缺 reject 操作**: spec execution-plan Phase 2 已提到, 当前只有 confirm/favorite
4. **评论数固定 20 条**: Reply API `ps=20`, 高评论视频可能遗漏有价值线索
5. **city hint 推断**: infer_import_city_hint 用正则频次统计, 跨城市视频可能推断错误城市
