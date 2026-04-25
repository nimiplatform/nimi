import path from "node:path";

import { specSurfaceForFile } from "./admissions.mjs";

function evidenceRootsForSpecOwner(ownerDomain, targetRootRef) {
  if (targetRootRef !== ".") {
    return [targetRootRef];
  }
  const repoWideEvidenceRoots = [
    ".github",
    "apps",
    "config",
    "kit",
    "nimi-coding",
    "nimi-cognition",
    "proto",
    "runtime",
    "scripts",
    "sdk",
    ".nimi/spec",
    ".nimi/contracts",
    ".nimi/methodology",
  ];
  const roots = {
    "spec-meta": repoWideEvidenceRoots,
    "spec-root": repoWideEvidenceRoots,
    cognition: ["nimi-cognition", ".nimi/spec/cognition"],
    desktop: ["apps/desktop", "kit", ".nimi/spec/desktop"],
    future: [".nimi/spec/future", ".nimi/topics"],
    platform: ["kit", "scripts", ".nimi/spec/platform"],
    realm: ["sdk/src/realm", "runtime/internal/protocol", ".nimi/spec/realm"],
    runtime: ["runtime", "proto/runtime/v1", "scripts", "config", ".nimi/spec/runtime"],
    sdk: ["sdk/src", "sdk/test", "scripts", ".nimi/spec/sdk"],
  };
  return roots[ownerDomain] ?? [ownerDomain, `.nimi/spec/${ownerDomain}`];
}

function slugPart(value) {
  return String(value)
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase() || "spec";
}

