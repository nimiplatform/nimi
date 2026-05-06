# 怎么写 fail-close 接受性不变量

你想 packet 的 `acceptance_invariants` 真 fail-close、不要软的「应该」。方法学拒软不变量；这份菜谱展示怎么写硬的。

## 菜谱

1. **把不变量陈述为可验证 predicate。** 不是「这该可读」；是「每个保留的 docs/**/*.md 路径在至少一个 locale 里能从 sidebar（或 nav）到达」。
2. **命名校验机制。** Grep、dev server 检查、build pass 等。
3. **让失败模式显式。** 这条不变量失败长啥样？具体。
4. **跟 `negative_tests` 条目配对。** 负向测试 grep 风格抓违规；不变量是正向 predicate。
5. **跟 `forbidden_shortcuts` 交叉检查。** 如果不变量的反面是目录里某个模式，两个都声明。

## 软 vs 硬

| 软（拒） | 硬（准入） |
| --- | --- |
| 「页该可读」 | 「每个保留子页含至少一个具体 reader 场景」 |
| 「避免禁用主张」 | 「禁用 marker grep 在 `README.md` 与 `docs/**` 上零命中」 |
| 「Build 该工作」 | 「`pnpm docs:build` PASS」 |
| 「无 spec 漂移」 | 「`.nimi/spec/**` 保持不变（用 `git status -- .nimi/spec` 校验）」 |

软形式**无法**机器检查。硬形式可以。

## 阅读场景：软转硬

某 first-draft packet 有：

```
acceptance_invariants:
  - 文档该可读
  - Sidebar 该露出所有子页
  - Build 该过
  - 无 spec 漂移
```

这些都软。转：

```
acceptance_invariants:
  - 每个保留 docs/**/*.md 路径在至少一个 locale 里能从
    sidebar（或 nav）到达
  - 每个保留子页带至少一个绑到 kernel 规则家族的具体场景
    或 worked 例
  - Sidebar /<section>/ 组露出所有子页加显式 Related 交叉链
  - pnpm docs:build PASS
  - .nimi/spec/** 保持不变（git status 校验）
```

每条现在是可验证 predicate。

## 阅读场景：跟负向测试配对

不变量「无具体 provider 名引入」配：

```
negative_tests:
  - grep -rEni '\b(OpenAI|Anthropic|Claude|Gemini|GPT-[0-9]|...)\b'
    在 README.md 与 docs/** 上零命中
    （除元文档 forbidden-claims.md）
```

负向测试是具体 grep；不变量是正向形状。

## 阅读场景：跟禁用捷径交叉检查

不变量「无并行真相引入」配声明：

```
forbidden_shortcuts:
  - dual_read
  - dual_write
  - app_local_shadow_truth
  - silent_owner_cut_reopen
```

目录 key 是审计对照检查的；不变量是工作正向达成的。

## 要看什么

| 症状 | 含义 |
| --- | --- |
| 不变量措辞为「应该」 | 软；拒，重写为 predicate |
| 没命名校验机制 | 无法 fail-close |
| 失败模式不清楚 | Reviewer 无法校验 |
| 缺负向测试配对 | 只抓正向、缺对称 |

## 来源

- [`.nimi/contracts/packet.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/packet.schema.yaml)
- [`.nimi/contracts/acceptance.schema.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/acceptance.schema.yaml)
- [`.nimi/contracts/forbidden-shortcuts.catalog.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/contracts/forbidden-shortcuts.catalog.yaml)
- [`.nimi/methodology/four-closure-policy.yaml`](https://github.com/nimiplatform/nimi/blob/main/.nimi/methodology/four-closure-policy.yaml)
