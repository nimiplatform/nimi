import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  cognitionKernelFiles,
  desktopKernelFiles,
  futureKernelFiles,
  parseKernelRules,
  platformKernelFiles,
  realmKernelFiles,
  runtimeKernelFiles,
  sdkKernelFiles,
} from './spec-human-doc-core.mjs';

export async function loadKernelRuleMap(specDir) {
  const ruleMap = new Map();

  for (const [domain, files] of [
    ['cognition', cognitionKernelFiles],
    ['runtime', runtimeKernelFiles],
    ['sdk', sdkKernelFiles],
    ['desktop', desktopKernelFiles],
    ['future', futureKernelFiles],
    ['platform', platformKernelFiles],
    ['realm', realmKernelFiles],
  ]) {
    for (const file of files) {
      try {
        const content = await fs.readFile(path.join(specDir, domain, 'kernel', file), 'utf8');
        for (const [id, rule] of parseKernelRules(content)) {
          ruleMap.set(id, rule);
        }
      } catch {
        // Skip missing optional kernel inputs.
      }
    }
  }

  return ruleMap;
}

export function appendDocumentIntroduction(d) {
  d.text(`# Nimi Platform 技术规范

> 本文档由 \`scripts/generate-spec-human-doc.mjs\` 自动生成，是 \`/.nimi/spec/\` 规范树的人类可读投影。
> 生成时间: ${new Date().toISOString().split('T')[0]}
>
> 权威规则定义位于 \`/.nimi/spec/\` 原始文件中。如需修改，请编辑当前 canonical spec 后重新生成。

---

## 目录

1. [概述](#1-概述)
2. [认证体系](#2-认证体系)
3. [连接器系统](#3-连接器系统)
4. [AI 推理管道](#4-ai-推理管道)
5. [流式处理](#5-流式处理)
6. [媒体任务系统](#6-媒体任务系统)
7. [安全与审计](#7-安全与审计)
8. [错误处理模型](#8-错误处理模型)
9. [SDK 架构](#9-sdk-架构)
10. [Desktop 架构](#10-desktop-架构)
11. [Future 能力规划](#11-future-能力规划)
12. [Standalone Cognition](#12-standalone-cognition)
13. [附录：参考表](#13-附录参考表)

---`);

  d.text(`
## 1. 概述

Nimi Runtime 是一个 gRPC 守护进程，负责 AI 推理执行、模型管理和身份认证。它运行在用户本地设备上，对外通过 gRPC 提供服务，由 TypeScript SDK 和桌面应用消费。

### 整体架构

\`\`\`
┌──────────────────────────────────────────────────┐
│                  Desktop / Web App               │
│                                                  │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│   │  Realm   │  │ Runtime  │  │   Mod    │      │
│   │   SDK    │  │   SDK    │  │   SDK    │      │
│   └────┬─────┘  └────┬─────┘  └────┬─────┘      │
└────────┼─────────────┼─────────────┼─────────────┘
         │ HTTP/WS     │ gRPC/IPC    │ Host Inject
         ▼             ▼             ▼
   ┌──────────┐  ┌──────────────────────────────┐
   │  Realm   │  │      Nimi Runtime (Go)       │
   │  Server  │  │                              │
   └──────────┘  │  ┌────────┐  ┌────────────┐  │
                 │  │ Auth   │  │ AI Service │  │
                 │  │ Core   │  │            │  │
                 │  └────────┘  └──────┬─────┘  │
                 │                     │        │
                 │           ┌─────────┴──────┐ │
                 │           │                │ │
                 │     ┌─────┴──┐    ┌────────┴┐│
                 │     │nimillm │    │ llama   ││
                 │     │(remote)│    │(local)  ││
                 │     └────────┘    └─────────┘│
                 └──────────────────────────────┘
\`\`\`

### 当前覆盖范围

本轮规范覆盖 Runtime 的 **AI 执行平面 + 认证核心**，包含五个服务：`);
}

export async function finalizeGeneratedDoc({ checkMode, outPath, output, repoRoot }) {
  if (checkMode) {
    let current = '';
    try {
      current = await fs.readFile(outPath, 'utf8');
    } catch {
      process.stderr.write(`spec human doc does not exist: ${path.relative(repoRoot, outPath)}\n`);
      process.stderr.write('run `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope spec-human-doc` to generate.\n');
      process.exitCode = 1;
      return;
    }

    const stripDate = (s) => s.replace(/^> 生成时间: .+$/m, '');
    if (stripDate(current) !== stripDate(output)) {
      process.stderr.write(`spec human doc drift detected: ${path.relative(repoRoot, outPath)}\n`);
      process.stderr.write('run `pnpm exec nimicoding generate-spec-derived-docs --profile nimi --scope spec-human-doc` to regenerate.\n');
      process.exitCode = 1;
      return;
    }

    process.stdout.write('spec human doc is up-to-date\n');
    return;
  }

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, output, 'utf8');
  process.stdout.write(`generated spec human doc: ${path.relative(repoRoot, outPath)}\n`);
}
