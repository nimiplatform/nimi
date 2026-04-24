import { readFile } from "node:fs/promises";
import path from "node:path";

import YAML from "yaml";

import { artifactPath, toPosix } from "./common.mjs";
import { pathExists } from "../fs-helpers.mjs";

export const AUDIT_SWEEP_PROJECT_CONFIG_REF = ".nimi/config/audit-sweep.yaml";
export const APP_SLICE_ADMISSION_REF = ".nimi/spec/platform/kernel/tables/app-slice-admissions.yaml";
const AUDIT_EVIDENCE_ROOT_TABLE_BASENAME = "audit-evidence-roots.yaml";
const PACKAGE_AUTHORITY_ADMISSION_BASENAME = "package-authority-admissions.yaml";

export function refInsideRoot(fileRef, rootRef) {
  const normalizedRoot = rootRef.replace(/\\/g, "/").replace(/\/$/, "");
  return fileRef === normalizedRoot || fileRef.startsWith(`${normalizedRoot}/`);
}

function safeProjectRef(value) {
  return typeof value === "string"
    && value.trim().length > 0
    && !path.isAbsolute(value)
    && !value.split("/").includes("..");
}

export async function loadAuditSweepProjectConfig(projectRoot) {
  const configPath = artifactPath(projectRoot, AUDIT_SWEEP_PROJECT_CONFIG_REF);
  const info = await pathExists(configPath);
  if (!info?.isFile()) {
    return { ok: true, found: false, excludePatterns: [] };
  }

  let parsed;
  try {
    parsed = YAML.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `nimicoding audit-sweep refused: ${AUDIT_SWEEP_PROJECT_CONFIG_REF} must contain valid YAML (${error.message}).\n`,
    };
  }

  const rawExcludePatterns = parsed?.audit_sweep?.exclude_patterns ?? parsed?.exclude_patterns ?? [];
  if (!Array.isArray(rawExcludePatterns)) {
    return {
      ok: false,
      error: `nimicoding audit-sweep refused: ${AUDIT_SWEEP_PROJECT_CONFIG_REF} exclude_patterns must be an array.\n`,
    };
  }

  const excludePatterns = [];
  for (const pattern of rawExcludePatterns) {
    if (typeof pattern !== "string" || pattern.trim().length === 0) {
      return {
        ok: false,
        error: `nimicoding audit-sweep refused: ${AUDIT_SWEEP_PROJECT_CONFIG_REF} exclude_patterns entries must be non-empty strings.\n`,
      };
    }
    excludePatterns.push(pattern.trim());
  }

  return { ok: true, found: true, excludePatterns };
}

export async function loadAppSliceAdmissions(projectRoot) {
  const configPath = artifactPath(projectRoot, APP_SLICE_ADMISSION_REF);
  const info = await pathExists(configPath);
  if (!info?.isFile()) {
    return { ok: true, found: false, admissions: [] };
  }

  let parsed;
  try {
    parsed = YAML.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      error: `nimicoding audit-sweep refused: ${APP_SLICE_ADMISSION_REF} must contain valid YAML (${error.message}).\n`,
    };
  }

  const rows = Array.isArray(parsed?.admissions) ? parsed.admissions : null;
  if (!rows) {
    return {
      ok: false,
      error: `nimicoding audit-sweep refused: ${APP_SLICE_ADMISSION_REF} must declare admissions as an array.\n`,
    };
  }

  const admissions = [];
  const seenAppIds = new Set();
  for (const row of rows) {
    const appId = String(row?.app_id ?? "").trim();
    const status = String(row?.status ?? "").trim();
    const ownerDomain = String(row?.owner_domain ?? "").trim();
    const authorityRoot = String(row?.authority_root ?? "").trim().replace(/\\/g, "/").replace(/\/$/, "");
    const evidenceRoots = Array.isArray(row?.evidence_roots)
      ? row.evidence_roots.map((entry) => String(entry ?? "").trim().replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean)
      : null;
    if (!appId || seenAppIds.has(appId)) {
      return { ok: false, error: `nimicoding audit-sweep refused: ${APP_SLICE_ADMISSION_REF} has missing or duplicate app_id.\n` };
    }
    seenAppIds.add(appId);
    if (status !== "active") {
      continue;
    }
    if (!ownerDomain || !safeProjectRef(authorityRoot) || !authorityRoot.startsWith(`apps/${appId}/spec`)) {
      return { ok: false, error: `nimicoding audit-sweep refused: ${APP_SLICE_ADMISSION_REF} ${appId} has invalid owner_domain or authority_root.\n` };
    }
    if (!evidenceRoots || evidenceRoots.length === 0 || !evidenceRoots.every((rootRef) => safeProjectRef(rootRef) && refInsideRoot(rootRef, `apps/${appId}`))) {
      return { ok: false, error: `nimicoding audit-sweep refused: ${APP_SLICE_ADMISSION_REF} ${appId} has invalid evidence_roots.\n` };
    }
    admissions.push({
      app_id: appId,
      owner_domain: ownerDomain,
      status,
      authority_root: authorityRoot,
      evidence_roots: evidenceRoots,
      admission_ref: `${APP_SLICE_ADMISSION_REF}#${appId}`,
    });
  }

  return { ok: true, found: true, admissions };
}

