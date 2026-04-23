import { emitKeypressEvents } from "node:readline";
import process from "node:process";
import path from "node:path";

import {
  buildHandoffPayload,
  formatDoctorResult,
  formatStartPastePrompt,
  getStartHostOption,
  inspectBootstrapCompatibility,
  inspectDoctorState,
  integrateEntrypoints,
  pathExists,
  previewBootstrapWrites,
  previewEntrypointIntegration,
  resolveStartHostChoice,
  START_HOST_OPTIONS,
  writeHandoffJsonArtifact,
  writeMissingBootstrapFiles,
} from "../lib/shared.mjs";
import {
  configureCliUi,
  getCliColorEnabled,
  getCliLocale,
  isCliLocalePinned,
  localize,
  styleCommand,
  styleHeading,
  styleLabel,
  styleMuted,
} from "../lib/ui.mjs";

function parseStartOptions(args) {
  const options = {
    yes: false,
    host: null,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--yes") {
      options.yes = true;
      continue;
    }

    if (arg === "--host") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        return {
          ok: false,
          error: `${localize(
            "nimicoding start refused: --host requires one of `generic`, `codex`, `claude`, or `oh-my-codex`.",
            "nimicoding start 已拒绝：--host 需要 `generic`、`codex`、`claude` 或 `oh-my-codex` 之一。",
          )}\n`,
        };
      }
      if (!getStartHostOption(next)) {
        return {
          ok: false,
          error: `${localize(
            `nimicoding start refused: unsupported --host value ${next}.`,
            `nimicoding start 已拒绝：不支持的 --host 值 ${next}。`,
          )}\n`,
        };
      }
      options.host = next;
      index += 1;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding start refused: unknown option ${arg}.`,
        `nimicoding start 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  return { ok: true, options };
}

function canPromptInteractively() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function buildStartBanner() {
  const lines = [
    " _   _ ___ __  __ ___    ____ ___  ____  ___ _   _  ____ ",
    "| \\ | |_ _|  \\/  |_ _|  / ___/ _ \\|  _ \\|_ _| \\ | |/ ___|",
    "|  \\| || || |\\/| || |  | |  | | | | | | || ||  \\| | |  _ ",
    "| |\\  || || |  | || |  | |__| |_| | |_| || || |\\  | |_| |",
    "|_| \\_|___|_|  |_|___|  \\____\\___/|____/|___|_| \\_|\\____|",
  ];

  return `${lines.map((line) => styleHeading(line)).join("\n")}
${styleMuted(localize(
    "Bootstrap, project guidance, and next-step AI task preparation",
    "Bootstrap、项目指导与下一步 AI 任务准备",
  ))}`;
}

function formatSectionTitle(index, title) {
  return styleLabel(`${index}. ${title}`);
}

function formatSectionDivider() {
  return styleMuted("────────────────────────────────────────");
}

async function maybeSelectLanguage(options) {
  if (options.yes || !canPromptInteractively() || isCliLocalePinned()) {
    return;
  }

  const currentLocale = getCliLocale();
  const choice = await chooseWithArrowKeys(
    "Language / 语言",
    [
      {
        value: "en",
        label: "English",
        description: "Use English for interactive output",
      },
      {
        value: "zh",
        label: "中文",
        description: "使用中文进行交互输出",
      },
    ],
    currentLocale === "zh" ? 1 : 0,
  );

  configureCliUi({
    locale: choice.value,
    colorEnabled: getCliColorEnabled(),
  });
}

