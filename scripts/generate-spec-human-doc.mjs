#!/usr/bin/env node

/**
 * Generates a single human-readable Markdown document from the spec/ tree.
 *
 * The AI-oriented spec system uses Rule IDs (K-*, S-*) as machine anchors and
 * forbids prose duplication. This script produces a narrative-style document
 * organized by conceptual domain, with explanatory introductions and rules
 * inlined where contextually relevant.
 *
 * Usage:
 *   node scripts/generate-spec-human-doc.mjs           # generate
 *   node scripts/generate-spec-human-doc.mjs --check    # drift check
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const specDir = path.join(repoRoot, 'spec');
const outPath = path.join(specDir, 'generated', 'nimi-spec.md');

// ---------------------------------------------------------------------------
// Kernel rule parser
// ---------------------------------------------------------------------------

const RULE_HEADING_RE = /^##\s+((?:K|S|D|P|R|F)-[A-Z]+-\d{3})\s+(.*)$/;

function parseKernelRules(content) {
  const rules = new Map();
  const lines = content.split('\n');
  let currentId = null;
  let currentTitle = '';
  let bodyLines = [];

  function flush() {
    if (currentId) {
      rules.set(currentId, {
        title: currentTitle,
        body: bodyLines.join('\n').trim(),
      });
    }
  }

  for (const line of lines) {
    const m = line.match(RULE_HEADING_RE);
    if (m) {
      flush();
      currentId = m[1];
      currentTitle = m[2];
      bodyLines = [];
    } else if (currentId) {
      // Stop capturing at any same-level heading that is not a rule ID
      if (/^##\s/.test(line) && !RULE_HEADING_RE.test(line)) {
        flush();
        currentId = null;
      } else {
        bodyLines.push(line);
      }
    }
  }
  flush();
  return rules;
}

// ---------------------------------------------------------------------------
// YAML helpers
// ---------------------------------------------------------------------------

async function readYaml(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw);
}

// ---------------------------------------------------------------------------
// Document builder
// ---------------------------------------------------------------------------

class DocBuilder {
  constructor(ruleMap) {
    this.ruleMap = ruleMap;
    this.lines = [];
  }

  /** Add raw text. */
  text(str) {
    this.lines.push(str);
    return this;
  }

  /** Add a blank line. */
  blank() {
    this.lines.push('');
    return this;
  }

  /** Render a kernel rule as a readable block. Title becomes bold, body follows. */
  rule(id) {
    const r = this.ruleMap.get(id);
    if (!r) {
      this.lines.push(`> *[${id}: 规则未找到]*\n`);
      return this;
    }
    this.lines.push(`**${id} — ${r.title}**\n`);
    if (r.body) {
      this.lines.push(r.body);
    }
    this.lines.push('');
    return this;
  }

  /** Render multiple rules under a heading. */
  ruleGroup(heading, ids) {
    if (heading) {
      this.lines.push(`${heading}\n`);
    }
    for (const id of ids) {
      this.rule(id);
    }
    return this;
  }

  /** Render a YAML table inline. */
  async yamlTable(filePath, renderer) {
    try {
      const doc = await readYaml(filePath);
      const rendered = renderer(doc);
      if (rendered) this.lines.push(rendered);
    } catch {
      this.lines.push('> *[表格数据未找到]*\n');
    }
    return this;
  }

  build() {
    let output = this.lines.join('\n');
    return `${output.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n')}`;
  }
}

// ---------------------------------------------------------------------------
// YAML table renderers
// ---------------------------------------------------------------------------

function renderRpcMethods(doc) {
  const services = doc?.services || [];
  let out = '';
  for (const svc of services) {
    out += `**${svc.name}**\n\n`;
    out += '| 方法 | 类型 |\n|---|---|\n';
    for (const m of svc.methods || []) {
      out += `| ${m.name} | ${m.type} |\n`;
    }
    out += '\n';
  }
  return out;
}

function renderReasonCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| 名称 | 值 | 族 |\n|---|---:|---|\n';
  for (const c of codes) {
    out += `| ${c.name} | ${c.value} | ${c.family} |\n`;
  }
  return `${out}\n`;
}

function renderProviderCatalog(doc) {
  const providers = doc?.providers || [];
  let out = '| Provider | 默认 Endpoint | 需显式 Endpoint |\n|---|---|---|\n';
  for (const p of providers) {
    out += `| ${p.provider} | ${p.default_endpoint ?? '—'} | ${p.requires_explicit_endpoint ? '是' : '否'} |\n`;
  }
  return `${out}\n`;
}

function renderProviderCapabilities(doc) {
  const providers = doc?.providers || [];
  let out = '| Provider | 执行模块 | Managed | Inline | Endpoint 要求 |\n|---|---|---|---|---|\n';
  for (const p of providers) {
    out += `| ${p.provider} | ${p.execution_module} | ${p.managed_connector_supported ? '是' : '否'} | ${p.inline_supported ? '是' : '否'} | ${p.endpoint_requirement} |\n`;
  }
  return `${out}\n`;
}

