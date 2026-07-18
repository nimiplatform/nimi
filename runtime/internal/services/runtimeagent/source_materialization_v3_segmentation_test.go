package runtimeagent

import (
	"bytes"
	"crypto"
	cryptorand "crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

const sourceMaterializationSegmentationTestKeyIDV3 = "segmentation-test-key"

func TestVerifySourceMaterializationPacketV3RejectsNonGreedySegmentationWithValidHashesAndProof(t *testing.T) {
	vector := loadSourceMaterializationReferenceVectorV3(t, "world-character")
	var packet sourceMaterializationPacketV3Value
	if err := strictDecodeSourceMaterializationV3(vector.Packet, &packet); err != nil {
		t.Fatalf("decode reference Packet v3: %v", err)
	}

	// The reference vector uses a three-component segment limit. Splitting its
	// first valid 3-component segment after component 2 opens a segment even
	// though component 3 still fits every published per-segment limit.
	if len(packet.OrderedSegments) < 1 || len(packet.OrderedSegments[0].OrderedComponents) != 3 {
		t.Fatalf("reference vector no longer exercises the expected boundary: %+v", packet.ClosureSetManifest)
	}
	first := packet.OrderedSegments[0]
	left := first
	right := first
	left.OrderedComponents = append([]sourceMaterializationComponentV3(nil), first.OrderedComponents[:2]...)
	right.OrderedComponents = append([]sourceMaterializationComponentV3(nil), first.OrderedComponents[2:]...)
	left.SegmentManifest.Components = append([]sourceMaterializationManifestComponentV3(nil), first.SegmentManifest.Components[:2]...)
	right.SegmentManifest.Components = append([]sourceMaterializationManifestComponentV3(nil), first.SegmentManifest.Components[2:]...)
	left.SegmentManifest.Chunks = sourceMaterializationSegmentationTestChunksV3(first.SegmentManifest.Chunks, 0, 1)
	right.SegmentManifest.Chunks = sourceMaterializationSegmentationTestChunksV3(first.SegmentManifest.Chunks, 2, 2)
	packet.OrderedSegments = append(
		[]sourceMaterializationSegmentV3Value{left, right},
		packet.OrderedSegments[1:]...,
	)

	privateKey, err := rsa.GenerateKey(cryptorand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate test RSA key: %v", err)
	}
	packet.KeyID = sourceMaterializationSegmentationTestKeyIDV3
	jwk := sourceMaterializationSegmentationTestJWKSV3(privateKey)
	sourceMaterializationSegmentationTestRehashAndSignV3(t, &packet, privateKey)

	// Prove the mutation did not merely leave stale manifests, canonical
	// component transport, packetHash, or signature behind. The full verifier
	// must reject the one remaining defect: the non-canonical segment boundary.
	for index, segment := range packet.OrderedSegments {
		hash, hashErr := sourceMaterializationSegmentManifestHashV3(segment.SegmentManifest)
		if hashErr != nil || hash != segment.SegmentManifestHash {
			t.Fatalf("segment %d hash is not self-consistent: got=%s err=%v", index, hash, hashErr)
		}
	}
	closureHash, err := sourceMaterializationClosureSetManifestHashV3(packet.ClosureSetManifest)
	if err != nil || closureHash != packet.ClosureSetManifestHash {
		t.Fatalf("closure-set hash is not self-consistent: got=%s err=%v", closureHash, err)
	}
	packetHash, err := sourceMaterializationPacketHashV3(packet)
	if err != nil || packetHash != packet.PacketHash {
		t.Fatalf("packet hash is not self-consistent: got=%s err=%v", packetHash, err)
	}
	if err := validateSourceMaterializationPayloadV3(&packet.SemanticPayload, packet.SourceRef); err != nil {
		t.Fatalf("reference semantic payload became invalid: %v", err)
	}
	if _, _, err := verifySourceMaterializationTransportV3(&packet); err != nil {
		t.Fatalf("resegmented component transport is invalid: %v", err)
	}
	if _, err := verifySourceMaterializationDetachedProofV3(packet, jwk); err != nil {
		t.Fatalf("re-signed proof is invalid: %v", err)
	}

	packetBytes, err := json.Marshal(packet)
	if err != nil {
		t.Fatalf("encode non-greedy Packet v3: %v", err)
	}
	jwksBytes, err := json.Marshal(jwk)
	if err != nil {
		t.Fatalf("encode current JWKS: %v", err)
	}
	_, err = verifySourceMaterializationPacketV3(
		bytes.NewReader(packetBytes),
		bytes.NewReader(jwksBytes),
		sourceMaterializationExpectationFromVectorV3(t, vector),
	)
	if err == nil || sourceMaterializationV3FailureCode(err) != sourceMaterializationFailurePacketContractV3 ||
		!strings.Contains(err.Error(), "deterministic greedy first-fit") {
		t.Fatalf("non-greedy Packet v3 was not rejected at the deterministic boundary: %v", err)
	}
}

func sourceMaterializationSegmentationTestChunksV3(
	chunks []sourceMaterializationChunkDescriptorV3,
	firstComponentOrdinal uint64,
	lastComponentOrdinal uint64,
) []sourceMaterializationChunkDescriptorV3 {
	selected := make([]sourceMaterializationChunkDescriptorV3, 0, len(chunks))
	for _, chunk := range chunks {
		if chunk.GlobalComponentOrdinal >= firstComponentOrdinal && chunk.GlobalComponentOrdinal <= lastComponentOrdinal {
			selected = append(selected, chunk)
		}
	}
	return selected
}

func sourceMaterializationSegmentationTestRehashAndSignV3(
	t *testing.T,
	packet *sourceMaterializationPacketV3Value,
	privateKey *rsa.PrivateKey,
) {
	t.Helper()
	refs := make([]sourceMaterializationClosureSetSegmentRefV3, 0, len(packet.OrderedSegments))
	manifestComponents := make([]sourceMaterializationManifestComponentV3, 0, packet.ClosureSetManifest.ComponentCount)
	var totalBytes, totalComponents, totalChunks uint64
	for index := range packet.OrderedSegments {
		segment := &packet.OrderedSegments[index]
		manifest := &segment.SegmentManifest
		manifest.SegmentOrdinal = uint64(index)
		manifest.FirstComponentOrdinal = manifest.Components[0].GlobalComponentOrdinal
		manifest.LastComponentOrdinal = manifest.Components[len(manifest.Components)-1].GlobalComponentOrdinal
		manifest.ComponentCount = uint64(len(manifest.Components))
		manifest.ChunkCount = uint64(len(manifest.Chunks))
		manifest.TotalCanonicalBytes = 0
		for _, component := range manifest.Components {
			manifest.TotalCanonicalBytes += component.CanonicalByteLength
		}
		manifestHash, err := sourceMaterializationSegmentManifestHashV3(*manifest)
		if err != nil {
			t.Fatalf("hash segment %d: %v", index, err)
		}
		segment.SegmentManifestHash = manifestHash
		refs = append(refs, sourceMaterializationClosureSetSegmentRefV3{
			SegmentOrdinal:        manifest.SegmentOrdinal,
			FirstComponentOrdinal: manifest.FirstComponentOrdinal,
			LastComponentOrdinal:  manifest.LastComponentOrdinal,
			ComponentCount:        manifest.ComponentCount,
			TotalCanonicalBytes:   manifest.TotalCanonicalBytes,
			ChunkCount:            manifest.ChunkCount,
			SegmentManifestHash:   manifestHash,
		})
		manifestComponents = append(manifestComponents, manifest.Components...)
		totalBytes += manifest.TotalCanonicalBytes
		totalComponents += manifest.ComponentCount
		totalChunks += manifest.ChunkCount
	}
	orderedHash, err := sourceMaterializationOrderedComponentSetHashV3(manifestComponents)
	if err != nil {
		t.Fatalf("hash ordered component set: %v", err)
	}
	packet.ClosureSetManifest.Segments = refs
	packet.ClosureSetManifest.SegmentCount = uint64(len(refs))
	packet.ClosureSetManifest.TotalCanonicalBytes = totalBytes
	packet.ClosureSetManifest.ComponentCount = totalComponents
	packet.ClosureSetManifest.ChunkCount = totalChunks
	packet.ClosureSetManifest.OrderedComponentSetHash = orderedHash
	closureHash, err := sourceMaterializationClosureSetManifestHashV3(packet.ClosureSetManifest)
	if err != nil {
		t.Fatalf("hash closure set: %v", err)
	}
	packet.ClosureSetManifestHash = closureHash
	packetHash, err := sourceMaterializationPacketHashV3(*packet)
	if err != nil {
		t.Fatalf("hash Packet v3: %v", err)
	}
	packet.PacketHash = packetHash
	packet.PacketProof = sourceMaterializationSegmentationTestProofV3(t, privateKey, packetHash)
}

func sourceMaterializationSegmentationTestProofV3(
	t *testing.T,
	privateKey *rsa.PrivateKey,
	packetHash string,
) sourceMaterializationPacketProofV3 {
	t.Helper()
	header, err := canonicalizeSourceMaterializationRealmV3(map[string]any{
		"alg": "RS256",
		"kid": sourceMaterializationSegmentationTestKeyIDV3,
		"typ": "realm-source-materialization",
	})
	if err != nil {
		t.Fatalf("canonicalize protected header: %v", err)
	}
	headerEncoded := base64.RawURLEncoding.EncodeToString(header)
	signedPayload := sourceMaterializationProofDomainV3 + packetHash
	payloadEncoded := base64.RawURLEncoding.EncodeToString([]byte(signedPayload))
	digest := sha256.Sum256([]byte(headerEncoded + "." + payloadEncoded))
	signature, err := rsa.SignPKCS1v15(cryptorand.Reader, privateKey, crypto.SHA256, digest[:])
	if err != nil {
		t.Fatalf("sign Packet v3: %v", err)
	}
	return sourceMaterializationPacketProofV3{
		CompactJWS:    headerEncoded + ".." + base64.RawURLEncoding.EncodeToString(signature),
		SignedPayload: signedPayload,
	}
}

func sourceMaterializationSegmentationTestJWKSV3(privateKey *rsa.PrivateKey) sourceMaterializationJWKSV3 {
	exponent := []byte{byte(privateKey.E >> 16), byte(privateKey.E >> 8), byte(privateKey.E)}
	for len(exponent) > 1 && exponent[0] == 0 {
		exponent = exponent[1:]
	}
	return sourceMaterializationJWKSV3{Keys: []sourceMaterializationJWKKeyV3{{
		KeyType:    "RSA",
		KeyID:      sourceMaterializationSegmentationTestKeyIDV3,
		Use:        "sig",
		Algorithm:  "RS256",
		Operations: []string{"verify"},
		Modulus:    base64.RawURLEncoding.EncodeToString(privateKey.N.Bytes()),
		Exponent:   base64.RawURLEncoding.EncodeToString(exponent),
		Purpose:    "realm-source-materialization",
	}}}
}