async function chooseWithArrowKeys(title, options, initialIndex = 0) {
  const input = process.stdin;
  const output = process.stdout;
  const previousRawMode = input.isRaw;
  let selectedIndex = initialIndex;
  let renderedLines = 0;

  emitKeypressEvents(input);
  if (input.setRawMode) {
    input.setRawMode(true);
  }

  function render() {
    const lines = [
      title,
      ...options.map((option, index) => {
        const prefix = index === selectedIndex ? styleCommand("›") : " ";
        return `${prefix} ${option.label}${option.description ? styleMuted(` - ${option.description}`) : ""}`;
      }),
      styleMuted(localize("Use ↑/↓ and Enter to choose.", "使用 ↑/↓ 和 Enter 进行选择。")),
    ];

    if (renderedLines > 0) {
      output.write(`\u001B[${renderedLines}A\u001B[0J`);
    }

    output.write(`${lines.join("\n")}\n`);
    renderedLines = lines.length;
  }

  return new Promise((resolve, reject) => {
    function cleanup() {
      input.off("keypress", onKeypress);
      if (input.setRawMode) {
        input.setRawMode(Boolean(previousRawMode));
      }
    }

    function finish(value) {
      output.write(`\u001B[${renderedLines}A\u001B[0J`);
      cleanup();
      resolve(value);
    }

    function fail(error) {
      output.write(`\u001B[${renderedLines}A\u001B[0J`);
      cleanup();
      reject(error);
    }

    function onKeypress(_, key) {
      if (!key) {
        return;
      }

      if (key.name === "up") {
        selectedIndex = (selectedIndex - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === "down") {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
        return;
      }

      if (key.name === "return") {
        finish(options[selectedIndex]);
        return;
      }

      if (key.ctrl && key.name === "c") {
        fail(new Error("SIGINT"));
      }
    }

    render();
    input.on("keypress", onKeypress);
  });
}

function buildBootstrapStageLines(preview) {
  const lines = [
    styleLabel(localize("Scope", "范围")),
    styleMuted(localize(
      "  - prepare the local nimicoding bootstrap surface under `.nimi/**`",
      "  - 准备 `.nimi/**` 下的本地 nimicoding bootstrap 面",
    )),
    styleLabel(localize("Writes", "写入内容")),
  ];

  if (!preview.hasWork) {
    lines.push(styleMuted(localize("  - no bootstrap writes are needed in this run", "  - 本次运行不需要写入 bootstrap 内容")));
    lines.push(styleLabel(localize("Keeps", "保留内容")));
    lines.push(styleMuted(localize("  - existing project rules remain unchanged", "  - 现有项目规则保持不变")));
    return lines;
  }

  if (preview.missingFiles.length > 0) {
    lines.push(styleMuted(localize(
      "  - create the missing `.nimi/**` bootstrap files:",
      "  - 创建缺失的 `.nimi/**` bootstrap 文件：",
    )));
    for (const filePath of preview.missingFiles) {
      lines.push(`    - ${filePath}`);
    }
  }

  if (preview.missingDirs.length > 0) {
    lines.push(styleMuted(localize(
      "  - create the missing local work directories:",
      "  - 创建缺失的本地工作目录：",
    )));
    for (const dirPath of preview.missingDirs) {
      lines.push(`    - ${dirPath}/`);
    }
  }

  if (preview.missingGitignoreEntries.length > 0) {
    lines.push(styleMuted(localize(
      "  - update `.gitignore` so local nimicoding state and topic workspaces remain untracked by default",
      "  - 更新 `.gitignore`，默认避免本地 nimicoding 状态和 topic 工作区被跟踪",
    )));
  }

  lines.push(styleLabel(localize("Keeps", "保留内容")));
  lines.push(styleMuted(localize(
    "  - existing `.nimi/**` files are not overwritten",
    "  - 现有 `.nimi/**` 文件不会被覆盖",
  )));

  return lines;
}

function buildEntrypointStageLines(updates) {
  const lines = [
    styleLabel(localize("Scope", "范围")),
    styleMuted(localize(
      "  - update the managed guidance blocks used by external coding hosts",
      "  - 更新供外部编码宿主使用的托管指导区块",
    )),
    styleLabel(localize("Writes", "写入内容")),
  ];

  if (updates.length === 0) {
    lines.push(styleMuted(localize("  - no entry file updates are needed in this run", "  - 本次运行不需要更新入口文件")));
    lines.push(styleLabel(localize("Keeps", "保留内容")));
    lines.push(styleMuted(localize(
      "  - project-specific content outside the managed block remains unchanged",
      "  - 托管区块之外的项目内容保持不变",
    )));
    return lines;
  }

  lines.push(styleMuted(localize(
    "  - update the managed guidance blocks in:",
    "  - 更新以下文件中的托管指导区块：",
  )));
  for (const filePath of updates) {
    lines.push(`    - ${filePath}`);
  }
  lines.push(styleLabel(localize("Keeps", "保留内容")));
  lines.push(styleMuted(localize(
    "  - only the nimicoding-managed block is updated",
    "  - 只有 nimicoding 托管区块会被更新",
  )));
  return lines;
}

function buildTaskStageLines(mode) {
  const lines = [
    styleLabel(localize("Scope", "范围")),
    styleMuted(localize(
      mode === "reconstruction"
        ? "  - prepare the reconstruction task package for an external AI host"
        : "  - prepare the doc/spec audit task package for an external AI host",
      mode === "reconstruction"
        ? "  - 为外部 AI Host 准备 reconstruction 任务包"
        : "  - 为外部 AI Host 准备 doc/spec audit 任务包",
    )),
    styleLabel(localize("Writes", "写入内容")),
    styleMuted(localize(
      "  - one authoritative JSON contract for the task",
      "  - 一个用于该任务的权威 JSON 契约",
    )),
    styleMuted(localize(
      "  - one short prompt that can be pasted directly into the selected host",
      "  - 一段可直接粘贴到所选 Host 的短 prompt",
    )),
    styleLabel(localize("Keeps", "保留内容")),
    styleMuted(localize(
      "  - the JSON file remains the source of truth",
      "  - JSON 文件仍然是权威真相源",
    )),
    styleMuted(localize(
      "  - the short prompt remains a compact instruction layer only",
      "  - 短 prompt 仅作为紧凑指令层使用",
    )),
  ];

  return lines;
}

function canonicalTreeReady(doctorResult) {
  return doctorResult.lifecycleState?.treeState === "canonical_tree_ready"
    && doctorResult.canonicalTree?.requiredFilesValid === true;
}

function determineWizardStage(doctorResult) {
  if (!canonicalTreeReady(doctorResult)) {
    return {
      title: localize("Step 3. Rebuild project rules", "第 3 步：重建项目规则"),
      detail: localize(
        "Bootstrap is ready. The next action is to hand the reconstruction task package to an external AI host.",
        "bootstrap 已就绪。下一步是将 reconstruction 任务包交给外部 AI Host。",
      ),
    };
  }

  if (!doctorResult.auditArtifact.present) {
    return {
      title: localize("Step 4. Run a doc/spec audit", "第 4 步：执行 doc/spec 审计"),
      detail: localize(
        "Project rules are present. The next action is to hand the audit package to an external AI host and review the result locally.",
        "项目规则已存在。下一步是将 audit 任务包交给外部 AI Host，并在本地审阅结果。",
      ),
    };
  }

  return {
    title: localize("Ready", "已就绪"),
    detail: localize(
      "Bootstrap and project rules are aligned. The project is ready for the next approved task.",
      "bootstrap 与项目规则已对齐。当前可以继续下一项已批准任务。",
    ),
  };
}

function isReconstructionContinuable(doctorResult) {
  if (canonicalTreeReady(doctorResult)) {
    return false;
  }

  const blockingChecks = doctorResult.checks.filter((check) => check.severity === "error");
  if (blockingChecks.length === 0) {
    return true;
  }

  const tolerated = new Set([
    "canonical_tree_progress",
    "bootstrap_lifecycle_alignment",
    "doc_spec_audit_state_alignment",
  ]);

  return blockingChecks.every((check) => tolerated.has(check.id));
}

function printStage(title, bodyLines) {
  process.stdout.write(`${styleHeading(title)}\n${formatSectionDivider()}\n${bodyLines.join("\n")}\n\n`);
}

async function maybeApproveStage(options, prompt, defaultAnswer = true) {
  if (options.yes || !canPromptInteractively()) {
    return true;
  }

  const choice = await chooseWithArrowKeys(prompt, [
    {
      value: true,
      label: localize("Apply stage", "执行此阶段"),
      description: localize("continue and write the planned changes", "继续并写入计划中的变更"),
    },
    {
      value: false,
      label: localize("Skip for now", "暂时跳过"),
      description: localize("leave this stage unchanged in this run", "本次运行中不处理这一阶段"),
    },
  ], defaultAnswer ? 0 : 1);

  return choice.value;
}

async function chooseExternalHost(options, payload) {
  const resolvedHost = resolveStartHostChoice(options.host, payload);
  if (options.yes || !canPromptInteractively()) {
    return resolvedHost;
  }

  const choice = await chooseWithArrowKeys(
    localize(
      "Select the external host that will receive the short prompt:",
      "选择将接收这段短 prompt 的外部 Host：",
    ),
    START_HOST_OPTIONS.map((option) => ({
      value: option.id,
      label: localize(option.label, option.zhLabel),
      description: localize(option.description, option.zhDescription),
    })),
    Math.max(START_HOST_OPTIONS.findIndex((option) => option.id === resolvedHost), 0),
  );

  return choice.value;
}

async function maybePrepareHandoff(projectRoot, options, skillId, title, detail) {
  const payload = await buildHandoffPayload(projectRoot, skillId);
  if (!payload.ok) {
    return {
      ok: false,
      payload,
      refs: null,
    };
  }

  const approved = await maybeApproveStage(
    options,
    localize(
      `Apply this stage and prepare the next AI task package for ${title}?`,
      `执行这一阶段并为 ${title} 准备下一步 AI 任务包吗？`,
    ),
    true,
  );

  if (!approved) {
    return {
      ok: true,
      skipped: true,
      payload,
      refs: null,
      detail,
      hostId: null,
      pastePrompt: null,
    };
  }

  const hostId = await chooseExternalHost(options, payload);
  const refs = await writeHandoffJsonArtifact(projectRoot, payload);
  const pastePrompt = formatStartPastePrompt(payload, {
    hostId,
    jsonRef: refs.jsonRef,
  });

  return {
    ok: true,
    skipped: false,
    payload,
    refs,
    detail,
    hostId,
    pastePrompt,
  };
}

export async function runStart(args) {
  const parsed = parseStartOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  try {
    await maybeSelectLanguage(parsed.options);

    const projectRoot = process.cwd();
    const nimiRoot = path.join(projectRoot, ".nimi");
    const nimiInfo = await pathExists(nimiRoot);

    if (nimiInfo && !nimiInfo.isDirectory()) {
      process.stderr.write(`${localize(
        `nimicoding start refused: ${nimiRoot} exists and is not a directory.`,
        `nimicoding start 已拒绝：${nimiRoot} 已存在且不是目录。`,
      )}\n`);
      return 2;
    }

    const compatibility = await inspectBootstrapCompatibility(projectRoot);
    if (compatibility.status === "unsupported") {
      process.stderr.write(`${localize(
        "nimicoding start refused: bootstrap.yaml declares an unsupported bootstrap contract id or version.",
        "nimicoding start 已拒绝：bootstrap.yaml 声明了不受支持的 bootstrap contract id 或 version。",
      )}\n`);
      return 1;
    }

    const bootstrapPreview = await previewBootstrapWrites(projectRoot);
    const entrypointPreview = await previewEntrypointIntegration(projectRoot);

    if (canPromptInteractively() && !parsed.options.yes) {
      process.stdout.write(`${buildStartBanner()}

${styleHeading(localize(`nimicoding start wizard for ${projectRoot}`, `nimicoding start 向导：${projectRoot}`))}

${styleMuted(localize(
  "Project inspection complete. Start runs in ordered stages. Each stage is previewed first, then confirmed, then applied.",
  "项目检查已完成。start 会按顺序执行各阶段。每个阶段都会先预览、再确认、再执行。",
))}

`);
    }

    const applied = {
      bootstrap: null,
      entrypoints: null,
      handoff: null,
    };

    if (bootstrapPreview.hasWork) {
      if (canPromptInteractively() && !parsed.options.yes) {
        printStage(
          localize("Step 1. Set up project files", "第 1 步：准备项目文件"),
          buildBootstrapStageLines(bootstrapPreview),
        );
      }

      const approved = await maybeApproveStage(
        parsed.options,
        localize(
          "Apply stage 1 and create the missing local .nimi bootstrap files?",
          "执行第 1 阶段并创建缺失的本地 .nimi bootstrap 文件吗？",
        ),
        true,
      );

      if (approved) {
        applied.bootstrap = await writeMissingBootstrapFiles(projectRoot);
      }
    }

    if (entrypointPreview.length > 0) {
      if (canPromptInteractively() && !parsed.options.yes) {
        printStage(
          localize("Step 2. Connect AI entry files", "第 2 步：接入 AI 入口文件"),
          buildEntrypointStageLines(entrypointPreview),
        );
      }

      const approved = await maybeApproveStage(
        parsed.options,
        localize(
          "Apply stage 2 and update the managed guidance blocks in AGENTS.md / CLAUDE.md?",
          "执行第 2 阶段并更新 AGENTS.md / CLAUDE.md 中的托管指导区块吗？",
        ),
        true,
      );

      if (approved) {
        applied.entrypoints = await integrateEntrypoints(projectRoot);
      }
    }

    const doctorResult = await inspectDoctorState(projectRoot);

    if (!doctorResult.ok && !isReconstructionContinuable(doctorResult)) {
      process.stdout.write(`${styleHeading(localize("nimicoding start paused", "nimicoding start 已暂停"))}

${styleMuted(localize(
  "Blocking diagnostic errors are present. Review the doctor output below before continuing.",
  "当前存在阻塞性的诊断错误。继续前请先查看下面的 doctor 输出。",
))}

${formatDoctorResult(doctorResult)}`);
      return 1;
    }

    if (!canonicalTreeReady(doctorResult)) {
      if (canPromptInteractively() && !parsed.options.yes) {
        printStage(
          localize("Step 3. Prepare the next AI task", "第 3 步：准备下一项 AI 任务"),
          buildTaskStageLines("reconstruction"),
        );
      }

      applied.handoff = await maybePrepareHandoff(
        projectRoot,
        parsed.options,
        "spec_reconstruction",
        localize("spec reconstruction", "spec reconstruction"),
        localize(
          "Prepare an AI task package for spec reconstruction.",
          "为 spec reconstruction 准备 AI 任务包。",
        ),
      );
    } else if (!doctorResult.auditArtifact.present) {
      if (canPromptInteractively() && !parsed.options.yes) {
        printStage(
          localize("Step 3. Prepare the next AI task", "第 3 步：准备下一项 AI 任务"),
          buildTaskStageLines("audit"),
        );
      }

      applied.handoff = await maybePrepareHandoff(
        projectRoot,
        parsed.options,
        "doc_spec_audit",
        localize("doc spec audit", "doc spec audit"),
        localize(
          "Prepare an AI task package for doc/spec audit.",
          "为 doc/spec audit 准备 AI 任务包。",
        ),
      );
    }

    const continuationLines = [];
    if (applied.handoff?.refs) {
      continuationLines.push(`  - ${localize("AI task package", "AI 任务包")}: ${applied.handoff.refs.jsonRef}`);
      continuationLines.push(`  - ${localize("selected host", "已选择的 Host")}: ${localize(getStartHostOption(applied.handoff.hostId)?.label ?? "Generic external host", getStartHostOption(applied.handoff.hostId)?.zhLabel ?? "通用外部 Host")}`);
    } else if (applied.handoff?.skipped) {
      continuationLines.push(`  - ${localize("AI task package preparation was skipped for now", "本次已跳过 AI 任务包准备")}`);
    } else if (canonicalTreeReady(doctorResult) && doctorResult.auditArtifact.present) {
      continuationLines.push(`  - ${localize("no AI task package is needed right now", "当前不需要准备 AI 任务包")}`);
    }

    const completedLines = [
      ...(applied.bootstrap
        ? [
          ...((applied.bootstrap.createdFiles ?? []).map((filePath) => `  - ${localize("created", "已创建")}: ${filePath}`)),
          ...((applied.bootstrap.createdDirs ?? []).map((dirPath) => `  - ${localize("created", "已创建")}: ${dirPath}/`)),
          ...((applied.bootstrap.gitignoreUpdated ?? false) ? [`  - ${localize("updated", "已更新")}: .gitignore`] : []),
        ]
        : []),
      ...((applied.entrypoints ?? []).map((filePath) => `  - ${localize("updated", "已更新")}: ${filePath}`)),
    ];

    const wizardStage = determineWizardStage(doctorResult);
    const pastePromptSection = applied.handoff?.pastePrompt
      ? `${formatSectionTitle(4, localize("Paste Prompt", "可粘贴 Prompt"))}
${formatSectionDivider()}
${applied.handoff.pastePrompt.split("\n").filter(Boolean).map((line) => `  ${line}`).join("\n")}

`
      : "";

    process.stdout.write(`${styleHeading(localize(`nimicoding start wizard: ${projectRoot}`, `nimicoding start 向导：${projectRoot}`))}

${formatSectionTitle(1, localize("Current Step", "当前步骤"))}
${formatSectionDivider()}
  - ${wizardStage.title}
  - ${wizardStage.detail}

${formatSectionTitle(2, localize("Changes Applied", "已执行变更"))}
${formatSectionDivider()}
${completedLines.length > 0 ? completedLines.join("\n") : localize("  - no new changes were needed in this run", "  - 本次运行不需要新增任何变更")}

${formatSectionTitle(3, localize("Outputs Ready", "已准备输出"))}
${formatSectionDivider()}
${continuationLines.length > 0 ? continuationLines.join("\n") : localize("  - no additional staged outputs", "  - 没有额外阶段输出")}

${pastePromptSection}${formatSectionTitle(applied.handoff?.pastePrompt ? 5 : 4, localize("Next Action", "下一步操作"))}
${formatSectionDivider()}
  - ${applied.handoff?.refs
    ? localize(
      `Paste the short prompt above into the selected external AI host. Keep ${applied.handoff.refs.jsonRef} as the authoritative machine contract.`,
      `把上面的短 prompt 粘贴给所选外部 AI Host，并把 ${applied.handoff.refs.jsonRef} 作为权威机器契约保留。`,
    )
    : localize(
      "Continue with the next admitted project task. If a full diagnostic snapshot is needed, run `nimicoding doctor`.",
      "继续执行项目中的下一项已准入任务。如果需要完整诊断快照，请运行 `nimicoding doctor`。",
    )}

${styleMuted(localize("Need more detail? Run `nimicoding doctor`.", "如果你需要更多细节，请运行 `nimicoding doctor`。"))}
`);

    return 0;
  } catch (error) {
    if (error instanceof Error && error.message === "SIGINT") {
      process.stderr.write(`${localize(
        "nimicoding start canceled.\n",
        "nimicoding start 已取消。\n",
      )}`);
      return 130;
    }
    throw error;
  }
}

export { parseStartOptions };