async function listSpecTableRefs(projectRoot, basename, listGitFiles, listFallbackFiles) {
  const specRootInfo = await pathExists(artifactPath(projectRoot, ".nimi/spec"));
  if (!specRootInfo?.isDirectory()) {
    return null;
  }
  const gitSpecFiles = await listGitFiles(projectRoot, ".nimi/spec");
  const specFiles = gitSpecFiles.length > 0
    ? gitSpecFiles
    : await listFallbackFiles(projectRoot, ".nimi/spec", []);
  return specFiles
    .map((entry) => toPosix(entry))
    .filter((entry) => entry.endsWith(`/kernel/tables/${basename}`))
    .sort();
}

export async function loadAuditEvidenceRootAdmissions(projectRoot, listGitFiles, listFallbackFiles) {
  const tableRefs = await listSpecTableRefs(projectRoot, AUDIT_EVIDENCE_ROOT_TABLE_BASENAME, listGitFiles, listFallbackFiles);
  if (!tableRefs) {
    return { ok: true, tableRefs: [], admissions: [] };
  }
  const admissions = [];

  for (const tableRef of tableRefs) {
    let parsed;
    try {
      parsed = YAML.parse(await readFile(artifactPath(projectRoot, tableRef), "utf8"));
    } catch (error) {
      return {
        ok: false,
        error: `nimicoding audit-sweep refused: ${tableRef} must contain valid YAML (${error.message}).\n`,
      };
    }
    const rows = Array.isArray(parsed?.roots) ? parsed.roots : null;
    if (!rows) {
      return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} must declare roots as an array.\n` };
    }
    for (const row of rows) {
      const id = String(row?.id ?? "").trim();
      const ownerDomain = String(row?.owner_domain ?? "").trim();
      const authorityRefs = Array.isArray(row?.authority_refs)
        ? row.authority_refs.map((entry) => String(entry ?? "").trim().replace(/\\/g, "/")).filter(Boolean)
        : null;
      const evidenceRoots = Array.isArray(row?.evidence_roots)
        ? row.evidence_roots.map((entry) => String(entry ?? "").trim().replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean)
        : null;
      if (!id || !ownerDomain || !authorityRefs?.length || !evidenceRoots?.length) {
        return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} root rows require id, owner_domain, authority_refs, and evidence_roots.\n` };
      }
      if (!authorityRefs.every((ref) => safeProjectRef(ref) && ref.startsWith(".nimi/spec/"))) {
        return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} ${id} authority_refs must stay under .nimi/spec.\n` };
      }
      if (!evidenceRoots.every((ref) => safeProjectRef(ref) && !ref.startsWith(".nimi/spec/"))) {
        return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} ${id} evidence_roots must be project evidence roots outside .nimi/spec.\n` };
      }
      admissions.push({
        id,
        owner_domain: ownerDomain,
        authority_refs: authorityRefs,
        evidence_roots: evidenceRoots,
        admission_ref: `${tableRef}#${id}`,
      });
    }
  }

  return { ok: true, tableRefs, admissions };
}

