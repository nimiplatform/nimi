import { inflateSync } from 'node:zlib';

import {
  assertArtifactRef,
  assertExactObject,
  assertSchemaVersion,
  fail,
  readJsonFile,
  readJsonLines,
} from './third-party-hardcut-evidence-core.mjs';
import { resolveAndVerifyPacketArtifact } from './third-party-hardcut-evidence-paths.mjs';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_IMAGE_PIXELS = 50_000_000;
const MAX_DECODED_IMAGE_BYTES = 256 * 1024 * 1024;

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectPng(buffer) {
  if (buffer.length < 45 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let header;
  let ended = false;
  const compressed = [];
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > buffer.length) return null;
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = buffer.readUInt32BE(offset + 8 + length);
    if (crc32(buffer.subarray(offset + 4, offset + 8 + length)) !== expectedCrc) return null;
    if (!header) {
      if (type !== 'IHDR' || length !== 13) return null;
      header = data;
    } else if (type === 'IDAT') {
      compressed.push(data);
    } else if (type === 'IEND') {
      if (length !== 0) return null;
      ended = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }
  if (!header || !ended || offset !== buffer.length || compressed.length === 0) return null;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const bitDepth = header[8];
  const colorType = header[9];
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  if (
    width === 0
    || height === 0
    || !channels
    || ![1, 2, 4, 8, 16].includes(bitDepth)
    || header[10] !== 0
    || header[11] !== 0
    || header[12] !== 0
  ) return null;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_IMAGE_PIXELS) {
    fail('SCREENSHOT_TOO_LARGE', 'screenshot dimensions exceed the verifier bound');
  }
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const decodedBytes = (rowBytes + 1) * height;
  if (!Number.isSafeInteger(decodedBytes) || decodedBytes > MAX_DECODED_IMAGE_BYTES) {
    fail('SCREENSHOT_TOO_LARGE', 'decoded screenshot exceeds the verifier bound');
  }
  let pixels;
  try {
    pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: decodedBytes });
  } catch {
    return null;
  }
  if (pixels.length !== decodedBytes) return null;
  for (let row = 0; row < height; row += 1) {
    if (pixels[row * (rowBytes + 1)] > 4) return null;
  }
  return { width, height };
}

function inspectP6(buffer) {
  if (buffer.length < 12 || buffer[0] !== 0x50 || buffer[1] !== 0x36) return null;
  let offset = 2;
  const readToken = () => {
    while (offset < buffer.length) {
      if (buffer[offset] === 0x23) {
        while (offset < buffer.length && buffer[offset] !== 0x0a) offset += 1;
      } else if (/\s/u.test(String.fromCharCode(buffer[offset]))) {
        offset += 1;
      } else {
        break;
      }
    }
    const start = offset;
    while (offset < buffer.length && !/\s/u.test(String.fromCharCode(buffer[offset]))) offset += 1;
    return buffer.toString('ascii', start, offset);
  };
  const width = Number(readToken());
  const height = Number(readToken());
  const maxValue = Number(readToken());
  if (
    !Number.isInteger(width)
    || width <= 0
    || !Number.isInteger(height)
    || height <= 0
    || maxValue !== 255
    || offset >= buffer.length
    || !/\s/u.test(String.fromCharCode(buffer[offset]))
  ) return null;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_IMAGE_PIXELS) {
    fail('SCREENSHOT_TOO_LARGE', 'screenshot dimensions exceed the verifier bound');
  }
  offset += 1;
  if (buffer.length - offset !== width * height * 3) return null;
  return { width, height };
}

function inspectScreenshot(artifact) {
  const { bytes } = artifact;
  const dimensions = inspectPng(bytes) ?? inspectP6(bytes);
  if (!dimensions) fail('SCREENSHOT_INVALID', 'screenshot bytes are not a supported complete image');
  return dimensions;
}

