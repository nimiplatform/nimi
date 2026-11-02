package runtimeagent

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"os"
	"sort"
	"testing"
)

// Each fixture key is a distinct Character. Rebuild and verify the signed
// packet instead of bypassing the production one-partner commit boundary.
func testPersonaCharacterRef(key string) sourceMaterializationCharacterSourceRefV3 {
	raw, err := os.ReadFile(sourceMaterializationReferenceVectorPathV3("persona-character"))
	if err != nil {
		panic(err)
	}
	var vector sourceMaterializationReferenceVectorV3
	if err := json.Unmarshal(raw, &vector); err != nil {
		panic(err)
	}
	var packet sourceMaterializationPacketV3Value
	if err := json.Unmarshal(vector.Packet, &packet); err != nil {
		panic(err)
	}
	var source sourceMaterializationCanonicalSourceWireV3
	if err := json.Unmarshal(packet.SemanticPayload.CanonicalSourceRaw, &source); err != nil {
		panic(err)
	}
	var profile struct {
		ProfileHash string `json:"profileHash"`
	}
	if err := json.Unmarshal(source.Profile, &profile); err != nil {
		panic(err)
	}
	ref := packet.SourceRef
	ref.ID = "fixture-" + sha256HexBytes([]byte(key))[:24]
	ref.SourceHash, err = hashSourceMaterializationRealmDomainV3(sourceMaterializationPersonaCharacterHashDomainV3, map[string]any{
		"sourceKind": ref.Kind, "schemaVersion": source.SchemaVersion, "id": ref.ID,
		"contentRevision": source.ContentRevision, "ownerAccountId": source.OwnerAccountID,
		"visibility": source.Visibility, "worldId": source.WorldID,
		"lorebookDeclaration": source.LorebookDeclaration, "profileHash": profile.ProfileHash,
	})
	if err != nil {
		panic(err)
	}
	return ref
}

func verifiedPersonaCharacterFixture(t *testing.T, key string) verifiedSourceMaterializationV3 {
	t.Helper()
	verified := verifiedRealmSourceMaterializationVectorV3(t, "persona-character")
	packet := &verified.Packet
	payload := &packet.SemanticPayload
	oldID := packet.SourceRef.Kind + ":" + packet.SourceRef.ID
	ref := testPersonaCharacterRef(key)
	newID := ref.Kind + ":" + ref.ID
	packet.SourceRef, payload.SourceRef, payload.MaterializationContext.SourceRef = ref, ref, ref
	payload.CanonicalSource.ID, payload.CanonicalSource.SourceHash = ref.ID, ref.SourceHash
	payload.CanonicalSourceRaw = nil
	source, err := sourceMaterializationCanonicalSourceSemanticV3(*payload)
	if err != nil {
		t.Fatal(err)
	}
	payload.CanonicalSourceRaw, err = canonicalizeSourceMaterializationJCS(source)
	if err != nil {
		t.Fatal(err)
	}
	payload.MaterializationContext.SourceComponentDigests[0].ComponentID = newID
	for i := range payload.MaterializationCoverage.Components {
		if payload.MaterializationCoverage.Components[i].ComponentID == oldID {
			payload.MaterializationCoverage.Components[i].ComponentID = newID
		}
	}
	sort.Slice(payload.MaterializationCoverage.Components, func(i, j int) bool {
		return payload.MaterializationCoverage.Components[i].ComponentID < payload.MaterializationCoverage.Components[j].ComponentID
	})
	coverageHash, err := sourceMaterializationCoverageHashV3(payload.MaterializationCoverage)
	if err != nil {
		t.Fatal(err)
	}
	payload.MaterializationCoverage.MaterializationCoverageHash = coverageHash
	payload.MaterializationCoverageHash, payload.MaterializationContext.MaterializationCoverageHash = coverageHash, coverageHash
	contextHash, err := sourceMaterializationContextHashV3(payload.MaterializationContext)
	if err != nil {
		t.Fatal(err)
	}
	payload.MaterializationContext.MaterializationContextHash = contextHash
	payload.MaterializationContextHash, packet.MaterializationContextHash = contextHash, contextHash
	packet.PayloadHash, err = sourceMaterializationPayloadHashV3(*payload)
	if err != nil {
		t.Fatal(err)
	}
	values, _, err := sourceMaterializationSemanticComponentMapV3(*packet)
	if err != nil {
		t.Fatal(err)
	}
	chunkOrdinal := uint64(0)
	for i := range packet.OrderedSegments {
		segment := &packet.OrderedSegments[i]
		segment.SegmentManifest.Chunks = nil
		for j := range segment.OrderedComponents {
			component := &segment.OrderedComponents[j]
			if component.ComponentID == oldID {
				component.ComponentID = newID
			}
			value := values[component.ComponentID]
			raw, err := canonicalizeSourceMaterializationJCS(value)
			if err != nil {
				t.Fatal(err)
			}
			decoded, err := decodeSourceMaterializationJSON(raw)
			if err != nil {
				t.Fatal(err)
			}
			component.ContentHash, err = sourceMaterializationComponentContentHashV3(component.Kind, decoded)
			if err != nil {
				t.Fatal(err)
			}
			component.CanonicalBytesHash, component.CanonicalByteLength = sha256HexBytes(raw), uint64(len(raw))
			component.CanonicalBytes = []string{base64.RawURLEncoding.EncodeToString(raw)}
			manifest := &segment.SegmentManifest.Components[j]
			manifest.ComponentID, manifest.ContentHash = component.ComponentID, component.ContentHash
			manifest.CanonicalBytesHash, manifest.CanonicalByteLength = component.CanonicalBytesHash, component.CanonicalByteLength
			segment.SegmentManifest.Chunks = append(segment.SegmentManifest.Chunks, sourceMaterializationChunkDescriptorV3{
				GlobalChunkOrdinal: chunkOrdinal, GlobalComponentOrdinal: manifest.GlobalComponentOrdinal,
				Length: uint64(len(raw)), ChunkSHA256: sha256HexBytes(raw),
			})
			chunkOrdinal++
		}
	}
	privateKey := sourceMaterializationTestPrivateKey(t)
	packet.KeyID = sourceMaterializationSegmentationTestKeyIDV3
	sourceMaterializationSegmentationTestRehashAndSignV3(t, packet, privateKey)
	raw, err := json.Marshal(packet)
	if err != nil {
		t.Fatal(err)
	}
	jwks, err := realmSourceMaterializationServiceTestJWKS(privateKey, packet.KeyID)
	if err != nil {
		t.Fatal(err)
	}
	expectation := sourceMaterializationExpectationFromVectorV3(t, loadSourceMaterializationReferenceVectorV3(t, "persona-character"))
	expectation.Challenge.SourceRef = ref
	result, err := verifySourceMaterializationPacketV3(bytes.NewReader(raw), bytes.NewReader(jwks), expectation)
	if err != nil {
		t.Fatal(err)
	}
	return result
}
