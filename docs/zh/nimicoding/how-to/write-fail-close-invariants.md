# 写出 fail-closed 的验收不变式

你希望 packet 的 `acceptance_invariants` 真正能 fail-closed，而不是写成软性的"应该如何"。方法学拒绝软性不变式，本指南给出硬性写法。

## 步骤

1. **把不变式写成可验证的断言。** 不是"应该可读"，而是"`docs/**/*.md` 下保留的每个路径都至少能在一种语言下从侧栏（或导航）到达"。
2. **指明验证手段。** grep、dev server 检查、构建通过等。
3. **写清失败形态。** 这个不变式失败时长什么样？写具体。
4. **配一条 `negative_tests`。** 负面测试用 grep 风格抓违规；不变式是正面断言。
5. **与 `forbidden_shortcuts` 互验。** 如果不变式的取反正好命中目录里的某条捷径，两边都声明。

## 软 vs 硬

| 软（拒绝） | 硬（准入） |
| --- | --- |
| "页面应当可读" | "保留的每个子页都包含至少一个具体读者场景" |
| "避免出现禁止主张" | "禁止标记的 grep 在 `README.md` 与 `docs/**` 中返回零命中" |
| "构建应当能跑" | "`pnpm docs:build` PASS" |
| "不要规范漂移" | "`.nimi/spec/**` 保持不变（用 `git status -- .nimi/spec` 验证）" |

软的写法没法机器检查，硬的可以。

## 场景：把软改成硬

一份初稿 packet 写的是：

```
acceptance_invariants:
  - Documentation should be readable
  - Sidebar should expose all sub-pages
  - Build should pass
  - No spec drift
```

全是软的。改写：

```
acceptance_invariants:
  - Each retained docs/**/*.md path is reachable from sidebar
    (or nav) in at least one locale
  - Each retained sub-page carries at least one concrete
    scenario or worked example tied to a kernel rule family
  - Sidebar /<section>/ group exposes all sub-pages plus
    explicit Related cross-links
  - pnpm docs:build PASS
  - .nimi/spec/** remains unchanged (verified by git status)
```

每一条都是可验证的断言。

## 场景：与负面测试配对

不变式"未引入具体 provider 名"对应：

```
negative_tests:
  - grep -rEni '\b(OpenAI|Anthropic|Claude|Gemini|GPT-[0-9]|...)\b'
    returns zero hits across README.md and docs/**
    (excluding the meta-doc forbidden-claims.md)
```

负面测试是一条具体 grep；不变式给出正面形态。

## 场景：与禁止捷径互验

不变式"未引入并行真相"对应已声明的：

```
forbidden_shortcuts:
  - dual_read
  - dual_write
  - app_local_shadow_truth
  - silent_owner_cut_reopen
```

目录键值是审计要查的对象；不变式描述工作正面达成的形态。

## 注意事项

| 现象 | 含义 |
| --- | --- |
| 不变式写"应当" | 软；拒绝，重写为断言 |
| 没指明验证手段 | 无法 fail-closed |
| 失败形态不清 | 复核者无从验证 |
| 缺对应负面测试 | 只覆盖正面情况，少了对称性 |

## 来源依据

- [`nimi-coding/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/packet.schema.yaml)
- [`nimi-coding/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/acceptance.schema.yaml)
- [`nimi-coding/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/contracts/forbidden-shortcuts.catalog.yaml)
- [`nimi-coding/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi-coding/blob/main/methodology/four-closure-policy.yaml)