export function validateLiveCoverage({ contract, coverageArtifact, artifactStore }) {
  const coverageRows = readJsonLines(coverageArtifact);
  const knownRowIds = new Set(Object.values(contract.required_row_registry.waves).flat());
  for (const row of coverageRows) {
    assertExactObject(
      row,
      contract.object_schemas.coverage_row.required_fields,
      `coverage row ${row.row_id ?? '<unknown>'}`,
    );
    assertSchemaVersion(row, contract.version, `coverage row ${row.row_id}`);
    if (!Array.isArray(row.raw_artifact_refs)) {
      fail('INVALID_FIELD', `coverage row ${row.row_id} raw_artifact_refs must be an array`);
    }
    for (const [index, artifact] of row.raw_artifact_refs.entries()) {
      assertArtifactRef(contract, artifact, `coverage row ${row.row_id} raw artifact ${index}`);
    }
    const rowAdapter = contract.row_adapters[row.row_id];
    if (!knownRowIds.has(row.row_id)) {
      fail('UNKNOWN_REQUIRED_ROW', `coverage references unknown required row ${row.row_id}`);
    }
    const rawArtifacts = (row.raw_artifact_refs ?? []).map((artifact) => (
      resolveAndVerifyPacketArtifact(artifactStore, artifact)
    ));
    if (row.row_id === contract.wave_posture_policies.A.row_id && rawArtifacts.length > 0) {
      const waveAPosture = readJsonFile(rawArtifacts[0], 'Wave A posture');
      if (
        waveAPosture.persona?.direct_media_enabled
        !== contract.wave_posture_policies.A.persona_direct_media_enabled
      ) {
        fail(
          'WAVE_A_PERSONA_DIRECT_MEDIA_ENABLED',
          'Wave A must keep Persona direct media publication fail closed',
        );
      }
      assertExactObject(
        waveAPosture,
        contract.object_schemas.wave_a_posture.required_fields,
        'Wave A posture',
      );
      assertExactObject(
        waveAPosture.persona,
        contract.object_schemas.wave_a_persona.required_fields,
        'Wave A Persona posture',
      );
      assertSchemaVersion(waveAPosture, contract.version, 'Wave A posture');
    }
    if (row.row_id === contract.wave_posture_policies.R.row_id && rawArtifacts.length > 0) {
      const waveRPosture = readJsonFile(rawArtifacts[0], 'Wave R posture');
      if (
        waveRPosture.realtime?.polling_posture
          !== contract.wave_posture_policies.R.polling_posture
        || waveRPosture.realtime?.upstream_connection_observed
          !== contract.wave_posture_policies.R.upstream_connection_observed
      ) {
        fail(
          'WAVE_R_REALTIME_POSTURE_INVALID',
          'Wave R requires observed upstream realtime and fallback-only polling',
        );
      }
      assertExactObject(
        waveRPosture,
        contract.object_schemas.wave_r_posture.required_fields,
        'Wave R posture',
      );
      assertExactObject(
        waveRPosture.realtime,
        contract.object_schemas.wave_r_realtime.required_fields,
        'Wave R realtime posture',
      );
      assertSchemaVersion(waveRPosture, contract.version, 'Wave R posture');
    }
    if (row.row_id === contract.wave_posture_policies.B.row_id && rawArtifacts.length > 0) {
      const waveBPosture = readJsonFile(rawArtifacts[0], 'Wave B posture');
      if (
        waveBPosture.media?.finalize_status
          !== contract.wave_posture_policies.B.finalize_status
        || waveBPosture.media?.cleanup_status
          !== contract.wave_posture_policies.B.cleanup_status
        || waveBPosture.media?.signed_upload_credential_surface
          !== contract.wave_posture_policies.B.signed_upload_credential_surface
      ) {
        fail(
          'WAVE_B_MEDIA_POSTURE_UNRESOLVED',
          'Wave B requires resolved finalize/cleanup and Runtime-private signed-upload custody',
        );
      }
      assertExactObject(
        waveBPosture,
        contract.object_schemas.wave_b_posture.required_fields,
        'Wave B posture',
      );
      assertExactObject(
        waveBPosture.media,
        contract.object_schemas.wave_b_media.required_fields,
        'Wave B media posture',
      );
      assertSchemaVersion(waveBPosture, contract.version, 'Wave B posture');
    }
    if (rowAdapter?.evidence_kind === 'live_shell' && row.execution_status !== 'executed') {
      fail(
        'REQUIRED_SHELL_ROW_NOT_EXECUTED',
        `required live row ${row.row_id} must carry executed shell evidence`,
      );
    }
    if (rowAdapter?.evidence_kind === 'live_shell' && !row.shell_report_ref) {
      fail('REQUIRED_SHELL_ROW_MISSING', `required live row ${row.row_id} has no shell report`);
    }
    if (!row.shell_report_ref) {
      continue;
    }
    const reportArtifact = resolveAndVerifyPacketArtifact(artifactStore, row.shell_report_ref);
    const report = readJsonFile(reportArtifact, `live report ${row.row_id}`);
    const expectedAuthority = contract.live_shell_policy.launch_postures[report.launch?.posture];
    if (
      !expectedAuthority
      || report.launch?.authority !== expectedAuthority
      || report.caller?.observed_by !== contract.live_shell_policy.caller_observer
      || report.caller?.mode !== contract.live_shell_policy.caller_mode
    ) {
      fail(
        'INVALID_LIVE_SHELL_POSTURE',
        `live row ${row.row_id} does not use a Runtime-observed admitted launch posture`,
      );
    }
    const expectedShellType = contract.row_adapters[row.row_id]?.shell_type;
    if (
      report.execution_status !== 'executed'
      || report.row_id !== row.row_id
      || report.executable?.shell_type !== expectedShellType
      || !Number.isInteger(report.executable?.process_id)
      || report.executable.process_id <= 0
      || typeof report.executable?.name !== 'string'
      || report.executable.name.length === 0
    ) {
      fail('INVALID_LIVE_SHELL_POSTURE', `live row ${row.row_id} has invalid process or shell metadata`);
    }
    const viewports = report.ui?.viewports;
    const screenshots = report.ui?.screenshots;
    const hasDesktop = Array.isArray(viewports)
      && viewports.some((viewport) => (
        viewport.kind === 'desktop' && viewport.width >= 1024 && viewport.height > 0
      ));
    const hasNarrow = Array.isArray(viewports)
      && viewports.some((viewport) => (
        viewport.kind === 'narrow' && viewport.width > 0 && viewport.width <= 480 && viewport.height > 0
      ));
    const screenshotViewportIds = new Set(
      Array.isArray(screenshots) ? screenshots.map((screenshot) => screenshot.viewport_id) : [],
    );
    const allViewportsCaptured = Array.isArray(viewports)
      && viewports.every((viewport) => screenshotViewportIds.has(viewport.id));
    if (
      !report.ui?.dom_ref
      || !report.ui?.accessibility_ref
      || !hasDesktop
      || !hasNarrow
      || !Array.isArray(screenshots)
      || screenshots.length < 2
      || !allViewportsCaptured
    ) {
      fail(
        'LIVE_UI_METADATA_MISSING',
        `live row ${row.row_id} requires DOM, accessibility, desktop, narrow, and screenshot metadata`,
      );
    }
    const runtimeErrors = [
      ...(Array.isArray(report.console_errors) ? report.console_errors : []),
      ...(Array.isArray(report.page_errors) ? report.page_errors : []),
    ];
    if (runtimeErrors.some((error) => (
      error.disposition !== 'explained'
      || typeof error.explanation !== 'string'
      || error.explanation.length === 0
      || !error.source_ref
    ))) {
      fail(
        'UNEXPLAINED_RUNTIME_ERROR',
        `live row ${row.row_id} contains an unexplained console or page error`,
      );
    }
    assertArtifactRef(contract, row.shell_report_ref, `coverage row ${row.row_id} shell report`);
    assertExactObject(
      report,
      contract.object_schemas.live_shell_report.required_fields,
      `live report ${row.row_id}`,
    );
    assertSchemaVersion(report, contract.version, `live report ${row.row_id}`);
    assertExactObject(report.executable, contract.object_schemas.live_executable.required_fields, 'live executable');
    assertExactObject(report.launch, contract.object_schemas.live_launch.required_fields, 'live launch');
    assertExactObject(report.caller, contract.object_schemas.live_caller.required_fields, 'live caller');
    assertExactObject(report.runtime, contract.object_schemas.live_runtime.required_fields, 'live Runtime');
    assertExactObject(report.ui, contract.object_schemas.live_ui.required_fields, 'live UI');
    if (
      /[\\/]/u.test(report.executable.name)
      || !Array.isArray(report.caller.capability_refs)
      || report.caller.capability_refs.length === 0
      || report.caller.capability_refs.some((item) => typeof item !== 'string' || item.length === 0)
      || [
        report.caller.session_generation,
        report.caller.grant_generation,
        report.caller.release_generation,
        report.caller.account_generation,
      ].some((generation) => !Number.isInteger(generation) || generation <= 0)
      || [
        report.caller.app_id,
        report.caller.release_ref,
        report.caller.app_instance_id,
        report.caller.device_id,
      ].some((item) => typeof item !== 'string' || item.length === 0)
      || typeof report.runtime.executable_name !== 'string'
      || report.runtime.executable_name.length === 0
      || /[\\/]/u.test(report.runtime.executable_name)
      || !/^[a-f0-9]{64}$/u.test(report.runtime.executable_sha256)
      || !Number.isInteger(report.runtime.process_id)
      || report.runtime.process_id <= 0
      || !Number.isInteger(report.runtime.generation)
      || report.runtime.generation <= 0
      || typeof report.runtime.endpoint_class !== 'string'
      || report.runtime.endpoint_class.length === 0
      || report.runtime.health_observed !== true
      || typeof report.runtime.realm_connection_observed !== 'boolean'
      || !Array.isArray(report.actions)
      || report.actions.length === 0
      || !Array.isArray(report.failure_states)
      || report.failure_states.length === 0
      || !Array.isArray(report.faults)
      || report.faults.length === 0
    ) {
      fail('INVALID_LIVE_SHELL_POSTURE', `live row ${row.row_id} has invalid trusted runtime metadata`);
    }
    assertArtifactRef(contract, report.ui.dom_ref, `live report ${row.row_id} DOM`);
    assertArtifactRef(contract, report.ui.accessibility_ref, `live report ${row.row_id} accessibility`);
    resolveAndVerifyPacketArtifact(artifactStore, report.ui.dom_ref);
    resolveAndVerifyPacketArtifact(artifactStore, report.ui.accessibility_ref);
    for (const viewport of report.ui.viewports) {
      assertExactObject(viewport, contract.object_schemas.viewport.required_fields, 'live viewport');
      if (
        typeof viewport.id !== 'string'
        || viewport.id.length === 0
        || !Number.isInteger(viewport.width)
        || !Number.isInteger(viewport.height)
      ) {
        fail('LIVE_UI_METADATA_MISSING', `live row ${row.row_id} has invalid viewport metadata`);
      }
    }
    for (const screenshot of report.ui.screenshots) {
      assertExactObject(screenshot, contract.object_schemas.screenshot.required_fields, 'live screenshot');
      assertArtifactRef(contract, screenshot.artifact_ref, 'live screenshot artifact');
      const screenshotArtifact = resolveAndVerifyPacketArtifact(
        artifactStore,
        screenshot.artifact_ref,
        {
          maxBytes: contract.packet_resource_policy.max_screenshot_compressed_bytes,
          limitCode: 'SCREENSHOT_COMPRESSED_TOO_LARGE',
        },
      );
      const dimensions = inspectScreenshot(screenshotArtifact);
      const viewport = report.ui.viewports.find((item) => item.id === screenshot.viewport_id);
      if (
        !viewport
        || screenshot.width !== viewport.width
        || screenshot.height !== viewport.height
        || Number.isNaN(Date.parse(screenshot.captured_at))
      ) {
        fail('LIVE_UI_METADATA_MISSING', `live row ${row.row_id} screenshot metadata is inconsistent`);
      }
      if (dimensions.width !== screenshot.width || dimensions.height !== screenshot.height) {
        fail('SCREENSHOT_DIMENSION_MISMATCH', 'screenshot byte dimensions disagree with metadata');
      }
    }
    for (const action of report.actions) {
      assertExactObject(action, contract.object_schemas.live_action.required_fields, 'live action');
      if (
        typeof action.id !== 'string'
        || action.id.length === 0
        || typeof action.state !== 'string'
        || action.state.length === 0
        || Number.isNaN(Date.parse(action.occurred_at))
      ) {
        fail('INVALID_LIVE_SHELL_POSTURE', `live row ${row.row_id} has invalid action metadata`);
      }
      assertArtifactRef(contract, action.dom_observation_ref, 'live action DOM observation');
      resolveAndVerifyPacketArtifact(artifactStore, action.dom_observation_ref);
    }
    for (const failureState of report.failure_states) {
      assertExactObject(
        failureState,
        contract.object_schemas.live_failure_state.required_fields,
        'live failure state',
      );
      if (
        typeof failureState.state !== 'string'
        || failureState.state.length === 0
        || failureState.observed !== true
      ) {
        fail('INVALID_LIVE_SHELL_POSTURE', `live row ${row.row_id} has unobserved failure metadata`);
      }
      assertArtifactRef(contract, failureState.source_ref, 'live failure-state source');
      resolveAndVerifyPacketArtifact(artifactStore, failureState.source_ref);
    }
    for (const fault of report.faults) {
      assertExactObject(fault, contract.object_schemas.live_fault.required_fields, 'live fault');
      if (
        typeof fault.kind !== 'string'
        || fault.kind.length === 0
        || Number.isNaN(Date.parse(fault.injected_at))
        || fault.recovery_observed !== true
      ) {
        fail('INVALID_LIVE_SHELL_POSTURE', `live row ${row.row_id} has invalid fault metadata`);
      }
      assertArtifactRef(contract, fault.source_ref, 'live fault source');
      resolveAndVerifyPacketArtifact(artifactStore, fault.source_ref);
    }
    assertArtifactRef(contract, report.leak_probe_ref, 'live leak probe');
    resolveAndVerifyPacketArtifact(artifactStore, report.leak_probe_ref);
    for (const error of runtimeErrors) {
      assertExactObject(error, contract.object_schemas.runtime_error.required_fields, 'runtime error');
      assertArtifactRef(contract, error.source_ref, 'runtime error source');
      resolveAndVerifyPacketArtifact(artifactStore, error.source_ref);
    }
  }
  return coverageRows;
}