function renderErrorMappingMatrix(doc) {
  const mappings = doc?.mappings || [];
  let out = '| ReasonCode | gRPC Code | 场景 | 出口形态 |\n|---|---|---|---|\n';
  for (const m of mappings) {
    out += `| ${m.reason_code} | ${m.grpc_code} | ${m.surface || '—'} | ${m.exit_shape || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderJobStates(doc) {
  const states = doc?.states || [];
  let out = '| 状态 | 终态 |\n|---|---|\n';
  for (const s of states) {
    out += `| ${s.state} | ${s.terminal ? '是' : '否'} |\n`;
  }
  return `${out}\n`;
}

function renderStateTransitions(doc) {
  const machines = doc?.machines || [];
  let out = '';
  for (const machine of machines) {
    out += `**${machine.machine}**\n\n`;
    out += `状态: ${(machine.states || []).join(' → ')}\n\n`;
    out += '| 从 | 到 | 触发条件 |\n|---|---|---|\n';
    for (const t of machine.transitions || []) {
      out += `| ${t.from} | ${t.to} | ${t.trigger} |\n`;
    }
    out += '\n';
  }
  return out;
}

function renderKeySourceTruthTable(doc) {
  const cases = doc?.cases || [];
  let out = '| 场景 | key_source | connector_id | inline 凭据 | 有效 | 错误码 |\n|---|---|---|---|---|---|\n';
  for (const c of cases) {
    const inline = [c.x_nimi_provider_type, c.x_nimi_provider_endpoint, c.x_nimi_provider_api_key].filter(Boolean).join('/') || '—';
    out += `| ${c.id} | ${c.key_source} | ${c.connector_id || '—'} | ${inline} | ${c.valid ? '是' : '否'} | ${c.reason_code || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderLocalEngineCatalog(doc) {
  const engines = doc?.engines || [];
  let out = '| 引擎 | 默认 Endpoint | 运行模式 | 协议 |\n|---|---|---|---|\n';
  for (const e of engines) {
    out += `| ${e.engine} | ${e.default_endpoint || '—'} | ${e.runtime_mode} | ${e.protocol} |\n`;
  }
  return `${out}\n`;
}

function renderLocalAdapterRouting(doc) {
  const routes = doc?.routes || [];
  let out = '| Provider | Capability | Adapter |\n|---|---|---|\n';
  for (const r of routes) {
    out += `| ${r.provider} | ${r.capability} | ${r.adapter} |\n`;
  }
  return `${out}\n`;
}

function renderSdkErrorCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| 名称 | 族 | 描述 |\n|---|---|---|\n';
  for (const c of codes) {
    out += `| ${c.name} | ${c.family || '—'} | ${c.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderImportBoundaries(doc) {
  const boundaries = doc?.boundaries || [];
  let out = '| 子路径 | 禁止导入 | 基线规则 |\n|---|---|---|\n';
  for (const b of boundaries) {
    const forbidden = Array.isArray(b.forbidden_imports) ? b.forbidden_imports.join(', ') : '—';
    const rules = Array.isArray(b.baseline_rules) ? b.baseline_rules.join(', ') : '—';
    out += `| ${b.surface || b.name} | ${forbidden} | ${rules} |\n`;
  }
  return `${out}\n`;
}

function renderMethodGroups(doc) {
  const groups = doc?.groups || [];
  let out = '';
  for (const g of groups) {
    out += `**${g.group || g.sdk_module || g.name}** → ${g.service || '—'}\n\n`;
    for (const m of g.methods || []) {
      const name = typeof m === 'string' ? m : m.name;
      out += `- ${name}\n`;
    }
    out += '\n';
  }
  return out;
}

function renderBootstrapPhases(doc) {
  const phases = doc?.phases || [];
  let out = '| 阶段 | 顺序 | 描述 |\n|---|---|---|\n';
  for (const p of phases) {
    out += `| ${p.phase || p.name} | ${p.order || '—'} | ${p.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderIpcCommands(doc) {
  const commands = doc?.commands || [];
  let out = '| 命令 | 描述 |\n|---|---|\n';
  for (const c of commands) {
    out += `| ${c.command || c.name} | ${c.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderAppTabs(doc) {
  const tabs = doc?.tabs || [];
  let out = '| Tab ID | 名称 | Nav Group | Feature Gate |\n|---|---|---|---|\n';
  for (const t of tabs) {
    out += `| ${t.id || t.tab_id} | ${t.label || t.name} | ${t.nav_group || '—'} | ${t.gated_by || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderStoreSlices(doc) {
  const slices = doc?.slices || [];
  let out = '| Slice | 描述 | Factory |\n|---|---|---|\n';
  for (const s of slices) {
    out += `| ${s.name} | ${s.description || '—'} | ${s.factory || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderHookSubsystems(doc) {
  const subsystems = doc?.subsystems || [];
  let out = '| 子系统 | Namespace | 描述 |\n|---|---|---|\n';
  for (const s of subsystems) {
    out += `| ${s.name} | ${s.namespace || s.capability_prefix || '—'} | ${s.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderUiSlots(doc) {
  const slots = doc?.slots || [];
  let out = '| 槽位 | 描述 |\n|---|---|\n';
  for (const s of slots) {
    out += `| ${s.slot || s.slot_id} | ${s.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderTurnHookPoints(doc) {
  const points = doc?.points || [];
  let out = '| Hook Point | 执行顺序 | 描述 |\n|---|---|---|\n';
  for (const p of points) {
    out += `| ${p.point || p.name} | ${p.order || '—'} | ${p.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderModLifecycleStates(doc) {
  const states = doc?.states || [];
  let out = '| 状态 | 描述 |\n|---|---|\n';
  for (const s of states) {
    out += `| ${s.state} | ${s.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderModKernelStages(doc) {
  const stages = doc?.stages || [];
  let out = '| 阶段 | 顺序 | 描述 |\n|---|---|---|\n';
  for (const s of stages) {
    out += `| ${s.stage || s.name} | ${s.order || '—'} | ${s.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderFeatureFlags(doc) {
  const flags = doc?.flags || [];
  let out = '| Flag | Desktop 默认 | Web 默认 | 描述 |\n|---|---|---|---|\n';
  for (const f of flags) {
    out += `| ${f.flag} | ${f.default_desktop ?? f.default ?? '—'} | ${f.default_web ?? '—'} | ${f.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderDataSyncFlows(doc) {
  const flows = doc?.flows || [];
  let out = '| 领域 | 方法 | 描述 |\n|---|---|---|\n';
  for (const f of flows) {
    const methods = Array.isArray(f.methods) ? f.methods.join(', ') : '—';
    out += `| ${f.flow || f.domain} | ${methods} | ${f.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderRetryStatusCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| Status Code | 原因 |\n|---|---|\n';
  for (const c of codes) {
    out += `| ${c.code} | ${c.reason || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderDesktopErrorCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| Error Code | Domain | 描述 |\n|---|---|---|\n';
  for (const c of codes) {
    out += `| ${c.code} | ${c.domain || '—'} | ${c.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderLogAreas(doc) {
  const areas = doc?.areas || [];
  let out = '| Area | 描述 |\n|---|---|\n';
  for (const a of areas) {
    out += `| ${a.area} | ${a.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderHookCapabilityAllowlists(doc) {
  const allowlists = doc?.source_types || doc?.allowlists || [];
  let out = '| Source Type | 能力模式 | 描述 |\n|---|---|---|\n';
  for (const a of allowlists) {
    const patterns = a.allowlist || a.patterns || [];
    out += `| ${a.source_type} | ${Array.isArray(patterns) ? patterns.join(', ') : '—'} | ${a.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderBacklogItems(doc) {
  const items = doc?.items || [];
  let out = '| Item ID | Title | Priority | Category | Status |\n|---|---|---|---|---|\n';
  for (const i of items) {
    out += `| ${i.item_id} | ${i.title} | ${i.priority} | ${i.category} | ${i.status} |\n`;
  }
  return `${out}\n`;
}

function renderBuildChunks(doc) {
  const chunks = doc?.chunks || [];
  let out = '| Chunk | 路由模式 | 描述 |\n|---|---|---|\n';
  for (const c of chunks) {
    out += `| ${c.name} | ${c.route_pattern || c.pattern || '—'} | ${c.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderModAccessModes(doc) {
  const modes = doc?.modes || [];
  let out = '| 模式 | 描述 |\n|---|---|\n';
  for (const m of modes) {
    out += `| ${m.name || m.mode} | ${m.description || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderResearchSources(doc) {
  const sources = doc?.sources || [];
  let out = '| Source ID | 标题 | 路径 |\n|---|---|---|\n';
  for (const s of sources) {
    out += `| ${s.source_id} | ${s.title || '—'} | ${s.path || '—'} |\n`;
  }
  return `${out}\n`;
}

function renderGraduationLog(doc) {
  const entries = doc?.entries || [];
  if (entries.length === 0) return '> *暂无毕业记录*\n';
  let out = '| Item ID | 毕业日期 | 目标 Spec |\n|---|---|---|\n';
  for (const e of entries) {
    out += `| ${e.item_id} | ${e.graduated_at || '—'} | ${e.target_spec || '—'} |\n`;
  }
  return `${out}\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const runtimeKernelFiles = [
  'rpc-surface.md', 'authz-ownership.md', 'authn-token-validation.md',
  'auth-service.md', 'grant-service.md', 'key-source-routing.md',
  'scenario-job-lifecycle.md', 'local-category-capability.md',
  'local-engine-contract.md', 'device-profile-contract.md',
  'endpoint-security.md',
  'streaming-contract.md', 'error-model.md', 'pagination-filtering.md', 'audit-contract.md',
  'daemon-lifecycle.md', 'provider-health-contract.md', 'workflow-contract.md',
  'model-service-contract.md', 'knowledge-contract.md', 'app-messaging-contract.md',
  'script-worker-contract.md', 'config-contract.md', 'connector-contract.md',
  'nimillm-contract.md', 'multimodal-provider-contract.md', 'delivery-gates-contract.md',
  'proto-governance-contract.md',
];

const sdkKernelFiles = [
  'surface-contract.md', 'transport-contract.md',
  'error-projection.md', 'boundary-contract.md',
  'runtime-contract.md', 'realm-contract.md', 'ai-provider-contract.md',
  'scope-contract.md', 'mod-contract.md', 'testing-gates-contract.md',
];

const desktopKernelFiles = [
  'bootstrap-contract.md', 'bridge-ipc-contract.md', 'state-contract.md',
  'auth-session-contract.md', 'data-sync-contract.md', 'hook-capability-contract.md',
  'mod-governance-contract.md', 'llm-adapter-contract.md', 'ui-shell-contract.md',
  'error-boundary-contract.md', 'telemetry-contract.md', 'network-contract.md',
  'security-contract.md', 'streaming-consumption-contract.md', 'codegen-contract.md',
];

const futureKernelFiles = [
  'capability-backlog.md', 'source-registry.md', 'graduation-contract.md',
];

const platformKernelFiles = [
  'protocol-contract.md',
  'architecture-contract.md',
  'ai-last-mile-contract.md',
  'governance-contract.md',
];

const realmKernelFiles = [
  'boundary-vocabulary-contract.md',
  'economy-contract.md',
  'interop-mapping-contract.md',
];

async function main() {
  const checkMode = process.argv.includes('--check');

  // Parse all kernel rules
  const ruleMap = new Map();

  for (const file of runtimeKernelFiles) {
    try {
      const content = await fs.readFile(path.join(specDir, 'runtime', 'kernel', file), 'utf8');
      for (const [id, rule] of parseKernelRules(content)) ruleMap.set(id, rule);
    } catch { /* skip */ }
  }

  for (const file of sdkKernelFiles) {
    try {
      const content = await fs.readFile(path.join(specDir, 'sdk', 'kernel', file), 'utf8');
      for (const [id, rule] of parseKernelRules(content)) ruleMap.set(id, rule);
    } catch { /* skip */ }
  }

  for (const file of desktopKernelFiles) {
    try {
      const content = await fs.readFile(path.join(specDir, 'desktop', 'kernel', file), 'utf8');
      for (const [id, rule] of parseKernelRules(content)) ruleMap.set(id, rule);
    } catch { /* skip */ }
  }

  for (const file of futureKernelFiles) {
    try {
      const content = await fs.readFile(path.join(specDir, 'future', 'kernel', file), 'utf8');
      for (const [id, rule] of parseKernelRules(content)) ruleMap.set(id, rule);
    } catch { /* skip */ }
  }

  for (const file of platformKernelFiles) {
    try {
      const content = await fs.readFile(path.join(specDir, 'platform', 'kernel', file), 'utf8');
      for (const [id, rule] of parseKernelRules(content)) ruleMap.set(id, rule);
    } catch { /* skip */ }
  }

  for (const file of realmKernelFiles) {
    try {
      const content = await fs.readFile(path.join(specDir, 'realm', 'kernel', file), 'utf8');
      for (const [id, rule] of parseKernelRules(content)) ruleMap.set(id, rule);
    } catch { /* skip */ }
  }

  process.stderr.write(`parsed ${ruleMap.size} kernel rules\n`);

  const rtTables = (name) => path.join(specDir, 'runtime', 'kernel', 'tables', name);
  const sdkTables = (name) => path.join(specDir, 'sdk', 'kernel', 'tables', name);
  const dtTables = (name) => path.join(specDir, 'desktop', 'kernel', 'tables', name);
  const ftTables = (name) => path.join(specDir, 'future', 'kernel', 'tables', name);
  const d = new DocBuilder(ruleMap);

  // =========================================================================
  // DOCUMENT START
  // =========================================================================

  d.text(`# Nimi Platform 技术规范

> 本文档由 \`scripts/generate-spec-human-doc.mjs\` 自动生成，是 \`spec/\` 目录的人类可读版本。
> 生成时间: ${new Date().toISOString().split('T')[0]}
>
> 权威规则定义位于 spec/ 原始文件中。如需修改，请编辑原始文件后重新生成。

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
12. [附录：参考表](#12-附录参考表)

---`);

  // =========================================================================
  // 1. 概述
  // =========================================================================

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
                 │     │nimillm │    │ LocalAI ││
                 │     │(remote)│    │ (local) ││
                 │     └────────┘    └─────────┘│
                 └──────────────────────────────┘
\`\`\`

### 当前覆盖范围

本轮规范覆盖 Runtime 的 **AI 执行平面 + 认证核心**，包含五个服务：`);
  d.blank();
  d.rule('K-RPC-001');

  d.text(`其中每个服务的完整方法列表如下：`);
  d.blank();
  d.rule('K-RPC-002');
  d.rule('K-RPC-003');
  d.rule('K-RPC-004');

  // =========================================================================
  // 2. 认证体系
  // =========================================================================

  d.text(`---

## 2. 认证体系

Nimi Runtime 的认证分为四个层次：**Token 验证**（AuthN）、**访问控制**（AuthZ）、**会话管理**（AuthService）和**授权签发**（GrantService）。这四层严格分工，各有明确的输入输出边界。

### 2.1 Token 验证（AuthN）

当请求携带 \`Authorization: Bearer <jwt>\` 头时，Runtime 会验证 JWT 的合法性。这是所有安全决策的基础。

验证规则的核心设计是**严格拒绝 + 不降级**：携带了 Authorization 头但 JWT 无效时，Runtime 不会把请求降级为匿名访问，而是直接拒绝。只有完全没有 Authorization 头的请求才被视为匿名。`);
  d.blank();
  d.rule('K-AUTHN-001');
  d.rule('K-AUTHN-002');
  d.rule('K-AUTHN-003');

  d.text(`JWKS（JSON Web Key Set）的缓存策略采用乐观缓存 + 按需刷新：正常情况使用缓存的公钥，只在遇到未知 \`kid\` 时才刷新一次。刷新失败不降级。`);
  d.blank();
  d.rule('K-AUTHN-004');
  d.rule('K-AUTHN-005');

  d.text(`所有 AuthN 失败统一返回同一个错误码，不泄露具体失败原因（格式错误、签名校验失败、过期等对外表现一致）：`);
  d.blank();
  d.rule('K-AUTHN-007');

  d.text(`AuthN 通过后，向下游投影最小身份上下文，后续的 AuthZ 层只消费这个投影结果，不重复解析 JWT：`);
  d.blank();
  d.rule('K-AUTHN-008');

  d.text(`### 2.2 访问控制（AuthZ）

AuthZ 在 AuthN 通过后执行，负责判断"这个用户能不能访问这个资源"。核心原则是**信息隐藏**：当用户无权访问某个资源时，系统表现为"资源不存在"而非"无权限"，避免泄露资源存在性。`);
  d.blank();
  d.rule('K-AUTH-001');
  d.rule('K-AUTH-002');

  d.text(`对于 Connector 相关操作，AuthZ 定义了固定的管理 RPC 门禁和 AI 推理资源校验顺序：`);
  d.blank();
  d.rule('K-AUTH-004');
  d.rule('K-AUTH-005');

  d.text(`AuthN 与 AuthZ 之间有明确的分层边界：AuthN 失败直接返回 \`UNAUTHENTICATED\`，不进入 AuthZ 评估。`);
  d.blank();
  d.rule('K-AUTH-007');

  d.text(`### 2.3 会话管理（AuthService）

\`RuntimeAuthService\` 负责应用注册、会话开启/续签/撤销，以及外部主体（如第三方 OAuth）的会话管理。它**只管理会话生命周期，不做授权决策**。`);
  d.blank();
  d.rule('K-AUTHSVC-001');
  d.rule('K-AUTHSVC-002');

  d.text(`会话 TTL 必须落在服务端配置的合法区间内，超出即拒绝（fail-close）。撤销操作是幂等的，不泄露"会话是否曾存在"的信息。`);
  d.blank();
  d.rule('K-AUTHSVC-004');
  d.rule('K-AUTHSVC-005');

  d.text(`### 2.4 授权签发（GrantService）

\`RuntimeGrantService\` 负责授权签发、访问校验和委托链管理。可以理解为"谁有权做什么"的决策中心。`);
  d.blank();
  d.rule('K-GRANT-001');
  d.rule('K-GRANT-002');

  d.text(`授权支持委托链（delegation chain）：一个 token 可以签发子 token，但子 token 的权限必须是父 token 权限的子集，且有深度限制。`);
  d.blank();
  d.rule('K-GRANT-005');
  d.rule('K-GRANT-006');

  // =========================================================================
  // 3. 连接器系统
  // =========================================================================

  d.text(`---

## 3. 连接器系统

Connector（连接器）是 Nimi Runtime 中最核心的抽象之一。它代表一个"AI 推理目标描述符"——告诉系统要去哪里执行 AI 推理。

### 3.1 为什么需要连接器？

用户可能使用多种 AI 服务：本地运行的开源模型（如 Qwen、LLaMA）、远程 API（如 OpenAI、Gemini、DeepSeek）。连接器统一了这些不同来源的管理方式：每个推理目标都是一个 Connector，有统一的 CRUD 接口和身份校验流程。

连接器本身是**薄描述**——它只记录"去哪里"和"用什么凭据"，不承载用户路由策略。

### 3.2 两种连接器

连接器分为两种：

- **LOCAL_MODEL**：本地模型，由系统预设。固定 6 个（对应 6 种能力类别），不能通过 CRUD 新建或删除
- **REMOTE_MANAGED**：远程托管，由用户创建。用户提供 API Key 和 endpoint，Runtime 托管凭据

\`\`\`protobuf
message Connector {
  string connector_id = 1;                // ULID
  ConnectorKind kind = 2;                 // LOCAL_MODEL | REMOTE_MANAGED
  ConnectorOwnerType owner_type = 3;      // SYSTEM | REALM_USER
  string owner_id = 4;                    // SYSTEM 常量或 JWT sub
  string provider = 5;                    // local | gemini | openai | ...
  string endpoint = 6;                    // local 固定空串；remote 非空
  string label = 7;
  ConnectorStatus status = 8;             // ACTIVE | DISABLED
  bool has_credential = 11;              // 展示用，非门禁
  LocalConnectorCategory local_category = 12;
}
\`\`\`

关键约束：
- \`provider/kind/owner_type/owner_id\` 创建后不可变
- Runtime 是 API Key **托管者**，不是分发者——凭据不出 runtime 进程`);
  d.blank();
  d.rule('K-AUTH-003');

  d.text(`### 3.3 本地模型类别

本地连接器对应 6 种固定的能力类别，每种类别映射到不同的 AI 能力：`);
  d.blank();
  d.rule('K-LOCAL-001');
  d.rule('K-LOCAL-002');

  d.text(`其中 CUSTOM 类型的模型需要提供 \`local_invoke_profile_id\`，缺失则标记为不可用：`);
  d.blank();
  d.rule('K-LOCAL-003');

  d.text(`### 3.4 连接器 CRUD 操作

**创建**：只能创建 REMOTE_MANAGED 连接器，必须提供 API Key。endpoint 为空时使用 provider 默认值。`);
  d.blank();
  d.rule('K-RPC-007');

  d.text(`**更新**：至少修改一个可变字段。凭据或 endpoint 变化时自动失效远程模型缓存。`);
  d.blank();
  d.rule('K-RPC-008');

  d.text('**删除**：采用三步补偿流程（标记 pending → 删凭据 → 删记录），支持幂等重试。删除不影响已提交的 ScenarioJob。');
  d.blank();
  d.rule('K-RPC-009');

  d.text(`### 3.5 存储与可靠性

连接器数据存储在本地文件系统：

- 注册表：\`~/.nimi/runtime/connector-registry.json\`
- 凭据：\`~/.nimi/runtime/credentials/<connector_id>.key\`
- 权限：均为 \`0600\`

所有写入使用原子操作（写临时文件 → fsync → rename → fsync 父目录），全局写串行化保证一致性。

Runtime 启动时执行重扫补偿：回填 \`has_credential\`、清理孤儿凭据、恢复 \`delete_pending\` 残留。`);

  // =========================================================================
  // 4. AI 推理管道
  // =========================================================================

  d.text(`
---

## 4. AI 推理管道

当一个 AI 推理请求到达 Runtime，它会经历一条固定的处理管道。这个管道的设计原则是**评估顺序不可调整**——每个检查步骤的顺序都是固定的，避免越权侧信道泄露。

### 4.1 凭据路由：两条路径

请求可以通过两种方式指定凭据来源，二选一，不能混用：

1. **Managed 路径**：提供 \`connector_id\`，使用 Runtime 托管的连接器凭据
2. **Inline 路径**：通过 metadata 直接提供 provider type/endpoint/API key（临时使用，不持久化）`);
  d.blank();
  d.rule('K-KEYSRC-001');
  d.rule('K-KEYSRC-002');

  d.text(`### 4.2 请求评估顺序

请求按以下固定顺序逐步评估，任何一步失败立即返回错误：`);
  d.blank();
  d.rule('K-KEYSRC-004');

  d.text(`这个顺序的设计意图是：先做认证（步骤 2-3），再做授权（步骤 5-6），最后做安全校验（步骤 7-8）和路由（步骤 9-10）。每一步只在前置条件满足后才执行。

### 4.3 远程执行（nimillm 模块）

nimillm 是 Runtime 内部的远程执行模块，处理所有需要调用外部 AI API 的请求。它的职责边界非常清晰：

- 只负责**执行**（发送请求到 provider 并返回结果）
- 不负责认证、凭据持久化、连接器 CRUD
- 入口互斥校验由上游完成，nimillm 不重建第二套入口规则

Provider 适配分两层：先按 \`provider_type\` 选择 backend family，同 family 内允许 channel 分流，但**禁止跨 provider 自动 fallback**。

### 4.4 本地执行（local-model 子系统）

本地执行采用三层抽象：`);
  d.blank();
  d.rule('K-LOCAL-007');

  d.text(`Phase 1 采用 1:1 绑定（一个 Model 对应一个 Service）：`);
  d.blank();
  d.rule('K-LOCAL-008');

  d.text(`#### 4.4.1 本地引擎

Phase 1 支持两种 OpenAI-compatible 引擎：`);
  d.blank();
  d.rule('K-LENG-001');
  d.rule('K-LENG-002');

  d.text(`所有引擎通过标准 OpenAI-compatible HTTP API 通信：`);
  d.blank();
  d.rule('K-LENG-006');

  d.text(`健康探测使用 \`GET /v1/models\` 判定引擎可达性：`);
  d.blank();
  d.rule('K-LENG-007');

  d.text(`引擎配置优先级（高覆盖低）：RPC 请求参数 > 环境变量 > 配置文件 > 引擎默认值：`);
  d.blank();
  d.rule('K-LENG-008');

  d.text(`#### 4.4.2 设备画像

安装本地模型前，系统可以采集设备画像来评估硬件兼容性：`);
  d.blank();
  d.rule('K-DEV-001');
  d.rule('K-DEV-002');
  d.rule('K-DEV-007');

  d.text(`#### 4.4.3 模型获取

本地模型有三种获取方式：

- **Verified 安装**：从进程内硬编码的可信模型列表安装（\`InstallVerifiedModel\`）
- **手动安装**：用户提供完整元数据直接安装（\`InstallLocalModel\`）
- **Manifest 导入**：从本地文件系统读取模型清单导入（\`ImportLocalModel\`）

安装前可执行预检（\`ResolveModelInstallPlan\`），生成硬件兼容性 warnings：`);
  d.blank();
  d.rule('K-LOCAL-012');

  d.text(`#### 4.4.4 依赖解析

Mod 可以声明对本地模型的依赖，分为四类：`);
  d.blank();
  d.rule('K-LOCAL-013');

  d.text(`依赖解析后通过四阶段 Apply 管道部署：`);
  d.blank();
  d.rule('K-LOCAL-014');
  d.rule('K-LOCAL-015');

  d.text(`#### 4.4.5 适配器路由与策略门控

本地 Node 的 adapter 按 provider × capability 矩阵路由：`);
  d.blank();
  d.rule('K-LOCAL-017');

  d.text(`策略门控可条件性禁止特定组合（如 nexa 不支持 video）：`);
  d.blank();
  d.rule('K-LOCAL-018');

  d.text(`#### 4.4.6 流式降级

当本地 provider 不支持流式生成时，系统可以降级为非流式生成并分片模拟推送，但必须在审计和终帧 metadata 中标记 \`stream_simulated=true\`：`);
  d.blank();
  d.rule('K-LENG-011');

  d.text(`#### 4.4.7 model_id 前缀路由

AI 执行路径根据 model_id 前缀确定引擎：`);
  d.blank();
  d.rule('K-LOCAL-020');

  d.text(`#### 4.4.8 Node 目录生成

Node 是 Service × capability 笛卡尔积的计算视图，每次查询实时生成：`);
  d.blank();
  d.rule('K-LOCAL-019');

  d.text(`#### 4.4.9 搜索结果排序

目录搜索结果的排序规则：`);
  d.blank();
  d.rule('K-LOCAL-021');

  d.text(`### 4.5 Provider 白名单

每个 provider 有固定的默认 endpoint、是否支持 managed/inline 两种路径、对应的执行模块。这些信息由以下两个 YAML 表定义：`);
  d.blank();
  await d.yamlTable(rtTables('provider-catalog.yaml'), renderProviderCatalog);
  await d.yamlTable(rtTables('provider-capabilities.yaml'), renderProviderCapabilities);

  // =========================================================================
  // 5. 流式处理
  // =========================================================================

  d.text(`---

## 5. 流式处理

Runtime 有两类流式模式：场景流（StreamScenario）与任务状态订阅（SubscribeScenarioJobEvents）。

### 5.1 建流边界

流的建立有一个关键的分界点：AI 推理管道的全部 10 步评估通过后，流才算建立。

- **建流前**出错：走普通 gRPC error，和 unary RPC 一样
- **建流后**出错：优先通过终帧事件通知（\`done=true + reason_code\`），而非中断流

这意味着客户端可以简单地判断：如果收到了第一个流事件，说明认证、授权、凭据校验都已通过，后续错误只可能来自上游 provider。`);
  d.blank();
  d.rule('K-STREAM-002');

  d.text(`### 5.2 文本流事件

文本流的事件约定简单明确：

- 中间帧：\`done=false\`，必须携带非空的 \`text_delta\`
- 终帧：\`done=true\`，必须携带 \`usage\` 统计（token 用量）。如果上游不提供统计，填 \`-1\`
- 终帧可以携带最后一段 \`text_delta\`（即最后一个 chunk 和 done 可以合并）`);
  d.blank();
  d.rule('K-STREAM-003');

  d.text(`### 5.3 语音流事件

语音流的事件约定类似，但音频数据和状态信号严格分离：

- 中间帧：\`done=false\`，必须携带非空的 \`audio_chunk\`
- 成功终帧：\`done=true\`，\`audio_chunk\` 为空
- 失败终帧：\`done=true\`，\`reason_code\` 必填`);
  d.blank();
  d.rule('K-STREAM-004');

  d.text(`### 5.4 状态事件流

ScenarioJob 状态事件流不使用 \`done=true\` 语义。当任务到达终态后，服务端正常关闭流（gRPC OK）。`);
  d.blank();
  d.rule('K-STREAM-005');

  // =========================================================================
  // 6. ScenarioJob 系统
  // =========================================================================

  d.text(`---

## 6. ScenarioJob 系统

图像生成、视频生成、TTS/STT 等场景类 AI 任务采用异步模式：通过 \`SubmitScenarioJob\` 提交任务，然后通过轮询或事件流获取结果。

### 6.1 核心设计：凭据快照

ScenarioJob 的一个关键设计是**凭据快照**。任务提交时，系统会快照当前的 provider type、endpoint 和凭据。之后所有对这个 job 的操作（查询状态、获取结果、取消）都使用快照凭据，**不依赖连接器的当前状态**。

这意味着：
- 用户在任务执行期间删除连接器，不影响任务的可观测性和可控性
- 任务到达终态后，快照凭据会被清理（内存清零 + 持久化删除）`);
  d.blank();
  d.rule('K-JOB-003');
  d.rule('K-JOB-004');
  d.rule('K-JOB-005');

  d.text(`### 6.2 任务状态机

ScenarioJob 有以下状态，其中四个是终态：`);
  d.blank();
  await d.yamlTable(rtTables('job-states.yaml'), renderJobStates);

  d.text(`事件流在任一终态后可正常关闭。`);

  // =========================================================================
  // 7. 安全与审计
  // =========================================================================

  d.text(`
---

## 7. 安全与审计

### 7.1 Endpoint 安全

所有出站的 AI API 请求都必须经过 endpoint 安全校验，包括 managed 连接器的 endpoint 和 inline 路径的 endpoint。校验不是一次性的——**每次实际出站请求前都必须执行**，防止 TOCTOU（Time-of-check to time-of-use）攻击。`);
  d.blank();
  d.rule('K-SEC-002');
  d.rule('K-SEC-003');

  d.text(`### 7.2 审计

所有管理操作和推理操作都必须记录审计事件（成功和失败）。审计记录包含最小字段集：`);
  d.blank();
  d.rule('K-AUDIT-001');

  d.text(`审计数据有严格的安全要求：必须脱敏（不记录明文凭据），必须有保留期限（禁止无限保留）。`);
  d.blank();
  d.rule('K-AUDIT-005');

  // =========================================================================
  // 8. 错误处理模型
  // =========================================================================

  d.text(`---

## 8. 错误处理模型

### 8.1 双层错误模型

Nimi 的错误由两层组成，二者正交：

- **gRPC Code**：表示失败的阶段/类型（如 \`NOT_FOUND\`、\`UNAUTHENTICATED\`、\`INTERNAL\`）
- **ReasonCode**：表示具体的业务原因（如 \`AI_CONNECTOR_DISABLED\`、\`AUTH_TOKEN_INVALID\`）

同一个 ReasonCode 在不同场景下可能对应不同的 gRPC Code。例如 \`AI_CONNECTOR_CREDENTIAL_MISSING\` 在 consume 场景返回 \`FAILED_PRECONDITION\`，在 test-connector 场景返回 \`OK + ok=false\`。`);
  d.blank();
  d.rule('K-ERR-001');

  d.text(`### 8.2 关键映射规则

以下是几个最重要的错误映射规则：`);
  d.blank();
  d.rule('K-ERR-004');
  d.rule('K-ERR-005');

  d.text(`### 8.3 错误传递机制

错误在不同类型的 RPC 中传递方式不同：`);
  d.blank();
  d.rule('K-ERR-003');

  d.text(`### 8.4 分页与过滤

\`ListConnectors\` 和 \`ListConnectorModels\` 支持分页。页面大小默认 50，最大 200。排序规则是固定的——本地连接器排在前面，远程连接器按创建时间倒序。`);
  d.blank();
  d.rule('K-PAGE-001');
  d.rule('K-PAGE-003');

  // =========================================================================
  // 9. SDK 架构
  // =========================================================================

  d.text(`---

## 9. SDK 架构

在 Nimi 的整体架构中，SDK 扮演的角色是**唯一合法网关**：Desktop 和 Web 应用不直接发 gRPC 调用，也不直接拼 HTTP 请求，一切对 Runtime 和 Realm 的访问必须经过 \`@nimiplatform/sdk\`。这不是一个便利性选择——SDK 承担了传输声明、错误投影、导入隔离三项关键职责，把"调用底层服务"从一个全局不确定行为收窄为五条受控通道。

\`\`\`
┌─────────────────────────────────────────────────────────────┐
│                   Desktop / Web / Mod                       │
│                                                             │
│  @nimiplatform/sdk                                          │
│  ┌──────────┐ ┌────────────┐ ┌───────┐ ┌───────┐ ┌──────┐  │
│  │ runtime  │ │ai-provider │ │ realm │ │ scope │ │ mod  │  │
│  └────┬─────┘ └─────┬──────┘ └───┬───┘ └───┬───┘ └──┬───┘  │
│       │ gRPC/IPC     │ wraps     │ HTTP/WS  │ memory │ host │
└───────┼──────────────┼───────────┼──────────┼────────┼──────┘
        ▼              ▼           ▼          ▼        ▼
  ┌───────────┐   (delegates   ┌────────┐  (local)  (injected
  │  Runtime  │    to runtime) │ Realm  │           by desktop)
  │   (Go)    │                │ Server │
  └───────────┘                └────────┘
\`\`\`

下面的规范从"为什么分五个子路径"出发，依次展开传输层设计、错误投影模型和导入边界，最后简述每个子路径的领域特征。

### 9.1 为什么是五个子路径？

五个子路径看似只是目录划分，实际上反映了五种**根本不同的传输模型和信任假设**：

- **runtime** — 通过 gRPC 或 Tauri IPC 与本地守护进程通信，延迟极低，但需要显式声明传输通道
- **ai-provider** — 封装 AI SDK v3 协议，把标准化的 \`generateText\` / \`embed\` 调用翻译为 Runtime gRPC 方法；它是**协议适配层**，不做路由决策
- **realm** — 通过 HTTP/WebSocket 与远程 Realm 服务器通信，延迟和可靠性特征与 gRPC 截然不同
- **scope** — 纯 in-memory 权限目录，无网络通信，维护 register / publish / revoke 最小闭环
- **mod** — Mod 不拥有自己的客户端，一切能力通过 host 注入获得

如果把它们合并为一个入口，transport 切换逻辑、错误码映射、安全边界就会交织在一起，制造出"能调通但偶尔莫名失败"的隐藏耦合。五条子路径让每种通信模式有独立的初始化和失败语义。`);
  d.blank();
  d.rule('S-SURFACE-001');

  d.text(`各子路径的方法投影遵循结构化治理。Runtime SDK 的对外方法按 service 分组，与 \`spec/runtime/kernel/tables/rpc-methods.yaml\` 的设计名对齐——投影表 \`tables/runtime-method-groups.yaml\` 是唯一事实源：`);
  d.blank();
  d.rule('S-SURFACE-002');
  d.rule('S-SURFACE-009');

  d.text(`遗留接口名（\`listTokenProviderModels\`、\`TokenProvider*\` 系列）已被禁用，公共契约层不得暴露这些旧名称：`);
  d.blank();
  d.rule('S-SURFACE-003');

  d.text(`Realm、Scope、Mod 三个子路径各有最小稳定导出面：Realm 使用实例化 facade 入口（无全局配置），Scope 暴露 in-memory catalog + publish/revoke 语义，Mod 暴露 host 注入 facade + hook client：`);
  d.blank();
  d.rule('S-SURFACE-004');

  d.text(`### 9.2 Transport 层：显式声明与分离

为什么 transport 必须显式声明？因为 \`node-grpc\` 和 \`tauri-ipc\` 的行为差异远超一个 adapter 能隐藏的范围：gRPC 有独立连接池、HTTP/2 多路复用、超时语义；IPC 走 Tauri 进程间通道，无网络栈。如果让 SDK "自动检测"使用哪种 transport，调用者在调试失败时将无法判断问题出在网络层还是 IPC 层。

\`\`\`typescript
import { Runtime } from '@nimiplatform/sdk/runtime';

// 必须显式声明 transport — 不允许隐式默认
const runtime = new Runtime({
  transport: 'tauri-ipc',   // 或 'node-grpc'
  // endpoint: 仅 node-grpc 需要
});
\`\`\``);
  d.blank();
  d.rule('S-TRANSPORT-001');

  d.text(`在请求结构上，SDK 严格分离 metadata 与 body：\`connectorId\` 在请求体中，而 provider endpoint、api_key 走传输 metadata。这种分离确保业务参数和基础设施凭据不混在同一层。`);
  d.blank();
  d.rule('S-TRANSPORT-002');

  d.text(`流式场景有一条关键约束：**SDK 不自动重连断开的流**。流中断后，调用方必须显式重建订阅。设计意图是避免"悄悄重连但丢了中间消息"的数据完整性问题。`);
  d.blank();
  d.rule('S-TRANSPORT-003');

  d.text(`Realm 侧的传输设计同样强调实例隔离——每个 \`new Realm(options)\` 独立维护 endpoint/token/header，禁止共享全局 \`OpenAPI\` 运行时配置。这意味着同一进程中可以同时持有多个 Realm 实例，指向不同服务器，互不干扰。`);
  d.blank();
  d.rule('S-TRANSPORT-004');

  d.text(`SDK 与 Runtime 之间的版本兼容采用 **fail-close** 策略：major 版本不兼容直接报错，不存在"部分可用"的中间态。minor/patch 差异允许通过 capability 检测做受控降级，兼容结果必须对上层可读（用于提示和治理）。`);
  d.blank();
  d.rule('S-TRANSPORT-005');

  d.text(`可观测性作为辅助能力附着在传输层：SDK 支持向下游传播调用链 trace ID（通过 metadata/header），但可观测性输出**绝不包含明文凭据**（api key / token），且不改变请求的成功/失败语义。`);
  d.blank();
  d.rule('S-TRANSPORT-006');

  d.text(`### 9.3 错误投影：三层重试模型

SDK 的错误模型是整个 Nimi 错误体系中最复杂的一环，因为它必须同时处理三种来源的错误：Runtime gRPC 错误（带 ReasonCode）、Realm HTTP 错误、以及 SDK 自身产生的本地错误。

核心设计洞察是**双层投影 + 三层重试**：

\`\`\`
错误来源                           投影结果
─────────────────────────────────────────────────
Runtime gRPC → status + ReasonCode → 直接投影
Realm HTTP   → status + body       → 直接投影
SDK 本地     → 参数/环境/边界违规   → SDK_* 错误码
                                    (独立于 Runtime ReasonCode)

重试决策树
─────────────────────────────────────────────────
                 错误发生
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
   Transport 层              Application 层
   (gRPC status)             (ReasonCode)
        │                       │
  UNAVAILABLE ─── 可重试   AI_PROVIDER_UNAVAILABLE ─── 可重试
  DEADLINE_EXCEEDED 可重试 AI_PROVIDER_TIMEOUT ──────── 可重试
  RESOURCE_EXHAUSTED 可重试 AI_STREAM_BROKEN ────────── 可重试
  ABORTED ── ReasonCode    SESSION_EXPIRED ─────────── 可重试
             优先判断
        │                       │
        └───────────┬───────────┘
                    ▼
              Internal 层
           (SDK 连接恢复)
                    │
         SDK transport 错误 ─── 内部透明重试
         OPERATION_ABORTED ──── 永不重试
\`\`\``);
  d.blank();
  d.rule('S-ERROR-001');

  d.text(`Runtime ReasonCode 的权威来源是 \`spec/runtime/kernel/tables/reason-codes.yaml\`。SDK 文档不得重新分配 ReasonCode 的数值——只做投影，不做重定义。`);
  d.blank();
  d.rule('S-ERROR-002');

  d.text(`SDK 本地错误码有独立的事实源 \`tables/sdk-error-codes.yaml\`，与 Runtime ReasonCode 不混用。Realm 本地配置错误使用 \`SDK_REALM_*\` 族，版本和方法兼容错误使用 \`SDK_RUNTIME_*\` 族——兼容错误不能降级为通用网络错误或空成功。`);
  d.blank();
  d.rule('S-ERROR-003');
  d.rule('S-ERROR-005');
  d.rule('S-ERROR-006');

  d.text(`重试语义分三层协同工作。Transport 层的重试判断基于 gRPC status code（\`UNAVAILABLE\`、\`DEADLINE_EXCEEDED\`、\`RESOURCE_EXHAUSTED\`、\`ABORTED\`），但 \`ABORTED\` 的重试被 ReasonCode 优先级约束。流中断永不自动重连（如 S-TRANSPORT-003 所定义）。`);
  d.blank();
  d.rule('S-ERROR-004');

  d.text(`Application 层通过公开的 \`isRetryableReasonCode()\` 函数标记可重试的应用级 ReasonCode，与 transport 层互补、不重叠。可重试集合包括 Runtime 侧的 \`AI_PROVIDER_UNAVAILABLE\`、\`AI_PROVIDER_TIMEOUT\`、\`AI_STREAM_BROKEN\`、\`SESSION_EXPIRED\`，以及 SDK 合成的 \`RUNTIME_UNAVAILABLE\`、\`RUNTIME_BRIDGE_DAEMON_UNAVAILABLE\`。`);
  d.blank();
  d.rule('S-ERROR-007');

  d.text(`Internal 层是 SDK 内部的连接恢复重试（auto mode），使用独立的可重试集合，仅包含 SDK transport 错误码。这层重试对外不可见，且 \`OPERATION_ABORTED\` 在任何层级都**永不重试**。`);
  d.blank();
  d.rule('S-ERROR-008');

  d.text(`### 9.4 导入边界与模块隔离

SDK 的五个子路径之间有**物理级导入隔离**，而非仅靠文档约定。设计意图是：Mod 开发者引入 \`@nimiplatform/sdk/mod\` 时，不能通过 import chain 间接访问到 runtime 或 realm 的私有客户端——这是安全边界，不只是代码组织偏好。`);
  d.blank();
  d.rule('S-BOUNDARY-001');

  d.text(`Runtime 与 Realm 之间的边界尤其关键：SDK 内部代码不得将 gRPC transport 和 REST client 混入同一个私有入口点。显式分离防止凭据和传输配置的意外交叉泄漏。`);
  d.blank();
  d.rule('S-BOUNDARY-002');

  d.text(`Mod SDK 的隔离更为严格——Mod 不得绕过 host 注入直接访问 runtime/realm 的私有客户端。所有对平台资源的依赖必须通过注入的 host facade 流转。`);
  d.blank();
  d.rule('S-BOUNDARY-003');

  d.text(`作为迁移清理的一部分，以下旧入口被明确禁止：\`createNimiClient\`、全局 \`OpenAPI.BASE\` / \`OpenAPI.TOKEN\` 赋值。所有配置必须走现代的实例级模式。`);
  d.blank();
  d.rule('S-BOUNDARY-004');

  d.text(`### 9.5 各子路径领域概述

**Runtime SDK** 是最重的子路径。入口 \`new Runtime(options)\` 必须声明 transport（如 9.2 所述），构造后提供与 Runtime 守护进程完整的方法投影：连接器 CRUD、AI 推理触发、认证管理、Grant 操作等。方法按 service 分组（如 S-SURFACE-002 / S-SURFACE-009 所定义），每个方法调用携带显式的 metadata/body 分离。重试策略按上述三层模型执行。

**AI Provider** 是 Runtime SDK 上层的协议适配。它实现 AI SDK v3 的 \`LanguageModelV1\` / \`EmbeddingModelV1\` 接口，将标准化调用（\`generateText\`、\`embed\`、\`generateMedia\`）翻译为对应的 Runtime gRPC 方法。AI Provider **只做协议转换**——路由决策由 Desktop 的 LLM 适配器或调用方完成。

**Realm SDK** 通过 HTTP/WebSocket 与远程 Realm 服务器通信。每个 \`new Realm(options)\` 实例独立配置 endpoint、token、headers（如 S-TRANSPORT-004 所定义）。Realm SDK 的认证模型允许 \`NO_AUTH\` 模式用于公开数据读取。本地配置错误使用 \`SDK_REALM_*\` 族错误码。

**Scope SDK** 维护纯内存的权限目录。核心 API 是 \`register\` / \`publish\` / \`revoke\` 三操作，不涉及网络通信。Scope catalog 是进程级的——各 Runtime 实例共享同一个 catalog 实例。

**Mod SDK** 设计为最小权限。Mod 通过 host 注入获得 facade 和 hook client，不能直接构造 Runtime 或 Realm 客户端（如 S-BOUNDARY-003 所定义）。Mod 可用的能力由 Desktop 的 Hook 能力模型（见 10.6）中的 capability allowlist 控制。`);

  // =========================================================================
  // 10. Desktop 架构
  // =========================================================================

  d.text(`---

## 10. Desktop 架构

Nimi Desktop 是一个 Tauri + React 应用，它把 Runtime（Go 守护进程）、Realm（远程平台）和 Mod（第三方扩展）三个世界粘合成一个统一的用户体验。与传统 Electron 应用不同，Desktop 选择 Tauri 的核心原因是 Rust 后端提供了真正的本地能力：进程管理、安全存储、TCP 端口绑定——这些在浏览器沙箱中无法实现。

Desktop 规范由 13 个契约域组成，从启动序列到安全策略形成完整的应用生命周期。每个域都有独立的规则集，但域间存在明确的依赖关系——例如启动序列依赖 IPC 桥接，数据同步依赖认证会话。

\`\`\`
┌──────────────────────────────────────────────────────────────┐
│                    Nimi Desktop (Tauri)                       │
│                                                              │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │
│  │UI Shell │  │  State   │  │   Hook   │  │ Mod Runtime  │  │
│  │ (React) │  │(Zustand) │  │ (5 subs) │  │ (8 stages)   │  │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └──────┬───────┘  │
│       │            │             │                │          │
│  ┌────┴────────────┴─────────────┴────────────────┴───────┐  │
│  │              IPC Bridge (Tauri invoke)                  │  │
│  └──────────────────────┬─────────────────────────────────┘  │
│                         │                                    │
│  ┌──────────────────────┴──────────────────────────────┐     │
│  │            Tauri Backend (Rust)                      │     │
│  │   daemon mgmt · secure store · proxy fetch · OAuth  │     │
│  └──────────┬─────────────────────────┬────────────────┘     │
└─────────────┼─────────────────────────┼──────────────────────┘
              │                         │
    ┌─────────┴──────────┐    ┌────────┴────────┐
    │  Runtime (Go gRPC) │    │  Realm (HTTP)   │
    │  localhost only     │    │  remote server  │
    └────────────────────┘    └─────────────────┘
\`\`\`

### 10.1 启动序列：八阶段异步初始化

Desktop 的启动不是一个简单的 \`init()\` 调用——它是一条 8 阶段的异步依赖链。为什么不能一次性初始化？因为每个阶段都有明确的前置条件：Platform Client 需要 Realm URL（来自 Runtime Defaults），DataSync 需要 Platform Client，Runtime Host 需要 DataSync，Mod 注册需要 Runtime Host。任何阶段失败都有精确的错误边界，不会"半初始化"。

\`\`\`
阶段依赖链
─────────────────────────────────────────────────────
① Runtime Defaults (IPC)
   ↓ realm URL + execution params
② Platform Client 初始化
   ↓ API client ready
③ DataSync Facade 初始化
   ↓ initApi(realm, proxyFetch)
④ Auth Session 引导
   ↓ token ready / anonymous
⑤ Runtime Host 装配
   ↓ HTTP context + capabilities
⑥ Mod 注册
   ↓ 部分失败不阻塞
⑦ External Agent 桥接
   ↓ tier-1 actions registered
⑧ Bootstrap 完成
   ↓ bootstrapReady = true
\`\`\``);
  d.blank();
  d.rule('D-BOOT-001');
  d.rule('D-BOOT-002');
  d.rule('D-BOOT-003');

  d.text(`阶段 ④ 在启动期间执行 token 交换或匿名回退——这是认证状态的初始决策点。阶段 ⑤ 组装 HTTP context provider、runtime host 能力、mod SDK host 和核心数据能力。阶段 ⑥ 从本地 manifest 注册 mod，**部分 mod 注册失败不阻塞整体启动**，采用降级模式继续。阶段 ⑦ 注册 tier-1 external agent actions 并启动 action bridge。`);
  d.blank();
  d.rule('D-BOOT-004');
  d.rule('D-BOOT-005');
  d.rule('D-BOOT-006');
  d.rule('D-BOOT-007');

  d.text(`阶段 ⑧ 设置 \`bootstrapReady\` / \`bootstrapError\` 标志，失败时清除 auth 状态。整个启动链有一个关键的幂等性守卫：\`bootstrapPromise\` 单例确保 bootstrap 全局只执行一次——即使在 HMR（热模块替换）场景下重复触发也安全。`);
  d.blank();
  d.rule('D-BOOT-008');
  d.rule('D-BOOT-009');

  d.text(`### 10.2 IPC 桥接：为什么不直接 HTTP？

Desktop 为什么不让 Renderer 直接发 HTTP 请求？三个原因：浏览器沙箱有 CORS 限制、无法访问本地文件系统、无法绑定 TCP 端口。Tauri IPC 把这些限制绕过——所有跨进程通信走 \`window.__TAURI__.invoke()\`，由 Rust 后端代理执行。

IPC 层的基础设施先于具体命令。统一的 \`invoke()\` 入口先检查 \`hasTauriInvoke\`（即 \`window.__TAURI__\` 是否存在），然后为每次调用生成 \`invokeId\`、写入结构化日志、统一错误归一化。这意味着所有 IPC 命令自动获得可观测性，无需各命令自行实现。`);
  d.blank();
  d.rule('D-IPC-009');

  d.text(`高容量模块（如 local-ai 和 external-agent）采用动态 \`import()\` 懒加载，避免主 bundle 体积膨胀：`);
  d.blank();
  d.rule('D-IPC-010');

  d.text(`在此基础设施之上，IPC 命令按功能域分组：

**Runtime Defaults 命令** — \`runtime_defaults\` 返回 realm 和运行时执行默认值，采用防御性解析：`);
  d.blank();
  d.rule('D-IPC-001');

  d.text(`**Daemon 生命周期命令** — status、start、stop、restart，报告 \`launchMode\`：`);
  d.blank();
  d.rule('D-IPC-002');

  d.text(`**Config 读写命令** — \`runtime_bridge_config_get\` / \`set\` 管理配置持久化：`);
  d.blank();
  d.rule('D-IPC-003');

  d.text(`**HTTP 代理命令** — \`http_request\` 代理所有 HTTP 请求通过 Tauri 后端，绕过 CORS。**UI 命令** — \`open_external_url\`、\`confirm_private_sync\`、\`start_window_drag\`。**OAuth 命令** — \`oauth_token_exchange\` 和 \`oauth_listen_for_code\`，支持 PKCE 和 clientSecret 两种模式：`);
  d.blank();
  d.rule('D-IPC-004');
  d.rule('D-IPC-005');
  d.rule('D-IPC-006');

  d.text(`**Mod 本地命令** — 读取本地 manifest 和 entry 文件。**External Agent 命令** — agent token 管理和 action descriptor 同步。**Local AI 命令** — 懒加载的模型列表、安装、生命周期管理和审计：`);
  d.blank();
  d.rule('D-IPC-007');
  d.rule('D-IPC-008');
  d.rule('D-IPC-011');

  d.text(`### 10.3 状态管理：四个 Zustand Slice

Desktop 的应用状态采用 Zustand slice 架构。为什么不用 Redux 或 Context？因为各业务域（Auth、Runtime、Mod、UI）的状态生命周期完全不同——Auth 状态跨 session 持久化，Runtime 状态在 daemon 重启时重置，Mod 状态随 workspace 动态增减，UI 状态纯临时。Slice 架构让每个域独立声明自己的状态和操作，最终通过无 middleware 的组合注入全局 store。`);
  d.blank();
  d.rule('D-STATE-001');
  d.rule('D-STATE-002');
  d.rule('D-STATE-003');
  d.rule('D-STATE-004');

  d.text(`四个 slice 通过 \`useAppStore\` 合并为单一 Zustand store，不使用 middleware（immer、persist 等）——状态更新直接用 \`set()\` 替换，保持调试透明性：`);
  d.blank();
  d.rule('D-STATE-005');

  d.text(`### 10.4 认证会话：Desktop 与 Web 的分歧

认证会话管理是 Desktop 和 Web 唯一出现**根本性分歧**的领域。两者共享同一个状态机（\`bootstrapping → authenticated | anonymous\`），但 token 的存储策略完全不同：Desktop 通过 Tauri secure store（OS 级密钥链）持久化 token，Web 使用 localStorage 加过期机制。

\`\`\`
Auth 状态机
─────────────────────────────────────────────────
             ┌──────────────┐
             │ bootstrapping│
             └──────┬───────┘
                    │ token exchange / check
           ┌────────┴────────┐
           ▼                 ▼
  ┌──────────────┐   ┌────────────┐
  │authenticated │   │ anonymous  │
  └──────┬───────┘   └──────┬─────┘
         │ logout/expire    │ login
         └──────────────────┘
\`\`\``);
  d.blank();
  d.rule('D-AUTH-001');
  d.rule('D-AUTH-002');
  d.rule('D-AUTH-003');

  d.text(`状态机的转换规则是确定性的：\`bootstrapping\` 只能到 \`authenticated\` 或 \`anonymous\`，\`authenticated\` 可因 logout/过期回退到 \`anonymous\`，\`anonymous\` 可通过 login 转为 \`authenticated\`。`);
  d.blank();
  d.rule('D-AUTH-004');

  d.text(`认证状态变更驱动数据同步：DataSync 监听 \`authChange\` 事件，认证成功时同步 token 并启动 polling，认证失效时停止 polling 并清除缓存。这是启动序列（10.1）和数据同步（10.5）之间的关键连接点。`);
  d.blank();
  d.rule('D-AUTH-005');

  d.text(`### 10.5 数据同步：十二条独立流

数据同步是 Desktop 最庞大的子系统——12 个业务流域，每个都有独立的触发条件、缓存策略和错误处理。为什么不用一个统一的"sync all"？因为各域的数据生命周期截然不同：Chat 需要 polling + outbox 实时推送，Notification 只需定时拉取，Economy 需要精确的余额一致性。

12 个流域共享 6 项基础设施：API init 初始化、hot state 同步、context lock 防并发、polling 调度、error log 记录、facade delegate 委托。这意味着每个流域只需声明"拉什么"和"怎么缓存"，基础设施自动处理重试和错误收集。`);
  d.blank();
  d.rule('D-DSYNC-001');
  d.rule('D-DSYNC-002');
  d.rule('D-DSYNC-003');

  d.text(`Chat 流域是最复杂的：它结合了 polling（定时拉取会话列表和未读计数）和 outbox（消息先写入本地 outbox，异步 flush 到服务器）。消息发送失败时保留在 outbox 中等待重试，不丢弃。`);
  d.blank();

  d.ruleGroup(`**领域数据流**`, [
    'D-DSYNC-004', 'D-DSYNC-005', 'D-DSYNC-006', 'D-DSYNC-007',
    'D-DSYNC-008', 'D-DSYNC-009', 'D-DSYNC-010', 'D-DSYNC-011', 'D-DSYNC-012',
  ]);

  d.text(`### 10.6 Hook 能力模型：五子系统与五级信任

Hook 系统是 Mod 扩展 Desktop 的唯一合法途径。它定义了 5 个子系统，覆盖事件通信、数据查询、对话轮次干预、UI 注入和跨 Mod 调用五个扩展面。

在具体子系统之前，先理解两个基础机制。**Capability Key 格式**采用点分隔命名（\`subsystem.action.target\`），支持 \`*\` 通配符匹配和批量匹配。**Source-Type 权限网关**定义了 5 种来源信任层级，从最高到最低：

\`\`\`
信任层级（权限只减不增）
─────────────────────────────────────────────────
Level 5   core        平台内置核心组件     — 完全能力
Level 4   builtin     官方预装 Mod        — 接近完全
Level 3   injected    运行时注入的组件     — 受限能力
Level 2   sideload    开发者侧载          — 最小能力
Level 1   codegen     AI 生成的代码       — 最受限
\`\`\`

每种 source type 有对应的 capability allowlist，权限只能沿信任层级递减，不能通过任何机制提升。`);
  d.blank();
  d.rule('D-HOOK-006');
  d.rule('D-HOOK-007');

  d.text(`在此基础上，5 个子系统各覆盖一个扩展面：

**Event 子系统** — pub/sub 事件总线，能力键 \`event.publish.*\` / \`event.subscribe.*\`。**Data 子系统** — 数据查询和注册，能力键 \`data.query.*\` / \`data.register.*\`，sideload 来源限制为 query-only。`);
  d.blank();
  d.rule('D-HOOK-001');
  d.rule('D-HOOK-002');

  d.text(`**Turn 子系统** — 对话轮次 hook，4 个注入点（pre-policy → pre-model → post-state → pre-commit），source type 限制注入点访问。**UI 子系统** — 8 个预定义 slot 的组件注册，codegen 来源有前缀限制。**Inter-Mod 子系统** — 跨 Mod 的 RPC 通信（\`inter-mod.request.*\` / \`inter-mod.provide.*\`）。`);
  d.blank();
  d.rule('D-HOOK-003');
  d.rule('D-HOOK-004');
  d.rule('D-HOOK-005');

  d.text(`Hook 系统还提供两个共享能力域：**LLM Capability** 覆盖文本/图像/视频/嵌入生成和语音操作，**Action Capability** 覆盖 discover/dry-run/verify/commit 操作：`);
  d.blank();
  d.rule('D-HOOK-008');
  d.rule('D-HOOK-009');

  d.text(`### 10.7 Mod 治理：八阶段执行内核

Mod 的生命周期不是简单的"安装 → 运行"——它是一条 8 阶段的逐级过滤管道。每个阶段独立做出 ALLOW / ALLOW_WITH_WARNING / DENY 决策，并产出 decision record。阶段之间无跳过——即使前面的阶段全部通过，后面的阶段仍然独立评估。

\`\`\`
Mod 8 阶段执行管道
─────────────────────────────────────────────────
① Discovery   — 定位包 + 验证来源引用
       ↓ ALLOW
② Manifest    — 解析清单 + 版本兼容检查
       ↓ ALLOW
③ Signature   — 签名验证 + 签署者身份确认
       ↓ ALLOW（local-dev/sideload 跳过）
④ Dependency  — 依赖解析 + 构建产物
       ↓ ALLOW
⑤ Sandbox     — 能力策略评估 + 沙箱约束
       ↓ ALLOW / ALLOW_WITH_WARNING
⑥ Load        — 加载入口源 + 在沙箱中执行注册
       ↓ ALLOW
⑦ Lifecycle   — enable / disable / uninstall / update
       ↓ 状态转换（支持 rollback）
⑧ Audit       — 写入 decision record + 本地审计
\`\`\`

4 种 access mode 决定了每个阶段的验证严格度：\`official\` 要求完整签名链，\`community\` 要求社区签名，\`sideload\` 跳过签名但限制能力，\`local-dev\` 最宽松但只允许本地开发。`);
  d.blank();
  d.rule('D-MOD-001');
  d.rule('D-MOD-002');
  d.rule('D-MOD-003');
  d.rule('D-MOD-004');

  d.text(`阶段 ⑤ 的沙箱策略评估是安全核心：它根据 Mod 声明的 capability 需求和 source type 的 allowlist 做交叉匹配，超出允许范围的能力请求直接 DENY。`);
  d.blank();
  d.rule('D-MOD-005');
  d.rule('D-MOD-006');
  d.rule('D-MOD-007');

  d.text(`每个阶段的决策结果有三种语义：\`ALLOW\` 无条件通过，\`ALLOW_WITH_WARNING\` 通过但记录警告（提示用户注意），\`DENY\` 阻止并终止管道。审计阶段将完整的 decision record 链写入本地存储。`);
  d.blank();
  d.rule('D-MOD-008');
  d.rule('D-MOD-009');
  d.rule('D-MOD-010');

  d.text(`### 10.8 LLM 适配器与语音引擎

Desktop 的 LLM 层有一个关键设计决策：**不直接调用外部 AI API**。所有 AI 推理——无论是 OpenAI、Gemini 还是本地 Qwen——全部通过 SDK 的 Runtime 接口执行。Desktop 只在 Runtime 之上添加三层本地增强：provider 适配（路由到正确的 Runtime 方法）、Connector 凭据路由（通过 \`connector_id\` 路由到 Runtime ConnectorService 管理的凭据）、本地模型健康检查（验证 endpoint 可达性和模型状态）。

这意味着 Desktop 层面的 LLM 代码量极小——路由决策通过 \`resolveChatRoute\` 确定执行模式，凭据通过 \`connector_id\` 委托 Runtime 管理而非本地持有，健康检查通过 \`checkLocalLlmHealth\` 在推理前执行。`);
  d.blank();
  d.rule('D-LLM-001');
  d.rule('D-LLM-002');
  d.rule('D-LLM-003');
  d.rule('D-LLM-004');

  d.text(`语音引擎集成遵循相同的"不绕过 Runtime"原则。Desktop 通过 Hook 注册语音能力（7 个 speech capability keys），设置 fetch/route resolver，最终仍通过 Runtime 执行语音推理。本地 AI 推理事件通过 \`LocalAiInferenceAuditPayload\` 记录，包含 eventType 和 source 追踪。`);
  d.blank();
  d.rule('D-LLM-005');
  d.rule('D-LLM-006');

  d.text(`### 10.9 UI Shell 与导航体系

UI Shell 定义了 Desktop 的视觉骨架：两栏布局（可折叠侧边栏 + 内容面板），3 组导航（Core Nav 6 项 + Quick Nav 1 项 + Detail Tab），以及 lazy-load 代码分割策略。`);
  d.blank();
  d.rule('D-SHELL-001');

  d.text(`Mod 通过 feature flag 控制组件渲染和 workspace tab，通过 slot 注入扩展 UI：`);
  d.blank();
  d.rule('D-SHELL-002');

  d.text(`窗口管理支持原生拖拽（Desktop 通过 \`enableTitlebarDrag\` 启用，Web 不适用）。布局结构使用 \`MainLayoutView\` 两栏布局，侧边栏可折叠，内容面板根据导航状态映射。图标系统通过 \`renderShellNavIcon\` 提供 inline SVG 图标，未知 tab 回退到 puzzle 图标。`);
  d.blank();
  d.rule('D-SHELL-003');
  d.rule('D-SHELL-006');
  d.rule('D-SHELL-007');

  d.text(`代码分割采用两级策略：\`shell-core\` 和 \`bridge\` 同步加载（启动关键路径），feature 模块（chat、social、economy 等）按路由 lazy-load。i18n 使用 \`react-i18next\` 框架，locale 文件和导航标签支持翻译。`);
  d.blank();
  d.rule('D-SHELL-004');
  d.rule('D-SHELL-005');

  d.text(`### 10.10 错误边界与归一化

Desktop 的错误来自 4 个来源：Runtime gRPC 错误、Realm HTTP 错误、IPC Bridge 错误、本地逻辑错误。错误边界的职责是将这 4 种异构错误**归一化为统一格式**，让上层代码不必关心错误的原始来源。

归一化采用两阶段匹配：先尝试精确 code match（如 \`LOCAL_AI_IMPORT_*\`、\`LOCAL_AI_MODEL_*\`），再尝试 pattern regex match，最后 fallback 到通用错误。每种错误码都有对应的 domain 分类和用户消息。`);
  d.blank();
  d.rule('D-ERR-001');
  d.rule('D-ERR-002');
  d.rule('D-ERR-003');
  d.rule('D-ERR-004');

  d.text(`Bridge 层的错误归一化（\`BRIDGE_ERROR_CODE_MAP\`）是两阶段的：先 exact code match，再 pattern regex match，最后 fallback。Bootstrap 期间的错误通过 \`bootstrapRuntime().catch()\` 处理，设置 \`bootstrapError\`、清除 auth、记录失败日志。`);
  d.blank();
  d.rule('D-ERR-005');
  d.rule('D-ERR-006');

  d.text(`### 10.11 遥测与可观测性

遥测层的目标是让每个"事情发生了"都可追踪——无论是 IPC 调用、网络重试还是 bootstrap 阶段转换。

日志载荷采用结构化格式 \`RuntimeLogPayload\`，包含 level、area、message、traceId、flowId、source、costMs、details。消息格式有严格约定：必须使用 \`action:\` 或 \`phase:\` 前缀，\`normalizeRuntimeLogMessage\` 自动补充缺失的前缀。`);
  d.blank();
  d.rule('D-TEL-001');
  d.rule('D-TEL-002');

  d.text(`Logger 通过 \`setRuntimeLogger(logger)\` 注入，未注入时 fallback 到 \`console.*\`。每个 \`invoke()\` 调用自动生成 \`invokeId\` 并记录 invoke-start/success/failed 日志。`);
  d.blank();
  d.rule('D-TEL-003');
  d.rule('D-TEL-005');

  d.text(`流程追踪 ID 通过 \`createRendererFlowId\` 生成（格式：\`\${prefix}-\${timestamp}-\${random}\`），支持跨组件的请求关联。Renderer 日志可通过 IPC 转发到 Tauri 后端（\`RendererLogPayload\`）。网络层日志使用独立的 \`net\` area，记录 retrying/recovered/exhausted 事件并映射 log level。`);
  d.blank();
  d.rule('D-TEL-004');
  d.rule('D-TEL-006');
  d.rule('D-TEL-007');

  d.text(`### 10.12 网络层：代理、重试与实时

Desktop 的网络层解决三个问题：CORS 绕过、失败重试、实时通信。

**代理 Fetch**：\`createProxyFetch()\` 将所有 HTTP 请求代理到 Tauri 后端的 \`http_request\` IPC 命令，从根本上绕过浏览器 CORS 限制。错误通过 \`normalizeApiError()\` 统一格式化（status + message + fallback）。`);
  d.blank();
  d.rule('D-NET-004');
  d.rule('D-NET-005');

  d.text(`**重试策略**：7 个 HTTP 状态码被标记为可重试（408、425、429、500、502、503、504）。\`requestWithRetry\` 使用指数退避：maxAttempts=3、initialDelayMs=120、maxDelayMs=900。每次重试触发 \`RetryEvent\` 回调（retrying/recovered/retry_exhausted），携带 reason 追踪。`);
  d.blank();
  d.rule('D-NET-001');
  d.rule('D-NET-002');
  d.rule('D-NET-003');

  d.text(`**实时传输**：Socket.IO WebSocket 连接绕过 CORS，携带 auth token 和 session protocol。内建事件去重和断线恢复机制。`);
  d.blank();
  d.rule('D-NET-006');

  d.text(`### 10.13 安全模型

Desktop 的安全策略由 5 层纵深防御构成，从最基础的网络限制到最上层的 Mod 沙箱。

**Layer 1: Loopback 限制** — 所有 Runtime endpoint 必须指向 localhost / 127.0.0.1 / [::1]，阻止任何远程路由。这是最基础的安全屏障：即使其他层全部失效，AI 推理请求也不会离开本机。`);
  d.blank();
  d.rule('D-SEC-001');

  d.text(`**Layer 2: Bearer Token 管理** — Token 存储在 Zustand \`auth.token\` 中，同步到 DataSync hot state。Desktop 和 Web 通过各自的持久化机制管理 Realm access token（Web 使用 localStorage 加过期机制，敏感页面需二次验证，logout 时完全清除）。`);
  d.blank();
  d.rule('D-SEC-002');
  d.rule('D-SEC-010');

  d.text(`**Layer 2.5: AI 凭据委托** — AI provider API key 的唯一托管者是 Runtime ConnectorService（K-CONN-001: custodian not distributor）。Desktop renderer 不接触原始 API key，通过 SDK \`CreateConnector\` / \`UpdateConnector\` 将凭据写入 Runtime 后即刻丢弃内存副本。AI 请求通过 \`connector_id\` 路由，Desktop/Web 统一使用 SDK ConnectorService 接口。`);
  d.blank();
  d.rule('D-SEC-009');

  d.text(`**Layer 3: OAuth 安全** — OAuth 流程通过 Tauri IPC 执行，支持 PKCE 和 clientSecret 两种模式，通过 redirect URI 监听完成授权。`);
  d.blank();
  d.rule('D-SEC-003');

  d.text(`**Layer 4: IPC 桥接隔离** — \`hasTauriInvoke()\` 检查 \`window.__TAURI__\` 存在性，统一 \`invoke()\` 入口确保所有 IPC 调用经过单一校验点。CSP 策略约束 script/style 加载和 connect-src 白名单。`);
  d.blank();
  d.rule('D-SEC-004');
  d.rule('D-SEC-008');

  d.text(`**Layer 5: Mod 能力沙箱** — Mod 在 capability sandbox 中执行，source-type 强制执行最小权限（如 10.6 所定义）。本地 AI 模型要求非空 \`manifest.hashes\` 进行完整性校验。External Agent 的 token 支持签发、撤销、列表和网关监控。`);
  d.blank();
  d.rule('D-SEC-005');
  d.rule('D-SEC-006');
  d.rule('D-SEC-007');

  // =========================================================================
  // 11. Future 能力规划
  // =========================================================================

  d.text(`---

## 11. Future 能力规划

为什么不用 GitHub Issues 做能力规划？因为 Nimi 的能力变更往往**跨越 4 层**（Runtime → SDK → Desktop → Realm），一个 issue 无法追溯到研究来源，无法表达跨层依赖，也没有从"想法"到"正式 spec"的毕业标准。

Future Capabilities 系统用三个互锁的注册表解决这个问题：能力 Backlog（记录"要建什么"）、来源注册表（记录"为什么要建"）、毕业日志（记录"什么时候进入了正式 spec"）。三者形成一条完整的追溯链：

\`\`\`
追溯链
─────────────────────────────────────────────────
Research Report        Backlog Item           Spec Document
(dev/research/*.md)    (backlog-items.yaml)   (spec/**/*.md)
       │                      │                      │
   source_id ─────→ source_ids[]              target_spec_path
                              │                      │
                        graduation ──────────→ graduation-log
                              │                      │
                      status: spec-drafted    Rule IDs assigned
\`\`\`

这种结构化治理提供了**机构记忆**——priority / depends_on / category 字段可审计，不会因团队变动而丢失决策上下文。

### 11.1 为什么需要结构化治理？

当一个能力需求从竞品分析中被提取出来时（例如"Dify 的工作流编排比我们更灵活"），它影响的可能是：Runtime 需要新的 workflow engine、SDK 需要新的方法投影、Desktop 需要新的 UI 面板、Realm 需要新的数据模型。这种跨层影响无法用 flat issue list 追踪——需要结构化的 priority、category、target_layers 字段来表达影响范围和优先级。

### 11.2 Backlog 条目结构与生命周期

每个 backlog 条目有 10 个标准化字段：item_id、title、priority、category、target_layers、status、source_ids、complexity、depends_on、architecture_notes。字段设计的目标是**让每个条目自包含**——不需要翻阅 issue thread 就能理解一个能力的完整上下文。`);
  d.blank();
  d.rule('F-CAP-001');

  d.text(`优先级分三级：\`high\`（核心 UX 或竞争差距，有明确实现路径）、\`medium\`（平台能力增强）、\`low\`（长期储备，无紧迫需求）。优先级标准不是主观判断——它基于 category 和 target_layers 的交叉分析。`);
  d.blank();
  d.rule('F-CAP-002');

  d.text(`条目的生命周期是一个确定性状态机：

\`\`\`
Backlog 条目生命周期
─────────────────────────────────────────────────
  proposed ──→ accepted ──→ spec-drafted ──→ implemented
     │             │
     ↓             ↓
  rejected      deferred
\`\`\`

每个状态转换都有明确的前置条件：\`proposed → accepted\` 需要 architecture_notes 非空，\`accepted → spec-drafted\` 需要满足毕业条件（见 11.4）。\`rejected\` 和 \`deferred\` 是终态的分支——\`deferred\` 可以在条件成熟后重新激活。`);
  d.blank();
  d.rule('F-CAP-003');

  d.text(`Category 枚举按域分类：\`ux\`（UI/交互）、\`integration\`（外部协议）、\`platform\`（核心能力）、\`auth\`（认证授权）、\`security\`、\`observability\`。分类用于过滤和跨层影响分析。`);
  d.blank();
  d.rule('F-CAP-004');

  d.text(`依赖关系（\`depends_on\`）引用 backlog 中已有的 item_id，不允许自引用或循环依赖链。依赖是**软约束**——建议实现顺序而非硬阻塞，允许独立并行开发。`);
  d.blank();
  d.rule('F-CAP-005');

  d.text(`### 11.3 来源注册：可追溯性链条

每个 backlog 条目的 \`source_ids\` 字段引用来源注册表中的 source_id。来源注册表执行**双层验证**：source_id 必须存在于 \`research-sources.yaml\` 注册表中（ID 存在性），且注册的 \`path\` 必须指向磁盘上实际存在的文件（文件存在性）。

Source ID 格式为 \`RESEARCH-<ABBREV>-NNN\`，其中 ABBREV 是 2-6 字符的大写缩写，NNN 是三位递增数字。每条来源包含 source_id、title、path（repo root 相对路径）、date（YYYY-MM-DD）、scope 五个必填字段。`);
  d.blank();
  d.rule('F-SRC-001');
  d.rule('F-SRC-002');
  d.rule('F-SRC-003');
  d.rule('F-SRC-004');

  d.text(`### 11.4 毕业流程：从 Backlog 到 Spec

当一个 backlog 条目足够成熟时，它通过毕业流程进入正式 spec。毕业条件是严格的：item 必须处于 \`accepted\` 状态、有明确的 target spec 路径、已分配 kernel Rule ID、且 \`architecture_notes\` 非空（完成了架构影响评估）。`);
  d.blank();
  d.rule('F-GRAD-001');

  d.text(`毕业是一个**原子操作**——三个步骤必须在同一个变更集中完成：① 在目标 spec 域创建/扩展对应文档，② 在 \`graduation-log.yaml\` 中追加毕业记录，③ 更新 backlog item 状态为 \`spec-drafted\`。拆分为多个 commit 会产生中间不一致状态。`);
  d.blank();
  d.rule('F-GRAD-002');

  d.text(`毕业日志的每条记录包含 item_id、graduated_date、target_spec_path、target_rule_ids 和可选 notes。日志是 **append-only** 的——已写入的记录不可修改或删除。`);
  d.blank();
  d.rule('F-GRAD-003');

  d.text(`为什么毕业不可逆？设计意图是防止 "graduation ping-pong"（反复在 backlog 和 spec 之间搬迁）。一旦毕业，发现的问题在目标 spec 域中处理，不通过回退 backlog 状态来解决。毕业后的 item 保留在 backlog 中，仅状态变更为 \`spec-drafted\`——保留完整历史。`);
  d.blank();
  d.rule('F-GRAD-004');

  // =========================================================================
  // 12. 附录：参考表
  // =========================================================================

  d.text(`---

## 12. 附录：参考表

以下表格从 YAML 事实源自动渲染。YAML 文件是权威数据源；如需修改，请编辑 YAML 后重新生成。

### 12.1 Runtime — RPC 方法列表
`);
  await d.yamlTable(rtTables('rpc-methods.yaml'), renderRpcMethods);

  d.text(`### 12.2 Runtime — ReasonCode 错误码表
`);
  await d.yamlTable(rtTables('reason-codes.yaml'), renderReasonCodes);

  d.text(`### 12.3 Runtime — 错误映射矩阵
`);
  await d.yamlTable(rtTables('error-mapping-matrix.yaml'), renderErrorMappingMatrix);

  d.text(`### 12.4 Runtime — Key Source 真值表
`);
  await d.yamlTable(rtTables('key-source-truth-table.yaml'), renderKeySourceTruthTable);

  d.text(`### 12.5 Runtime — 状态机
`);
  await d.yamlTable(rtTables('state-transitions.yaml'), renderStateTransitions);

  d.text(`### 12.6 Runtime — 本地引擎目录
`);
  await d.yamlTable(rtTables('local-engine-catalog.yaml'), renderLocalEngineCatalog);

  d.text(`### 12.7 Runtime — 本地适配器路由
`);
  await d.yamlTable(rtTables('local-adapter-routing.yaml'), renderLocalAdapterRouting);

  d.text(`### 12.8 SDK — 错误码
`);
  await d.yamlTable(sdkTables('sdk-error-codes.yaml'), renderSdkErrorCodes);

  d.text(`### 12.9 SDK — 导入边界
`);
  await d.yamlTable(sdkTables('import-boundaries.yaml'), renderImportBoundaries);

  d.text(`### 12.10 SDK — Runtime 方法投影分组
`);
  await d.yamlTable(sdkTables('runtime-method-groups.yaml'), renderMethodGroups);

  d.text(`### 12.11 Desktop — 启动阶段
`);
  await d.yamlTable(dtTables('bootstrap-phases.yaml'), renderBootstrapPhases);

  d.text(`### 12.12 Desktop — IPC 命令
`);
  await d.yamlTable(dtTables('ipc-commands.yaml'), renderIpcCommands);

  d.text(`### 12.13 Desktop — App Tabs
`);
  await d.yamlTable(dtTables('app-tabs.yaml'), renderAppTabs);

  d.text(`### 12.14 Desktop — Store Slices
`);
  await d.yamlTable(dtTables('store-slices.yaml'), renderStoreSlices);

  d.text(`### 12.15 Desktop — Hook 子系统
`);
  await d.yamlTable(dtTables('hook-subsystems.yaml'), renderHookSubsystems);

  d.text(`### 12.16 Desktop — UI Slots
`);
  await d.yamlTable(dtTables('ui-slots.yaml'), renderUiSlots);

  d.text(`### 12.17 Desktop — Turn Hook Points
`);
  await d.yamlTable(dtTables('turn-hook-points.yaml'), renderTurnHookPoints);

  d.text(`### 12.18 Desktop — Hook Capability Allowlists
`);
  await d.yamlTable(dtTables('hook-capability-allowlists.yaml'), renderHookCapabilityAllowlists);

  d.text(`### 12.19 Desktop — Mod 生命周期状态
`);
  await d.yamlTable(dtTables('mod-lifecycle-states.yaml'), renderModLifecycleStates);

  d.text(`### 12.20 Desktop — Mod 内核阶段
`);
  await d.yamlTable(dtTables('mod-kernel-stages.yaml'), renderModKernelStages);

  d.text(`### 12.21 Desktop — Feature Flags
`);
  await d.yamlTable(dtTables('feature-flags.yaml'), renderFeatureFlags);

  d.text(`### 12.22 Desktop — 数据同步流
`);
  await d.yamlTable(dtTables('data-sync-flows.yaml'), renderDataSyncFlows);

  d.text(`### 12.23 Desktop — 错误码
`);
  await d.yamlTable(dtTables('error-codes.yaml'), renderDesktopErrorCodes);

  d.text(`### 12.24 Desktop — Retry Status Codes
`);
  await d.yamlTable(dtTables('retry-status-codes.yaml'), renderRetryStatusCodes);

  d.text(`### 12.25 Desktop — Log Areas
`);
  await d.yamlTable(dtTables('log-areas.yaml'), renderLogAreas);

  d.text(`### 12.26 Future — Backlog Items
`);
  await d.yamlTable(ftTables('backlog-items.yaml'), renderBacklogItems);

  d.text(`### 12.27 Future — Research Sources
`);
  await d.yamlTable(ftTables('research-sources.yaml'), renderResearchSources);

  d.text(`### 12.28 Future — Graduation Log
`);
  await d.yamlTable(ftTables('graduation-log.yaml'), renderGraduationLog);

  // =========================================================================
  // BUILD
  // =========================================================================

  const output = d.build();

  if (checkMode) {
    let current = '';
    try {
      current = await fs.readFile(outPath, 'utf8');
    } catch {
      process.stderr.write(`spec human doc does not exist: ${path.relative(repoRoot, outPath)}\n`);
      process.stderr.write('run `pnpm generate:spec-human-doc` to generate.\n');
      process.exitCode = 1;
      return;
    }

    const stripDate = (s) => s.replace(/^> 生成时间: .+$/m, '');
    if (stripDate(current) !== stripDate(output)) {
      process.stderr.write(`spec human doc drift detected: ${path.relative(repoRoot, outPath)}\n`);
      process.stderr.write('run `pnpm generate:spec-human-doc` to regenerate.\n');
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

main().catch((error) => {
  process.stderr.write(`generate-spec-human-doc failed: ${String(error)}\n`);
  process.exitCode = 1;
});
