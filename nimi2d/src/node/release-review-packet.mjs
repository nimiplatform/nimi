import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { validateBenchCorpus } from './generation-bench.mjs';
import { validateLayerInput } from './layer-input.mjs';

function posixRelative(from, to) {
  return path.relative(from, to).split(path.sep).join('/');
}

function htmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function safeAssetName(layerId, ref) {
  return `${layerId}-${path.basename(ref.replaceAll('\\', '/'))}`;
}

function safeSourceAssetName(ref) {
  return path.basename(ref.replaceAll('\\', '/'));
}

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

async function writeYaml(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, YAML.stringify(value), 'utf8');
  return filePath;
}

function makeProductReviewTemplate(caseIds) {
  return {
    manifest_kind: 'nimi.nimi2d.product-review-report',
    schema_version: 1,
    review_scope: 'release_candidate',
    reviewer: {
      id: null,
      role: null,
    },
    reviewed_at: null,
    reviewed_case_ids: caseIds,
    criteria: {
      identity_preservation: 'pending',
      layer_alignment: 'pending',
      expression_readability: 'pending',
      wardrobe_readiness: 'pending',
      product_fit: 'pending',
    },
    notes: [],
    decision: {
      verdict: 'pending',
      reason: 'Product review template remains pending until a reviewer records pass/fail evidence.',
    },
  };
}

