import { promises as fs } from 'node:fs';
import YAML from 'yaml';

const RULE_HEADING_RE = /^##\s+((?:C|K|S|D|P|R|F)-[A-Z]+-\d{3}[a-z]?)\b(?:\s+[—-]\s+(.*)|\s+(.*))?$/;

export function parseKernelRules(content) {
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
    const match = line.match(RULE_HEADING_RE);
    if (match) {
      flush();
      currentId = match[1];
      currentTitle = match[2] || match[3] || '';
      bodyLines = [];
    } else if (currentId) {
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

export async function readYaml(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return YAML.parse(raw);
}

export class DocBuilder {
  constructor(ruleMap) {
    this.ruleMap = ruleMap;
    this.lines = [];
  }

  text(str) {
    this.lines.push(str);
    return this;
  }

  blank() {
    this.lines.push('');
    return this;
  }

  rule(id) {
    const rule = this.ruleMap.get(id);
    if (!rule) {
      this.lines.push(`> *[${id}: 规则未找到]*\n`);
      return this;
    }
    this.lines.push(`**${id} — ${rule.title}**\n`);
    if (rule.body) {
      this.lines.push(rule.body);
    }
    this.lines.push('');
    return this;
  }

  ruleGroup(heading, ids) {
    if (heading) {
      this.lines.push(`${heading}\n`);
    }
    for (const id of ids) {
      this.rule(id);
    }
    return this;
  }

  async yamlTable(filePath, renderer) {
    try {
      const doc = await readYaml(filePath);
      const rendered = renderer(doc);
      if (rendered) {
        this.lines.push(rendered);
      }
    } catch {
      this.lines.push('> *[表格数据未找到]*\n');
    }
    return this;
  }

  build() {
    const output = this.lines.join('\n');
    return `${output.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n')}`;
  }
}

export function renderRpcMethods(doc) {
  const services = doc?.services || [];
  let out = '';
  for (const service of services) {
    out += `**${service.name}**\n\n`;
    out += '| 方法 | 类型 |\n|---|---|\n';
    for (const method of service.methods || []) {
      out += `| ${method.name} | ${method.type} |\n`;
    }
    out += '\n';
  }
  return out;
}

export function renderReasonCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| 名称 | 值 | 族 |\n|---|---:|---|\n';
  for (const code of codes) {
    out += `| ${code.name} | ${code.value} | ${code.family} |\n`;
  }
  return `${out}\n`;
}

export function renderProviderCatalog(doc) {
  const providers = doc?.providers || [];
  let out = '| Provider | 默认 Endpoint | 需显式 Endpoint |\n|---|---|---|\n';
  for (const provider of providers) {
    out += `| ${provider.provider} | ${provider.default_endpoint ?? '—'} | ${provider.requires_explicit_endpoint ? '是' : '否'} |\n`;
  }
  return `${out}\n`;
}

export function renderProviderCapabilities(doc) {
  const providers = doc?.providers || [];
  let out = '| Provider | 执行模块 | Managed | Inline | Endpoint 要求 |\n|---|---|---|---|---|\n';
  for (const provider of providers) {
    out += `| ${provider.provider} | ${provider.execution_module} | ${provider.managed_connector_supported ? '是' : '否'} | ${provider.inline_supported ? '是' : '否'} | ${provider.endpoint_requirement} |\n`;
  }
  return `${out}\n`;
}

export function renderErrorMappingMatrix(doc) {
  const mappings = doc?.mappings || [];
  let out = '| ReasonCode | gRPC Code | 场景 | 出口形态 |\n|---|---|---|---|\n';
  for (const mapping of mappings) {
    out += `| ${mapping.reason_code} | ${mapping.grpc_code} | ${mapping.surface || '—'} | ${mapping.exit_shape || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderJobStates(doc) {
  const states = doc?.states || [];
  let out = '| 状态 | 终态 |\n|---|---|\n';
  for (const state of states) {
    out += `| ${state.state} | ${state.terminal ? '是' : '否'} |\n`;
  }
  return `${out}\n`;
}

export function renderStateTransitions(doc) {
  const machines = doc?.machines || [];
  let out = '';
  for (const machine of machines) {
    out += `**${machine.machine}**\n\n`;
    out += `状态: ${(machine.states || []).join(' → ')}\n\n`;
    out += '| 从 | 到 | 触发条件 |\n|---|---|---|\n';
    for (const transition of machine.transitions || []) {
      out += `| ${transition.from} | ${transition.to} | ${transition.trigger} |\n`;
    }
    out += '\n';
  }
  return out;
}

export function renderKeySourceTruthTable(doc) {
  const cases = doc?.cases || [];
  let out = '| 场景 | key_source | connector_id | inline 凭据 | 有效 | 错误码 |\n|---|---|---|---|---|---|\n';
  for (const entry of cases) {
    const inline = [
      entry.x_nimi_provider_type,
      entry.x_nimi_provider_endpoint,
      entry.x_nimi_provider_api_key,
    ].filter(Boolean).join('/') || '—';
    out += `| ${entry.id} | ${entry.key_source} | ${entry.connector_id || '—'} | ${inline} | ${entry.valid ? '是' : '否'} | ${entry.reason_code || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderLocalEngineCatalog(doc) {
  const engines = doc?.engines || [];
  let out = '| 引擎 | 默认 Endpoint | 运行模式 | 协议 |\n|---|---|---|---|\n';
  for (const engine of engines) {
    out += `| ${engine.engine} | ${engine.default_endpoint || '—'} | ${engine.runtime_mode} | ${engine.protocol} |\n`;
  }
  return `${out}\n`;
}

export function renderLocalAdapterRouting(doc) {
  const routes = doc?.routes || [];
  let out = '| Provider | Capability | Adapter |\n|---|---|---|\n';
  for (const route of routes) {
    out += `| ${route.provider} | ${route.capability} | ${route.adapter} |\n`;
  }
  return `${out}\n`;
}

export function renderSdkErrorCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| 名称 | 族 | 描述 |\n|---|---|---|\n';
  for (const code of codes) {
    out += `| ${code.name} | ${code.family || '—'} | ${code.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderImportBoundaries(doc) {
  const boundaries = doc?.boundaries || [];
  let out = '| 子路径 | 禁止导入 | 基线规则 |\n|---|---|---|\n';
  for (const boundary of boundaries) {
    const forbidden = Array.isArray(boundary.forbidden_imports) ? boundary.forbidden_imports.join(', ') : '—';
    const rules = Array.isArray(boundary.baseline_rules) ? boundary.baseline_rules.join(', ') : '—';
    out += `| ${boundary.surface || boundary.name} | ${forbidden} | ${rules} |\n`;
  }
  return `${out}\n`;
}

export function renderMethodGroups(doc) {
  const groups = doc?.groups || [];
  let out = '';
  for (const group of groups) {
    out += `**${group.group || group.sdk_module || group.name}** → ${group.service || '—'}\n\n`;
    for (const method of group.methods || []) {
      const name = typeof method === 'string' ? method : method.name;
      out += `- ${name}\n`;
    }
    out += '\n';
  }
  return out;
}

export function renderBootstrapPhases(doc) {
  const phases = doc?.phases || [];
  let out = '| 阶段 | 顺序 | 描述 |\n|---|---|---|\n';
  for (const phase of phases) {
    out += `| ${phase.phase || phase.name} | ${phase.order || '—'} | ${phase.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderIpcCommands(doc) {
  const commands = doc?.commands || [];
  let out = '| 命令 | 描述 |\n|---|---|\n';
  for (const command of commands) {
    out += `| ${command.command || command.name} | ${command.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderAppTabs(doc) {
  const tabs = doc?.tabs || [];
  let out = '| Tab ID | 名称 | Nav Group | Feature Gate |\n|---|---|---|---|\n';
  for (const tab of tabs) {
    out += `| ${tab.id || tab.tab_id} | ${tab.label || tab.name} | ${tab.nav_group || '—'} | ${tab.gated_by || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderStoreSlices(doc) {
  const slices = doc?.slices || [];
  let out = '| Slice | 描述 | Factory |\n|---|---|---|\n';
  for (const slice of slices) {
    out += `| ${slice.name} | ${slice.description || '—'} | ${slice.factory || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderHookSubsystems(doc) {
  const subsystems = doc?.subsystems || [];
  let out = '| 子系统 | Namespace | 描述 |\n|---|---|---|\n';
  for (const subsystem of subsystems) {
    out += `| ${subsystem.name} | ${subsystem.namespace || subsystem.capability_prefix || '—'} | ${subsystem.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderUiSlots(doc) {
  const slots = doc?.slots || [];
  let out = '| 槽位 | 描述 |\n|---|---|\n';
  for (const slot of slots) {
    out += `| ${slot.slot || slot.slot_id} | ${slot.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderTurnHookPoints(doc) {
  const points = doc?.points || [];
  let out = '| Hook Point | 执行顺序 | 描述 |\n|---|---|---|\n';
  for (const point of points) {
    out += `| ${point.point || point.name} | ${point.order || '—'} | ${point.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderModLifecycleStates(doc) {
  const states = doc?.states || [];
  let out = '| 状态 | 描述 |\n|---|---|\n';
  for (const state of states) {
    out += `| ${state.state} | ${state.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderModKernelStages(doc) {
  const stages = doc?.stages || [];
  let out = '| 阶段 | 顺序 | 描述 |\n|---|---|---|\n';
  for (const stage of stages) {
    out += `| ${stage.stage || stage.name} | ${stage.order || '—'} | ${stage.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderFeatureFlags(doc) {
  const flags = doc?.flags || [];
  let out = '| Flag | Desktop 默认 | Web 默认 | 描述 |\n|---|---|---|---|\n';
  for (const flag of flags) {
    out += `| ${flag.flag} | ${flag.default_desktop ?? flag.default ?? '—'} | ${flag.default_web ?? '—'} | ${flag.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderDataSyncFlows(doc) {
  const flows = doc?.flows || [];
  let out = '| 领域 | 方法 | 描述 |\n|---|---|---|\n';
  for (const flow of flows) {
    const methods = Array.isArray(flow.methods) ? flow.methods.join(', ') : '—';
    out += `| ${flow.flow || flow.domain} | ${methods} | ${flow.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderRetryStatusCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| Status Code | 原因 |\n|---|---|\n';
  for (const code of codes) {
    out += `| ${code.code} | ${code.reason || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderDesktopErrorCodes(doc) {
  const codes = doc?.codes || [];
  let out = '| Error Code | Domain | 描述 |\n|---|---|---|\n';
  for (const code of codes) {
    out += `| ${code.code} | ${code.domain || '—'} | ${code.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderLogAreas(doc) {
  const areas = doc?.areas || [];
  let out = '| Area | 描述 |\n|---|---|\n';
  for (const area of areas) {
    out += `| ${area.area} | ${area.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderHookCapabilityAllowlists(doc) {
  const allowlists = doc?.source_types || doc?.allowlists || [];
  let out = '| Source Type | 能力模式 | 描述 |\n|---|---|---|\n';
  for (const allowlist of allowlists) {
    const patterns = allowlist.allowlist || allowlist.patterns || [];
    out += `| ${allowlist.source_type} | ${Array.isArray(patterns) ? patterns.join(', ') : '—'} | ${allowlist.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderBacklogItems(doc) {
  const items = doc?.items || [];
  let out = '| Item ID | Title | Priority | Category | Status |\n|---|---|---|---|---|\n';
  for (const item of items) {
    out += `| ${item.item_id} | ${item.title} | ${item.priority} | ${item.category} | ${item.status} |\n`;
  }
  return `${out}\n`;
}

export function renderBuildChunks(doc) {
  const chunks = doc?.chunks || [];
  let out = '| Chunk | 路由模式 | 描述 |\n|---|---|---|\n';
  for (const chunk of chunks) {
    out += `| ${chunk.name} | ${chunk.route_pattern || chunk.pattern || '—'} | ${chunk.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderModAccessModes(doc) {
  const modes = doc?.modes || [];
  let out = '| 模式 | 描述 |\n|---|---|\n';
  for (const mode of modes) {
    out += `| ${mode.name || mode.mode} | ${mode.description || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderResearchSources(doc) {
  const sources = doc?.sources || [];
  let out = '| Source ID | 标题 | 路径 |\n|---|---|---|\n';
  for (const source of sources) {
    out += `| ${source.source_id} | ${source.title || '—'} | ${source.path || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderArtifactFamilies(doc) {
  const families = Array.isArray(doc?.families) ? doc.families : [];
  let out = '| Family | Truth Weight | Persistence | Prompt Lane | Cleanup Lane | Owner Surface |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const family of families) {
    out += `| ${family.family_id || '—'} | ${family.truth_weight || '—'} | ${family.persistence_mode || '—'} | ${family.prompt_lane || '—'} | ${family.cleanup_lane || '—'} | ${family.public_owner_surface || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderPublicSurface(doc) {
  const surfaces = Array.isArray(doc?.surfaces) ? doc.surfaces : [];
  let out = '| Surface ID | Kind | Entrypoint | Owner | Family Scope | Return Contract | Capability Concerns |\n';
  out += '|---|---|---|---|---|---|---|\n';
  for (const surface of surfaces) {
    const concerns = Array.isArray(surface?.capability_concerns) ? surface.capability_concerns.join(', ') : '—';
    out += `| ${surface.surface_id || '—'} | ${surface.surface_kind || '—'} | ${surface.entrypoint || '—'} | ${surface.owner_surface || '—'} | ${surface.family_scope || '—'} | ${surface.return_contract || '—'} | ${concerns || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderRuntimeBridgeBoundary(doc) {
  const boundaries = Array.isArray(doc?.boundaries) ? doc.boundaries : [];
  let out = '| Concern | Cognition Owner | Runtime Owner | Admitted Bridge | Forbidden Owner Inversion |\n';
  out += '|---|---|---|---|---|\n';
  for (const boundary of boundaries) {
    out += `| ${boundary.concern_id || '—'} | ${boundary.cognition_owner || '—'} | ${boundary.runtime_owner || '—'} | ${boundary.admitted_bridge || '—'} | ${boundary.forbidden_owner_inversion || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderRuntimeCapabilityUpgradeMatrix(doc) {
  const capabilities = Array.isArray(doc?.capabilities) ? doc.capabilities : [];
  let out = '| Concern | Runtime Source | Parity Mode | Cognition Owner Surface | Required Floor | Forbidden Downgrade |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const capability of capabilities) {
    out += `| ${capability.concern_id || '—'} | ${capability.runtime_source_contract || '—'} | ${capability.parity_mode || '—'} | ${capability.cognition_owner_surface || '—'} | ${capability.required_floor || '—'} | ${capability.forbidden_downgrade || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderServiceOperations(doc) {
  const operations = Array.isArray(doc?.operations) ? doc.operations : [];
  let out = '| Operation | Entrypoint | Inputs | Validation | Lifecycle Effects | Fail-Close Reasons |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const operation of operations) {
    out += `| ${operation.operation_id || '—'} | ${operation.entrypoint || '—'} | ${operation.admitted_inputs || '—'} | ${operation.validation || '—'} | ${operation.lifecycle_effects || '—'} | ${operation.fail_closed_reasons || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderAdmittedReferenceMatrix(doc) {
  const families = Array.isArray(doc?.families) ? doc.families : [];
  let out = '| Family | Allowed Outgoing | Allowed Incoming | Missing Target On Save | Missing Target On Archive | Missing Target On Remove |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const family of families) {
    const outgoing = Array.isArray(family?.allowed_outgoing_refs) ? family.allowed_outgoing_refs.join(', ') : '—';
    const incoming = Array.isArray(family?.allowed_incoming_refs) ? family.allowed_incoming_refs.join(', ') : '—';
    out += `| ${family.family_id || '—'} | ${outgoing || '—'} | ${incoming || '—'} | ${family.missing_target_on_save || '—'} | ${family.missing_target_on_archive || '—'} | ${family.missing_target_on_remove || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderPromptServingLanes(doc) {
  const lanes = Array.isArray(doc?.lanes) ? doc.lanes : [];
  let out = '| Lane | Order | Families | Inputs | Derived Source | Forbidden Inputs |\n';
  out += '|---|---|---|---|---|---|\n';
  for (const lane of lanes) {
    const families = Array.isArray(lane?.admitted_families) ? lane.admitted_families.join(', ') : '—';
    const forbidden = Array.isArray(lane?.forbidden_inputs) ? lane.forbidden_inputs.join(', ') : '—';
    out += `| ${lane.lane_id || '—'} | ${lane.serving_order || '—'} | ${families || '—'} | ${lane.admitted_inputs || '—'} | ${lane.derived_view_source || '—'} | ${forbidden || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderCompletionGates(doc) {
  const gates = Array.isArray(doc?.gates) ? doc.gates : [];
  let out = '| Gate | Closure Class | Statement | Minimum Evidence | Failure Condition |\n';
  out += '|---|---|---|---|---|\n';
  for (const gate of gates) {
    out += `| ${gate.gate_id || '—'} | ${gate.closure_class || '—'} | ${gate.gate_statement || '—'} | ${gate.minimum_evidence || '—'} | ${gate.failure_condition || '—'} |\n`;
  }
  return `${out}\n`;
}

export function renderRuleEvidence(doc) {
  const rules = Array.isArray(doc?.rules) ? doc.rules : [];
  let out = '| Rule ID | Status | Evidence Refs | Note |\n';
  out += '|---|---|---|---|\n';
  for (const rule of rules) {
    const ruleID = String(rule?.rule_id || '').trim();
    if (!ruleID) continue;
    const status = String(rule?.status || '').trim() || 'unknown';
    const refs = Array.isArray(rule?.evidence_refs)
      ? rule.evidence_refs.map((value) => `\`${String(value)}\``).join(', ')
      : '—';
    const note = String(rule?.note || '').trim() || '—';
    out += `| ${ruleID} | ${status} | ${refs} | ${note} |\n`;
  }
  return `${out}\n`;
}

export function renderGraduationLog(doc) {
  const entries = doc?.entries || [];
  if (entries.length === 0) {
    return '> *暂无毕业记录*\n';
  }
  let out = '| Item ID | 毕业日期 | 目标 Spec |\n|---|---|---|\n';
  for (const entry of entries) {
    out += `| ${entry.item_id} | ${entry.graduated_at || '—'} | ${entry.target_spec || '—'} |\n`;
  }
  return `${out}\n`;
}

export const runtimeKernelFiles = [
  'rpc-surface.md', 'authz-ownership.md', 'authn-token-validation.md',
  'auth-service.md', 'grant-service.md', 'key-source-routing.md',
  'scenario-job-lifecycle.md', 'local-category-capability.md',
  'local-engine-contract.md', 'device-profile-contract.md',
  'endpoint-security.md',
  'streaming-contract.md', 'error-model.md', 'pagination-filtering.md', 'audit-contract.md',
  'daemon-lifecycle.md', 'provider-health-contract.md', 'workflow-contract.md',
  'model-service-contract.md', 'knowledge-contract.md', 'app-messaging-contract.md',
  'cli-onboarding-contract.md',
  'config-contract.md', 'connector-contract.md',
  'nimillm-contract.md', 'multimodal-provider-contract.md', 'delivery-gates-contract.md',
  'proto-governance-contract.md',
  'ai-profile-execution-contract.md',
  'world-evolution-engine-contract.md',
];

export const cognitionKernelFiles = [
  'cognition-contract.md',
  'family-contract.md',
  'surface-contract.md',
  'runtime-bridge-contract.md',
  'runtime-upgrade-contract.md',
  'memory-service-contract.md',
  'knowledge-service-contract.md',
  'skill-service-contract.md',
  'reference-contract.md',
  'prompt-serving-contract.md',
  'completion-contract.md',
];

export const sdkKernelFiles = [
  'surface-contract.md', 'transport-contract.md',
  'error-projection.md', 'boundary-contract.md',
  'runtime-contract.md', 'world-evolution-engine-projection-contract.md',
  'realm-contract.md', 'ai-provider-contract.md',
  'scope-contract.md', 'mod-contract.md', 'testing-gates-contract.md',
  'ai-config-surface-contract.md',
];

export const desktopKernelFiles = [
  'bootstrap-contract.md', 'bridge-ipc-contract.md', 'state-contract.md',
  'auth-session-contract.md', 'data-sync-contract.md', 'hook-capability-contract.md',
  'mod-governance-contract.md', 'llm-adapter-contract.md', 'ui-shell-contract.md',
  'error-boundary-contract.md', 'telemetry-contract.md', 'network-contract.md',
  'security-contract.md', 'streaming-consumption-contract.md', 'offline-degradation-contract.md',
  'codegen-contract.md', 'testing-gates-contract.md',
  'ai-profile-config-contract.md', 'conversation-capability-contract.md',
];

export const futureKernelFiles = [
  'capability-backlog.md', 'source-registry.md', 'graduation-contract.md',
];

export const platformKernelFiles = [
  'protocol-contract.md',
  'architecture-contract.md',
  'ai-last-mile-contract.md',
  'governance-contract.md',
  'ai-scope-contract.md',
];

export const realmKernelFiles = [
  'boundary-vocabulary-contract.md',
  'economy-contract.md',
  'interop-mapping-contract.md',
];
