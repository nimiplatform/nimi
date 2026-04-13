import path from "node:path";
import { readdir } from "node:fs/promises";

import { readTextIfFile } from "../fs-helpers.mjs";

function posixRelative(targetRoot, absolutePath) {
  return path.relative(targetRoot, absolutePath).split(path.sep).join(path.posix.sep);
}

export async function collectTreeFiles(rootPath) {
  const text = await readTextIfFile(path.join(rootPath, "INDEX.md"));
  if (text === null) {
    const info = await readTextIfFile(rootPath);
    if (info !== null) {
      return [];
    }
  }

  async function walk(currentPath) {
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return [];
    }

    const files = [];
    for (const entry of entries) {
      const childPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...await walk(childPath));
      } else if (entry.isFile()) {
        files.push(posixRelative(rootPath, childPath));
      }
    }
    return files.sort();
  }

  return walk(rootPath);
}

function escapeRegexLiteral(value) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegex(pattern) {
  const DOUBLE_STAR_SLASH = "__DOUBLE_STAR_SLASH__";
  const DOUBLE_STAR = "__DOUBLE_STAR__";
  const SINGLE_STAR = "__SINGLE_STAR__";

  let source = pattern
    .replaceAll("**/", DOUBLE_STAR_SLASH)
    .replaceAll("**", DOUBLE_STAR)
    .replaceAll("*", SINGLE_STAR);

  source = escapeRegexLiteral(source)
    .replaceAll(DOUBLE_STAR_SLASH, "(?:.*/)?")
    .replaceAll(DOUBLE_STAR, ".*")
    .replaceAll(SINGLE_STAR, "[^/]*");

  return new RegExp(`^${source}$`);
}

function compilePathClassMatchers(specTreeModel) {
  const classes = [
    ...specTreeModel.normativeClasses.map((entry) => ({ ...entry, category: "normative" })),
    ...specTreeModel.derivedClasses.map((entry) => ({ ...entry, category: "derived" })),
    ...specTreeModel.guidanceClasses.map((entry) => ({ ...entry, category: "guidance" })),
  ];

  return classes.map((entry) => ({
    ...entry,
    includeMatchers: entry.pathPatterns.map(globToRegex),
    excludeMatchers: (entry.excludedPathPatterns ?? []).map(globToRegex),
  }));
}

function isAllowedTopLevelSupportFile(relativePath) {
  return [
    "INDEX.md",
    "bootstrap-state.yaml",
    "product-scope.yaml",
    "high-risk-admissions.yaml",
  ].includes(relativePath);
}

export function classifySpecTreeFiles(canonicalRoot, files, specTreeModel) {
  const matchers = compilePathClassMatchers(specTreeModel);
  const classifications = [];
  const unexpected = [];
  const conflicts = [];

  for (const relativePath of files) {
    const canonicalRelativePath = path.posix.join(canonicalRoot, relativePath);

    if (relativePath.startsWith("_meta/")) {
      classifications.push({ path: relativePath, classId: "_meta", category: "meta" });
      continue;
    }

    if (isAllowedTopLevelSupportFile(relativePath)) {
      classifications.push({ path: relativePath, classId: "support", category: "support" });
      continue;
    }

    const matched = matchers.filter((matcher) => (
      matcher.includeMatchers.some((regex) => regex.test(canonicalRelativePath))
      && !matcher.excludeMatchers.some((regex) => regex.test(canonicalRelativePath))
    ));

    if (matched.length === 0) {
      unexpected.push(relativePath);
      continue;
    }

    if (matched.length > 1) {
      conflicts.push({
        path: relativePath,
        classes: matched.map((entry) => entry.id),
      });
      continue;
    }

    classifications.push({
      path: relativePath,
      classId: matched[0].id,
      category: matched[0].category,
    });
  }

  return {
    classifications,
    unexpected,
    conflicts,
  };
}

export function classifyAuditCoveredFiles(files, specTreeModel) {
  const classifications = classifySpecTreeFiles(specTreeModel.canonicalRoot, files, specTreeModel);
  const auditedFiles = classifications.classifications.filter((entry) => (
    entry.category !== "meta"
    && (
      entry.category !== "support"
      || entry.path === "INDEX.md"
    )
  ));
  return {
    classifications,
    auditedFiles,
  };
}

export function isSourceRefWithinDeclaredRoots(sourceRef, declaredInputs) {
  const roots = [
    ...declaredInputs.code_roots,
    ...declaredInputs.docs_roots,
    ...declaredInputs.structure_roots,
    ...(declaredInputs.benchmark_blueprint_root ? [declaredInputs.benchmark_blueprint_root] : []),
  ];

  if (declaredInputs.human_note_paths.includes(sourceRef)) {
    return true;
  }

  return roots.some((root) => (
    root === "."
      ? !path.posix.isAbsolute(sourceRef)
      : sourceRef === root || sourceRef.startsWith(`${root}/`)
  ));
}

export function isDeclaredInputsCompatibleWithConfig(declaredInputs, generationInputs, blueprintReference) {
  const benchmarkRoot = generationInputs.benchmarkBlueprintRoot ?? blueprintReference.root ?? null;

  const rootsAlign = (declaredRoots, configuredRoots) => declaredRoots.every((entry) => configuredRoots.includes(entry));

  return rootsAlign(declaredInputs.code_roots, generationInputs.codeRoots ?? [])
    && rootsAlign(declaredInputs.docs_roots, generationInputs.docsRoots ?? [])
    && rootsAlign(declaredInputs.structure_roots, generationInputs.structureRoots ?? [])
    && rootsAlign(declaredInputs.human_note_paths, generationInputs.humanNotePaths ?? [])
    && (
      declaredInputs.benchmark_blueprint_root === null
        ? benchmarkRoot === null
        : declaredInputs.benchmark_blueprint_root === benchmarkRoot
    );
}
