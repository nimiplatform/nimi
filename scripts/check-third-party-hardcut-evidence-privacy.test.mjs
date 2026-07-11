import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import { loadEvidenceContract } from './lib/third-party-hardcut-evidence-contract.mjs';
import { PacketArtifactStore } from './lib/third-party-hardcut-evidence-paths.mjs';
import { rejectProhibitedPacketMaterial } from './lib/third-party-hardcut-evidence-privacy.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const contract = loadEvidenceContract(path.join(
  scriptDir,
  '..',
  '.nimi',
  'contracts',
  'third-party-hardcut-evidence.schema.yaml',
));
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

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

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBytes.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 8 + data.length);
  return chunk;
}

function makeBoundaryPng(textChunkType, textData, textPayloadOffset) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const bytesBeforeOpaqueData = PNG_SIGNATURE.length + 25 + 8;
  const opaqueLength = contract.packet_resource_policy.stream_chunk_bytes
    - 1
    - bytesBeforeOpaqueData
    - 12
    - textPayloadOffset;
  assert.ok(opaqueLength > 0);
  const textPayloadStart = bytesBeforeOpaqueData
    + opaqueLength
    + 12
    + textPayloadOffset;
  assert.equal(textPayloadStart, contract.packet_resource_policy.stream_chunk_bytes - 1);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', header),
    pngChunk('vpAg', Buffer.alloc(opaqueLength, 0xa5)),
    pngChunk(textChunkType, textData),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 17, 34, 51]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function makeTextChunkCase(kind, literal) {
  const keyword = Buffer.from('comment', 'latin1');
  if (kind === 'tEXt') {
    const prefix = Buffer.concat([keyword, Buffer.from([0])]);
    return makeBoundaryPng(kind, Buffer.concat([prefix, Buffer.from(literal)]), prefix.length);
  }
  if (kind === 'zTXt') {
    const prefix = Buffer.concat([keyword, Buffer.from([0, 0])]);
    return makeBoundaryPng(
      kind,
      Buffer.concat([prefix, deflateSync(Buffer.from(literal))]),
      prefix.length,
    );
  }
  const compressed = kind === 'iTXt-compressed';
  const prefix = Buffer.concat([
    keyword,
    Buffer.from([0, compressed ? 1 : 0, 0]),
    Buffer.from('en', 'ascii'),
    Buffer.from([0]),
    Buffer.from('safe label', 'utf8'),
    Buffer.from([0]),
  ]);
  const payload = compressed
    ? deflateSync(Buffer.from(literal))
    : Buffer.from(literal);
  return makeBoundaryPng('iTXt', Buffer.concat([prefix, payload]), prefix.length);
}

function assertDecodedCanaryRejected(kind, literal) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nimi-hardcut-png-canary-'));
  try {
    fs.writeFileSync(path.join(root, 'metadata.bin'), makeTextChunkCase(kind, literal));
    const store = new PacketArtifactStore(
      root,
      contract.packet_resource_policy,
      contract.privacy_scan_policy,
    );
    assert.throws(
      () => rejectProhibitedPacketMaterial(
        store,
        contract.privacy_scan_policy,
        contract.packet_resource_policy,
      ),
      (error) => {
        assert.equal(error.code, 'PROHIBITED_PACKET_MATERIAL');
        assert.equal(error.message.includes(literal), false);
        assert.doesNotMatch(error.message, /metadata\.bin/iu);
        return true;
      },
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

for (const kind of ['tEXt', 'zTXt', 'iTXt-uncompressed', 'iTXt-compressed']) {
  test(`rejects every canonical canary from boundary-spanning ${kind} metadata`, () => {
    for (const literal of contract.privacy_scan_policy.synthetic_canary_literals) {
      assertDecodedCanaryRejected(kind, literal);
    }
  });
}
