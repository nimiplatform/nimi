import { createInterface } from "node:readline/promises";
import process from "node:process";

import {
  previewBootstrapRemoval,
  previewEntrypointRemoval,
  removeManagedBootstrapFiles,
  removeManagedEntrypoints,
} from "../lib/shared.mjs";
import {
  localize,
  styleHeading,
  styleLabel,
  styleMuted,
} from "../lib/ui.mjs";

function parseClearOptions(args) {
  const options = {
    yes: false,
  };

  for (const arg of args) {
    if (arg === "--yes") {
      options.yes = true;
      continue;
    }

    return {
      ok: false,
      error: `${localize(
        `nimicoding clear refused: unknown option ${arg}.`,
        `nimicoding clear 已拒绝：未知选项 ${arg}。`,
      )}\n`,
    };
  }

  return { ok: true, options };
}

function canPromptInteractively() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

async function confirmClear(prompt) {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = (await rl.question(`${prompt}${localize(" [Y/n] ", " [Y/n] ")}`)).trim().toLowerCase();
    if (answer.length === 0) {
      return true;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function formatList(items, emptyLine) {
  return items.length > 0 ? items.map((item) => `  - ${item}`).join("\n") : emptyLine;
}

export async function runClear(args) {
  const parsed = parseClearOptions(args);
  if (!parsed.ok) {
    process.stderr.write(parsed.error);
    return 2;
  }

  const projectRoot = process.cwd();
  const entrypointPreview = await previewEntrypointRemoval(projectRoot);
  const bootstrapPreview = await previewBootstrapRemoval(projectRoot);

  if (canPromptInteractively() && !parsed.options.yes) {
    process.stdout.write(`${styleHeading(localize(`nimicoding clear: ${projectRoot}`, `nimicoding clear：${projectRoot}`))}

${styleLabel(localize("What I can clear:", "我可以清理的内容："))}
${formatList(
  [
    ...entrypointPreview.map((filePath) => `${localize("managed AI block in", "托管 AI 区块：")} ${filePath}`),
    ...bootstrapPreview.removableFiles,
  ],
  localize("  - no nimicoding-managed files are ready to clear", "  - 当前没有可清理的 nimicoding 托管文件"),
)}

${styleLabel(localize("What I will keep:", "我会保留的内容："))}
  - .nimi/spec/**
  - .nimi/local/**
  - .nimi/cache/**
${bootstrapPreview.preservedModifiedFiles.length > 0
    ? `\n${styleMuted(localize("I also found package-owned bootstrap files that were changed locally, so I will leave them in place:", "我还发现了一些包拥有的 bootstrap 文件已被本地修改，因此我会保留它们："))}\n${bootstrapPreview.preservedModifiedFiles.map((filePath) => `  - ${filePath}`).join("\n")}`
    : ""}

`);
  }

  const hasWork = entrypointPreview.length > 0 || bootstrapPreview.removableFiles.length > 0;
  if (!hasWork && bootstrapPreview.preservedModifiedFiles.length === 0) {
    process.stdout.write(`${styleHeading(localize(`nimicoding clear: ${projectRoot}`, `nimicoding clear：${projectRoot}`))}

${styleLabel(localize("What I cleared:", "我已清理的内容："))}
${localize("  - nothing needed clearing", "  - 没有需要清理的内容")}

${styleLabel(localize("What I kept:", "我保留的内容："))}
  - .nimi/spec/**
  - .nimi/local/**
  - .nimi/cache/**

${styleMuted(localize("No nimicoding-managed bootstrap files or managed AI blocks were found.", "没有检测到 nimicoding 托管的 bootstrap 文件或托管 AI 区块。"))}
`);
    return 0;
  }

  if (!parsed.options.yes && canPromptInteractively()) {
    const approved = await confirmClear(localize(
      "Clear the nimicoding-managed setup now?",
      "现在清理 nimicoding 托管的项目初始化内容吗？",
    ));
    if (!approved) {
      process.stdout.write(`${styleHeading(localize("nimicoding clear canceled", "nimicoding clear 已取消"))}

${styleMuted(localize("No files were changed.", "没有修改任何文件。"))}
`);
      return 0;
    }
  }

  const removedEntrypoints = await removeManagedEntrypoints(projectRoot);
  const removedBootstrap = await removeManagedBootstrapFiles(projectRoot);

  process.stdout.write(`${styleHeading(localize(`nimicoding clear: ${projectRoot}`, `nimicoding clear：${projectRoot}`))}

${styleLabel(localize("What I cleared:", "我已清理的内容："))}
${formatList(
  [
    ...removedEntrypoints.updatedFiles.map((filePath) => `${localize("updated", "已更新")}: ${filePath}`),
    ...removedEntrypoints.removedFiles.map((filePath) => `${localize("removed", "已移除")}: ${filePath}`),
    ...removedBootstrap.removedFiles.map((filePath) => `${localize("removed", "已移除")}: ${filePath}`),
    ...removedBootstrap.removedDirs.map((dirPath) => `${localize("removed empty dir", "已移除空目录")}: ${dirPath}/`),
  ],
  localize("  - nothing was cleared", "  - 没有清理任何内容"),
)}

${styleLabel(localize("What I kept:", "我保留的内容："))}
  - .nimi/spec/**
  - .nimi/local/**
  - .nimi/cache/**
${removedBootstrap.preservedModifiedFiles.length > 0
    ? `\n${removedBootstrap.preservedModifiedFiles.map((filePath) => `  - ${localize("kept because it was modified", "已保留，因为它已被修改")}: ${filePath}`).join("\n")}`
    : ""}

${styleLabel(localize("What You Should Review Next:", "你下一步应该检查什么："))}
  - ${localize(
    "If you want to fully remove project-local AI truth, review .nimi/spec/** and local artifacts manually.",
    "如果你想完整移除项目本地 AI truth，请手动检查 .nimi/spec/** 和本地产物。",
  )}
  - ${localize(
    "If you want nimicoding again later, run `nimicoding start`.",
    "如果以后还要重新接入 nimicoding，请运行 `nimicoding start`。",
  )}
`);

  return 0;
}

export { parseClearOptions };