function extractModuleMapRefs(markdownText) {
  const lines = String(markdownText ?? "").split(/\r?\n/);
  const refs = [];
  let inModuleMap = false;
  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const headingText = heading[2].trim().toLowerCase();
      if (headingText === "module map") {
        inModuleMap = true;
        continue;
      }
      if (inModuleMap && heading[1].length <= 2) {
        break;
      }
    }
    if (!inModuleMap) {
      continue;
    }
    const match = /^\s*[-*]\s+`([^`]+)`/.exec(line);
    if (match) {
      refs.push(match[1].trim());
    }
  }
  return [...new Set(refs)].sort();
}

function candidateEvidenceRefsForModuleMapPath(modulePath, evidenceRoots) {
  const normalized = String(modulePath ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!normalized || normalized.startsWith("http:") || normalized.startsWith("https:")) {
    return [];
  }
  const directRoot = /^(?:\.nimi|apps|config|kit|nimi-[^/]+|proto|runtime|scripts|sdk)\//.test(normalized);
  const candidates = [];
  if (directRoot) {
    candidates.push(normalized);
  }
  for (const rootRef of evidenceRoots ?? []) {
    const root = String(rootRef ?? "").replace(/\\/g, "/").replace(/\/$/, "");
    if (!root || root.startsWith(".nimi/spec")) {
      continue;
    }
    candidates.push(`${root}/${normalized}`);
    if (root.startsWith("apps/")) {
      candidates.push(`${root}/src/${normalized}`);
      candidates.push(`${root}/src/shell/renderer/${normalized}`);
      candidates.push(`${root}/src-tauri/src/${normalized}`);
    }
  }
  return [...new Set(candidates)].sort();
}

export function buildSpecChunks(includedInventory, options) {
  const sortedEntries = [...includedInventory].sort((left, right) => left.file_ref.localeCompare(right.file_ref));
  const includedRefs = new Set(sortedEntries.map((entry) => entry.file_ref));
  const hostProjectionByHostRef = new Map();
  const hostProjectionsByPackageRef = new Map();
  for (const admission of options.packageAuthorityAdmissions ?? []) {
    for (const projection of admission.host_authority_projection_refs ?? []) {
      if (!includedRefs.has(projection.package_ref)) {
        continue;
      }
      const enrichedProjection = {
        host_ref: projection.host_ref,
        package_ref: projection.package_ref,
        package_authority_id: admission.id,
        admission_ref: admission.admission_ref,
      };
      hostProjectionByHostRef.set(projection.host_ref, enrichedProjection);
      const projections = hostProjectionsByPackageRef.get(projection.package_ref) ?? [];
      projections.push(enrichedProjection);
      hostProjectionsByPackageRef.set(projection.package_ref, projections);
    }
  }
  let chunkIndex = 0;
  const chunks = [];
  for (const entry of sortedEntries) {
    if (hostProjectionByHostRef.has(entry.file_ref)) {
      continue;
    }
    const surface = specSurfaceForFile(entry.file_ref, options.appSliceAdmissions, options.packageAuthorityAdmissions);
    const appAdmission = surface.appAdmission;
    const packageAdmission = surface.packageAdmission;
    const hostAuthorityProjectionRefs = (hostProjectionsByPackageRef.get(entry.file_ref) ?? [])
      .sort((left, right) => left.host_ref.localeCompare(right.host_ref));
    const authorityRefs = [
      entry.file_ref,
      ...hostAuthorityProjectionRefs.map((projection) => projection.host_ref),
    ];
    const rootAdmissions = (options.auditEvidenceRootAdmissions ?? [])
      .filter((admission) => admission.owner_domain === surface.ownerDomain && admission.authority_refs.includes(entry.file_ref));
    const admittedEvidenceRoots = rootAdmissions.flatMap((admission) => admission.evidence_roots);
    const evidenceRoots = packageAdmission
      ? packageAdmission.evidence_roots
      : appAdmission
      ? appAdmission.evidence_roots
      : [...new Set([
        ...evidenceRootsForSpecOwner(surface.ownerDomain, options.targetRootRef),
        ...admittedEvidenceRoots,
      ])].sort();
    const moduleMapRefs = surface.surface === "domain-guides" || surface.surface === "app-domain-guides"
      ? extractModuleMapRefs(options.authorityTextByRef?.get(entry.file_ref) ?? "")
      : [];
    const declaredEvidenceTargets = moduleMapRefs
      .map((moduleRef) => ({
        source_path: moduleRef,
        candidates: candidateEvidenceRefsForModuleMapPath(moduleRef, evidenceRoots),
      }))
      .filter((target) => target.candidates.length > 0);
    chunkIndex += 1;
    const chunkId = [
      `chunk-${String(chunkIndex).padStart(3, "0")}`,
      slugPart(surface.ownerDomain),
      slugPart(surface.surface),
      slugPart(path.posix.basename(entry.file_ref, path.posix.extname(entry.file_ref))),
    ].join("-");
    chunks.push({
      chunk_id: chunkId,
      state: "planned",
      owner_domain: surface.ownerDomain,
      planning_basis: "spec_authority",
      spec_surface: surface.surface,
      criteria: options.criteria,
      files: authorityRefs,
      authority_refs: authorityRefs,
      authority_kind: packageAdmission ? "admitted_package_authority" : (appAdmission ? "admitted_app_slice" : "nimi_spec"),
      ...(packageAdmission ? {
        package_authority_id: packageAdmission.id,
        admission_ref: packageAdmission.admission_ref,
        authority_root: packageAdmission.authority_root,
      } : {}),
      ...(appAdmission ? {
        app_id: appAdmission.app_id,
        admission_ref: appAdmission.admission_ref,
        authority_root: appAdmission.authority_root,
      } : {}),
      ...(rootAdmissions.length > 0 ? {
        evidence_root_admission_refs: rootAdmissions.map((admission) => admission.admission_ref),
        admitted_evidence_roots: admittedEvidenceRoots,
      } : {}),
      ...(hostAuthorityProjectionRefs.length > 0 ? {
        host_authority_projection_refs: hostAuthorityProjectionRefs,
      } : {}),
      ...(declaredEvidenceTargets.length > 0 ? {
        declared_evidence_targets: declaredEvidenceTargets,
      } : {}),
      evidence_roots: evidenceRoots,
      file_count: authorityRefs.length,
      finding_count: 0,
    });
  }
  return chunks;
}