function issue(code, pathLabel, message) {
  return { code, path: pathLabel, message };
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function htmlImageRefs(html) {
  return [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((match) => match[1]);
}

function makeManualCorrectionTemplate(caseIds) {
  return {
    manifest_kind: 'nimi.nimi2d.manual-correction-report',
    schema_version: 1,
    measurement_scope: 'release_candidate',
    case_results: caseIds.map((caseId) => ({
      case_id: caseId,
      correction_minutes: null,
      prompt_repair_required: null,
      notes: null,
    })),
    summary: {
      measured_case_count: null,
      p50_minutes: null,
      p90_minutes: null,
      max_minutes: null,
    },
    decision: {
      verdict: 'pending',
      reason: 'Manual correction template remains pending until measurements are recorded.',
    },
  };
}

async function readSourceReferenceMap(sourceReferencesPath) {
  if (!sourceReferencesPath) return { status: 'ok', map: new Map(), path: null, issues: [], codes: [] };
  const absolutePath = path.resolve(sourceReferencesPath);
  const issues = [];
  const manifest = await readYaml(absolutePath);
  if (manifest?.manifest_kind !== 'nimi.nimi2d.release-review-source-references') {
    issues.push(issue(
      'NIMI2D_RELEASE_REVIEW_SOURCE_REFERENCES_INVALID',
      '$.manifest_kind',
      'Source reference sidecar must use nimi.nimi2d.release-review-source-references.',
    ));
  }
  const refs = Array.isArray(manifest?.case_source_refs) ? manifest.case_source_refs : [];
  if (refs.length === 0) {
    issues.push(issue(
      'NIMI2D_RELEASE_REVIEW_SOURCE_REFERENCES_INVALID',
      '$.case_source_refs',
      'Source reference sidecar must include case_source_refs.',
    ));
  }
  const map = new Map();
  const sidecarDir = path.dirname(absolutePath);
  for (const [index, item] of refs.entries()) {
    if (typeof item?.case_id !== 'string' || item.case_id.length === 0) {
      issues.push(issue(
        'NIMI2D_RELEASE_REVIEW_SOURCE_REFERENCES_INVALID',
        `$.case_source_refs[${index}].case_id`,
        'Source reference entry must include a case_id.',
      ));
      continue;
    }
    if (typeof item.source_image_ref !== 'string' || item.source_image_ref.length === 0 || /^https?:\/\//i.test(item.source_image_ref)) {
      issues.push(issue(
        'NIMI2D_RELEASE_REVIEW_SOURCE_REFERENCES_INVALID',
        `$.case_source_refs[${index}].source_image_ref`,
        'Source reference entry must include a local source_image_ref.',
      ));
      continue;
    }
    if (map.has(item.case_id)) {
      issues.push(issue(
        'NIMI2D_RELEASE_REVIEW_SOURCE_REFERENCES_DUPLICATE_CASE',
        `$.case_source_refs[${index}].case_id`,
        `Duplicate source reference for case: ${item.case_id}`,
      ));
      continue;
    }
    map.set(item.case_id, path.resolve(sidecarDir, item.source_image_ref));
  }
  return {
    status: issues.length === 0 ? 'ok' : 'reject',
    path: absolutePath,
    map,
    issues,
    codes: [...new Set(issues.map((item) => item.code))],
  };
}

function reviewNotice(packet) {
  if (
    packet.release_candidate_audit.decision_verdict === 'candidate_rejected_product_review'
    || packet.release_candidate_audit.product_readiness_status === 'fail'
    || packet.release_candidate_audit.product_readiness_status === 'failed_product_review'
  ) {
    return 'Product review failed release candidate criteria.';
  }
  return 'Product review template remains pending until a reviewer records pass/fail evidence.';
}

function renderHtml({ packet, cases }) {
  const cards = cases.map((item) => {
    const stackImages = item.layers
      .filter((layer) => item.draw_order.includes(layer.layer_id))
      .sort((left, right) => item.draw_order.indexOf(left.layer_id) - item.draw_order.indexOf(right.layer_id))
      .map((layer) => `<img src="${htmlEscape(layer.asset_ref)}" alt="${htmlEscape(layer.layer_id)}">`)
      .join('\n          ');
    const sourcePreview = item.source_image_ref
      ? `<img class="source-preview" data-source-ref="${htmlEscape(item.source_image_ref)}" src="${htmlEscape(item.source_image_ref)}" alt="${htmlEscape(`${item.case_id} source reference`)}">`
      : '<div class="source-missing" data-source-ref="missing">Source reference missing</div>';
    const layerRows = item.layers.map((layer) => `
        <tr>
          <td>${htmlEscape(layer.layer_id)}</td>
          <td>${htmlEscape((layer.semantic_labels ?? []).join(', '))}</td>
          <td>${htmlEscape(layer.visible_bounds_px ? `${layer.visible_bounds_px.x},${layer.visible_bounds_px.y} ${layer.visible_bounds_px.width}x${layer.visible_bounds_px.height}` : 'not recorded')}</td>
          <td><img class="thumb" src="${htmlEscape(layer.asset_ref)}" alt="${htmlEscape(layer.layer_id)}"></td>
        </tr>`).join('');
    return `
      <section class="case">
        <div class="case-head">
          <h2>${htmlEscape(item.case_id)}</h2>
          <span>${htmlEscape(item.target_tier)}</span>
        </div>
        <div class="case-body">
          <div class="visuals">
            <div>
              <h3>Source Reference</h3>
              <div class="source-frame" style="aspect-ratio:${item.canvas.width_px}/${item.canvas.height_px}">
                ${sourcePreview}
              </div>
            </div>
            <div>
              <h3>Layer Composite</h3>
              <div class="preview" style="aspect-ratio:${item.canvas.width_px}/${item.canvas.height_px}">
                ${stackImages}
              </div>
            </div>
          </div>
          <div class="meta">
            <p><strong>Tags</strong>: ${htmlEscape(item.distribution_tags.join(', '))}</p>
            <p><strong>Layer input</strong>: ${htmlEscape(item.layer_input_ref)}</p>
            <p><strong>Source evidence</strong>: ${htmlEscape(Object.values(item.source_evidence).filter(Boolean).join(' | '))}</p>
            <table>
              <thead><tr><th>Layer</th><th>Labels</th><th>Visible Bounds</th><th>Asset</th></tr></thead>
              <tbody>${layerRows}</tbody>
            </table>
          </div>
        </div>
      </section>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Nimi2D Release Review Packet</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; color: #1f2933; background: #f7f8fa; }
    header { padding: 24px 32px; background: #ffffff; border-bottom: 1px solid #d8dee6; }
    main { padding: 24px 32px; display: grid; gap: 20px; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    h2 { margin: 0; font-size: 18px; }
    h3 { margin: 0 0 8px; font-size: 13px; color: #52606d; text-transform: uppercase; letter-spacing: 0; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(120px, 1fr)); gap: 12px; margin-top: 16px; }
    .metric { background: #eef2f6; border: 1px solid #d8dee6; border-radius: 6px; padding: 12px; }
    .metric strong { display: block; font-size: 13px; color: #52606d; }
    .metric span { display: block; margin-top: 6px; font-size: 16px; }
    .case { background: #ffffff; border: 1px solid #d8dee6; border-radius: 6px; overflow: hidden; }
    .case-head { display: flex; justify-content: space-between; gap: 12px; padding: 16px; border-bottom: 1px solid #e5e9f0; }
    .case-body { display: grid; grid-template-columns: minmax(340px, 620px) 1fr; gap: 20px; padding: 16px; }
    .visuals { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr); gap: 12px; align-items: start; }
    .preview, .source-frame { position: relative; width: 100%; background: #dfe5ec; border: 1px solid #c8d1dc; overflow: hidden; }
    .preview img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; image-rendering: auto; }
    .source-preview { display: block; width: 100%; height: 100%; object-fit: contain; background: #eef2f6; }
    .source-missing { display: grid; place-items: center; height: 100%; min-height: 120px; color: #7b8794; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { text-align: left; border-bottom: 1px solid #e5e9f0; padding: 8px; vertical-align: middle; }
    .thumb { width: 44px; height: 44px; object-fit: contain; background: #eef2f6; border: 1px solid #d8dee6; }
    .notice { margin-top: 12px; color: #52606d; }
    @media (max-width: 860px) {
      header, main { padding: 16px; }
      .summary { grid-template-columns: 1fr 1fr; }
      .case-body { grid-template-columns: 1fr; }
      .visuals { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <h1>Nimi2D Release Review Packet</h1>
    <div>Decision: ${htmlEscape(packet.release_candidate_audit.decision_verdict)}</div>
    <div class="notice">${htmlEscape(reviewNotice(packet))}</div>
    <div class="summary">
      <div class="metric"><strong>Corpus</strong><span>${htmlEscape(packet.corpus_id)}</span></div>
      <div class="metric"><strong>Review Cases</strong><span>${packet.case_count}</span></div>
      <div class="metric"><strong>Product Readiness</strong><span>${htmlEscape(packet.release_candidate_audit.product_readiness_status)}</span></div>
      <div class="metric"><strong>Avatar Readiness</strong><span>not closed</span></div>
    </div>
  </header>
  <main>
    ${cards}
  </main>
</body>
</html>
`;
}

export async function buildReleaseReviewPacket(options = {}) {
  const corpusPath = path.resolve(options.corpusPath);
  const releaseCandidateAuditPath = path.resolve(options.releaseCandidateAuditPath);
  const outputDir = path.resolve(options.outputDir);
  await mkdir(outputDir, { recursive: true });

  const corpusResult = await validateBenchCorpus(corpusPath);
  if (corpusResult.status !== 'ok') {
    return {
      status: 'reject',
      kind: 'release_review_packet',
      codes: corpusResult.codes,
      issues: corpusResult.issues,
    };
  }
  const corpus = corpusResult.value;
  const corpusDir = path.dirname(corpusPath);
  const audit = await readYaml(releaseCandidateAuditPath);
  const sourceReferences = await readSourceReferenceMap(options.sourceReferencesPath);
  if (sourceReferences.status !== 'ok') {
    return {
      status: 'reject',
      kind: 'release_review_packet',
      codes: sourceReferences.codes,
      issues: sourceReferences.issues,
    };
  }
  const certifiedIds = new Set(corpus.case_splits.certified_good_tier1 ?? []);
  const certifiedCases = corpus.cases.filter((item) => certifiedIds.has(item.case_id));
  const packetCases = [];

  for (const item of certifiedCases) {
    const layerInputPath = path.resolve(corpusDir, item.layer_input_manifest_ref);
    const layerValidation = await validateLayerInput(layerInputPath);
    if (layerValidation.status !== 'ok') {
      return {
        status: 'reject',
        kind: 'release_review_packet',
        codes: layerValidation.codes,
        issues: layerValidation.issues,
      };
    }
    const layerInput = layerValidation.value;
    const caseDir = path.join(outputDir, 'cases', item.case_id);
    const layerDir = path.join(caseDir, 'layers');
    await mkdir(layerDir, { recursive: true });
    const copiedLayers = [];
    for (const layer of layerInput.layers) {
      const assetName = safeAssetName(layer.layer_id, layer.asset.ref);
      const dest = path.join(layerDir, assetName);
      await copyFile(path.resolve(path.dirname(layerInputPath), layer.asset.ref), dest);
      copiedLayers.push({
        layer_id: layer.layer_id,
        semantic_labels: layer.semantic_labels ?? [],
        visible_bounds_px: layer.visible_bounds_px ?? null,
        asset_ref: posixRelative(outputDir, dest),
      });
    }
    const sourceImagePath = sourceReferences.map.get(item.case_id);
    let sourceImageRef = null;
    if (sourceImagePath) {
      const sourceDir = path.join(caseDir, 'source');
      await mkdir(sourceDir, { recursive: true });
      const sourceDest = path.join(sourceDir, safeSourceAssetName(sourceImagePath));
      await copyFile(sourceImagePath, sourceDest);
      sourceImageRef = posixRelative(outputDir, sourceDest);
    }
    packetCases.push({
      case_id: item.case_id,
      target_tier: item.target_tier,
      distribution_tags: item.distribution_tags ?? [],
      source_evidence: item.source_evidence ?? {},
      source_image_ref: sourceImageRef,
      layer_input_ref: item.layer_input_manifest_ref,
      canvas: layerInput.canvas,
      draw_order: layerInput.draw_order ?? [],
      layers: copiedLayers,
    });
  }

  const caseIds = packetCases.map((item) => item.case_id);
  const productReviewTemplatePath = path.join(outputDir, 'product-review-template.yaml');
  const manualCorrectionTemplatePath = path.join(outputDir, 'manual-correction-template.yaml');
  await writeYaml(productReviewTemplatePath, makeProductReviewTemplate(caseIds));
  await writeYaml(manualCorrectionTemplatePath, makeManualCorrectionTemplate(caseIds));

  const packet = {
    manifest_kind: 'nimi.nimi2d.release-review-packet',
    schema_version: 1,
    corpus_path: corpusPath,
    release_candidate_audit_path: releaseCandidateAuditPath,
    source_references_path: sourceReferences.path,
    corpus_id: corpus.corpus_id,
    case_count: packetCases.length,
    release_candidate_audit: {
      decision_verdict: audit?.decision?.verdict ?? 'not_recorded',
      product_readiness_status: audit?.product_readiness?.status ?? 'not_recorded',
      closes_production_avatar_readiness: false,
    },
    outputs: {
      index_html: 'index.html',
      product_review_template: 'product-review-template.yaml',
      manual_correction_template: 'manual-correction-template.yaml',
    },
    cases: packetCases,
    decision: {
      verdict: 'review_packet_ready',
      reason: 'Review packet generated with pending product review and manual correction templates.',
    },
  };
  const packetPath = path.join(outputDir, 'release-review-packet.yaml');
  await writeYaml(packetPath, packet);
  await writeFile(path.join(outputDir, 'index.html'), renderHtml({ packet, cases: packetCases }), 'utf8');

  return {
    status: 'ok',
    kind: 'release_review_packet',
    outputDir,
    packetPath,
    indexPath: path.join(outputDir, 'index.html'),
    productReviewTemplatePath,
    manualCorrectionTemplatePath,
    caseCount: packetCases.length,
    decision: packet.decision,
  };
}

export async function validateReleaseReviewPacket(options = {}) {
  const packetDir = path.resolve(options.packetDir);
  const packetPath = path.join(packetDir, 'release-review-packet.yaml');
  const indexPath = path.join(packetDir, 'index.html');
  const productReviewTemplatePath = path.join(packetDir, 'product-review-template.yaml');
  const manualCorrectionTemplatePath = path.join(packetDir, 'manual-correction-template.yaml');
  const issues = [];

  const packetExists = await fileExists(packetPath);
  const indexExists = await fileExists(indexPath);
  const productTemplateExists = await fileExists(productReviewTemplatePath);
  const correctionTemplateExists = await fileExists(manualCorrectionTemplatePath);
  if (!packetExists) {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_MANIFEST_MISSING', '$.release_review_packet', 'release-review-packet.yaml is missing.'));
  }
  if (!indexExists) {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_INDEX_MISSING', '$.index_html', 'index.html is missing.'));
  }
  if (!productTemplateExists) {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_PRODUCT_TEMPLATE_MISSING', '$.product_review_template', 'product-review-template.yaml is missing.'));
  }
  if (!correctionTemplateExists) {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_CORRECTION_TEMPLATE_MISSING', '$.manual_correction_template', 'manual-correction-template.yaml is missing.'));
  }

  const packet = packetExists ? await readYaml(packetPath) : null;
  if (packet && packet.manifest_kind !== 'nimi.nimi2d.release-review-packet') {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_MANIFEST_INVALID', '$.manifest_kind', 'Invalid release review packet manifest kind.'));
  }
  const cases = Array.isArray(packet?.cases) ? packet.cases : [];
  if (packet && cases.length === 0) {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_CASES_MISSING', '$.cases', 'Review packet must include at least one case.'));
  }

  const manifestAssetRefs = [];
  const manifestSourceRefs = [];
  for (const [caseIndex, item] of cases.entries()) {
    if (item.source_image_ref !== null && item.source_image_ref !== undefined) {
      if (typeof item.source_image_ref !== 'string' || item.source_image_ref.length === 0) {
        issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_SOURCE_REF_INVALID', `$.cases[${caseIndex}].source_image_ref`, 'Source image ref must be a non-empty string when present.'));
      } else {
        manifestSourceRefs.push(item.source_image_ref);
      }
    }
    const layers = Array.isArray(item.layers) ? item.layers : [];
    if (layers.length === 0) {
      issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_CASE_LAYERS_MISSING', `$.cases[${caseIndex}].layers`, 'Review packet case must include copied layer refs.'));
    }
    for (const [layerIndex, layer] of layers.entries()) {
      if (typeof layer.asset_ref !== 'string' || layer.asset_ref.length === 0) {
        issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_ASSET_REF_INVALID', `$.cases[${caseIndex}].layers[${layerIndex}].asset_ref`, 'Layer asset ref is missing.'));
      } else {
        manifestAssetRefs.push(layer.asset_ref);
      }
    }
  }

  const html = indexExists ? await readFile(indexPath, 'utf8') : '';
  const refs = htmlImageRefs(html);
  const missingImageRefs = [];
  const missingSourceRefs = [];
  for (const ref of [...new Set(manifestSourceRefs)]) {
    if (!await fileExists(path.join(packetDir, ref))) {
      missingSourceRefs.push(ref);
      issues.push(issue(
        'NIMI2D_RELEASE_REVIEW_PACKET_SOURCE_REF_MISSING',
        '$.cases[].source_image_ref',
        `Review packet source ref is missing: ${ref}`,
      ));
    }
  }
  for (const ref of [...new Set([...refs, ...manifestAssetRefs])]) {
    if (!await fileExists(path.join(packetDir, ref))) {
      missingImageRefs.push(ref);
      issues.push(issue(
        'NIMI2D_RELEASE_REVIEW_PACKET_IMAGE_REF_MISSING',
        '$.cases[].layers[].asset_ref',
        `Review packet image ref is missing: ${ref}`,
      ));
    }
  }

  const productTemplate = productTemplateExists ? await readYaml(productReviewTemplatePath) : null;
  if (productTemplate && productTemplate.decision?.verdict !== 'pending') {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_PRODUCT_TEMPLATE_NOT_PENDING', '$.product_review_template.decision.verdict', 'Product review template must remain pending.'));
  }
  const correctionTemplate = correctionTemplateExists ? await readYaml(manualCorrectionTemplatePath) : null;
  if (correctionTemplate && correctionTemplate.decision?.verdict !== 'pending') {
    issues.push(issue('NIMI2D_RELEASE_REVIEW_PACKET_CORRECTION_TEMPLATE_NOT_PENDING', '$.manual_correction_template.decision.verdict', 'Manual correction template must remain pending.'));
  }

  const passed = issues.length === 0;
  const report = {
    manifest_kind: 'nimi.nimi2d.release-review-packet-validation-report',
    schema_version: 1,
    packet_dir: packetDir,
    summary: {
      case_count: cases.length,
      manifest_asset_ref_count: manifestAssetRefs.length,
      source_ref_count: manifestSourceRefs.length,
      html_image_ref_count: refs.length,
      missing_image_ref_count: missingImageRefs.length,
      missing_image_refs: missingImageRefs,
      missing_source_ref_count: missingSourceRefs.length,
      missing_source_refs: missingSourceRefs,
    },
    decision: {
      verdict: passed ? 'pass' : 'fail',
      reason: passed
        ? 'Release review packet is self-contained and review templates are pending.'
        : 'Release review packet is missing required files or referenced assets.',
    },
    issues,
    codes: [...new Set(issues.map((item) => item.code))],
  };
  const outPath = options.outPath ? await writeYaml(path.resolve(options.outPath), report) : null;
  return {
    status: passed ? 'ok' : 'reject',
    kind: 'release_review_packet_validation',
    outPath,
    decision: report.decision,
    report,
    codes: report.codes,
    issues,
  };
}