export async function loadPackageAuthorityAdmissions(projectRoot, listGitFiles, listFallbackFiles) {
  const tableRefs = await listSpecTableRefs(projectRoot, PACKAGE_AUTHORITY_ADMISSION_BASENAME, listGitFiles, listFallbackFiles);
  if (!tableRefs) {
    return { ok: true, tableRefs: [], admissions: [] };
  }
  const admissions = [];
  const seenIds = new Set();

  for (const tableRef of tableRefs) {
    let parsed;
    try {
      parsed = YAML.parse(await readFile(artifactPath(projectRoot, tableRef), "utf8"));
    } catch (error) {
      return {
        ok: false,
        error: `nimicoding audit-sweep refused: ${tableRef} must contain valid YAML (${error.message}).\n`,
      };
    }
    const rows = Array.isArray(parsed?.admissions) ? parsed.admissions : null;
    if (!rows) {
      return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} must declare admissions as an array.\n` };
    }
    for (const row of rows) {
      const id = String(row?.id ?? "").trim();
      const status = String(row?.status ?? "").trim();
      const ownerDomain = String(row?.owner_domain ?? "").trim();
      const authorityRoot = String(row?.authority_root ?? "").trim().replace(/\\/g, "/").replace(/\/$/, "");
      const evidenceRoots = Array.isArray(row?.evidence_roots)
        ? row.evidence_roots.map((entry) => String(entry ?? "").trim().replace(/\\/g, "/").replace(/\/$/, "")).filter(Boolean)
        : null;
      const admissionKey = `${tableRef}#${id}`;
      if (!id || seenIds.has(admissionKey)) {
        return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} has missing or duplicate package authority id.\n` };
      }
      seenIds.add(admissionKey);
      if (status !== "active") {
        continue;
      }
      if (!ownerDomain || !safeProjectRef(authorityRoot) || authorityRoot.startsWith(".nimi/spec/") || !authorityRoot.endsWith("/spec")) {
        return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} ${id} has invalid owner_domain or authority_root.\n` };
      }
      if (!evidenceRoots || evidenceRoots.length === 0 || !evidenceRoots.every((rootRef) => safeProjectRef(rootRef) && !rootRef.startsWith(".nimi/spec/") && refInsideRoot(authorityRoot, rootRef))) {
        return { ok: false, error: `nimicoding audit-sweep refused: ${tableRef} ${id} has invalid evidence_roots.\n` };
      }
      admissions.push({
        id,
        owner_domain: ownerDomain,
        status,
        authority_root: authorityRoot,
        evidence_roots: evidenceRoots,
        admission_ref: admissionKey,
      });
    }
  }

  return { ok: true, tableRefs, admissions };
}

function appSliceAdmissionForFile(fileRef, appSliceAdmissions = []) {
  return appSliceAdmissions.find((admission) => refInsideRoot(fileRef, admission.authority_root)) ?? null;
}

function packageAuthorityAdmissionForFile(fileRef, packageAuthorityAdmissions = []) {
  return packageAuthorityAdmissions.find((admission) => refInsideRoot(fileRef, admission.authority_root)) ?? null;
}

export function specSurfaceForFile(fileRef, appSliceAdmissions = [], packageAuthorityAdmissions = []) {
  const packageAdmission = packageAuthorityAdmissionForFile(fileRef, packageAuthorityAdmissions);
  if (packageAdmission) {
    const relative = fileRef.slice(packageAdmission.authority_root.length + 1);
    const parts = relative.split("/");
    if (parts[0] === "_meta") {
      return { ownerDomain: packageAdmission.owner_domain, surface: "package-meta", packageAdmission };
    }
    if (parts[0] === "kernel" && parts[1] === "tables") {
      return { ownerDomain: packageAdmission.owner_domain, surface: "package-kernel-tables", packageAdmission };
    }
    if (parts[0] === "kernel") {
      return { ownerDomain: packageAdmission.owner_domain, surface: "package-kernel-contracts", packageAdmission };
    }
    return { ownerDomain: packageAdmission.owner_domain, surface: "package-root", packageAdmission };
  }

  const appAdmission = appSliceAdmissionForFile(fileRef, appSliceAdmissions);
  if (appAdmission) {
    const relative = fileRef.slice(appAdmission.authority_root.length + 1);
    const parts = relative.split("/");
    if (parts[0] === "kernel" && parts[1] === "tables") {
      return { ownerDomain: appAdmission.owner_domain, surface: "app-kernel-tables", appAdmission };
    }
    if (parts[0] === "kernel") {
      return { ownerDomain: appAdmission.owner_domain, surface: "app-kernel-contracts", appAdmission };
    }
    return { ownerDomain: appAdmission.owner_domain, surface: "app-domain-guides", appAdmission };
  }

  const withoutRoot = fileRef.startsWith(".nimi/spec/")
    ? fileRef.slice(".nimi/spec/".length)
    : fileRef;
  const parts = withoutRoot.split("/");
  if (parts[0] === "_meta") {
    return { ownerDomain: "spec-meta", surface: path.posix.basename(fileRef, path.posix.extname(fileRef)) };
  }
  if (parts.length === 1) {
    return { ownerDomain: "spec-root", surface: path.posix.basename(fileRef, path.posix.extname(fileRef)) };
  }
  const domain = parts[0];
  if (parts[1] === "kernel" && parts[2] === "tables") {
    return { ownerDomain: domain, surface: "kernel-tables" };
  }
  if (parts[1] === "kernel" && parts[2] === "generated") {
    return { ownerDomain: domain, surface: "kernel-generated" };
  }
  if (parts[1] === "kernel") {
    return { ownerDomain: domain, surface: "kernel-contracts" };
  }
  return { ownerDomain: domain, surface: "domain-guides" };
}
