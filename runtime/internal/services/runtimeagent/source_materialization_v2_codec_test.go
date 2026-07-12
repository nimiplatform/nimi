package runtimeagent

import (
	"context"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func sourceMaterializationTestComponentKind(kind string) runtimev1.AgentSourceMaterializationComponentKind {
	return map[string]runtimev1.AgentSourceMaterializationComponentKind{
		"worldCharacter":    runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CHARACTER,
		"realmPersona":      runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_REALM_PERSONA,
		"worldCore":         runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_CORE,
		"worldEntity":       runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_ENTITY,
		"worldRelationship": runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_WORLD_RELATIONSHIP,
		"coverageManifest":  runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_COVERAGE_MANIFEST,
	}[kind]
}

func sourceMaterializationVerifiedControlFixture(t *testing.T, kind string) (*runtimev1.SourceMaterializationBeginControl, sourceMaterializationBeginExpectationsV2, *sourceMaterializationTestJWKSProvider, time.Time) {
	t.Helper()
	begin, componentBytes := sourceMaterializationNormalizeFixture(t, kind, "packet-control-1")
	now := time.Date(2026, 7, 10, 5, 0, 0, 0, time.UTC)
	expiresAt := now.Add(5 * time.Minute)
	limits := sourceMaterializationLimitsV2{MaxBundleBytes: 1 << 20, MaxComponentCount: 64, MaxChunkBytes: 1 << 20, MaxChunks: 256}
	manifest := sourceMaterializationBundleManifestValueV1{
		ManifestSchemaVersion: sourceMaterializationBundleManifestV1, PayloadAssemblyVersion: sourceMaterializationAssemblyV1,
		PacketID: begin.Envelope.PacketID, ChallengeDigest: strings.Repeat("c", 64), Components: begin.Manifest.Components,
		ComponentCount: uint32(len(begin.Manifest.Components)), ChunkCount: uint32(len(begin.Manifest.Components)),
		Chunks: make([]sourceMaterializationManifestChunkV1, 0, len(begin.Manifest.Components)),
	}
	for index, descriptor := range manifest.Components {
		manifest.TotalCanonicalBytes += descriptor.CanonicalByteLength
		manifest.Chunks = append(manifest.Chunks, sourceMaterializationManifestChunkV1{GlobalOrdinal: uint32(index), ComponentOffset: 0, Length: descriptor.CanonicalByteLength, ChunkSHA256: sha256HexBytes(componentBytes[descriptor.ComponentID])})
	}
	manifestHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationManifestHashDomain, manifest)
	if err != nil {
		t.Fatal(err)
	}
	envelope := sourceMaterializationPacketEnvelopeV2{
		PacketSchemaVersion: sourceMaterializationPacketV2SchemaVersion, PacketID: begin.Envelope.PacketID, Issuer: "https://realm.test", KeyID: "materialization-key-1", Algorithm: "RS256", KeyUse: "sig",
		IssuedAt: now.Format("2006-01-02T15:04:05.000Z"), ExpiresAt: expiresAt.Format("2006-01-02T15:04:05.000Z"), Nonce: "nonce-control-1",
		IntendedRuntimeAudience: "runtime-instance:test:account-1", ChallengeID: "challenge-runtime-opaque-1", ChallengeDigest: manifest.ChallengeDigest, ChallengeLimits: limits,
		MaterializerAccountID: "account-1", SourceRef: begin.Envelope.SourceRef, PayloadHash: begin.Envelope.PayloadHash, BundleManifestHash: manifestHash,
	}
	packetHash, err := hashSourceMaterializationDomainJCS(sourceMaterializationPacketHashDomain, envelope)
	if err != nil {
		t.Fatal(err)
	}
	protoSourceKind := runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_REALM_PERSONA
	if kind == "worldCharacter" {
		protoSourceKind = runtimev1.AgentSourceMaterializationSourceKind_AGENT_SOURCE_MATERIALIZATION_SOURCE_KIND_WORLD_CHARACTER
	}
	protoLimits := &runtimev1.SourceMaterializationChallengeLimits{MaxBundleBytes: limits.MaxBundleBytes, MaxComponentCount: limits.MaxComponentCount, MaxChunkBytes: limits.MaxChunkBytes, MaxChunks: limits.MaxChunks}
	protoSourceRef := &runtimev1.SourceMaterializationSourceRef{Kind: protoSourceKind, WorldId: envelope.SourceRef.WorldID, SourceId: envelope.SourceRef.SourceID, SourceContentHash: envelope.SourceRef.SourceContentHash}
	protoManifest := &runtimev1.BundleTransportManifestV1{
		ManifestSchemaVersion:  runtimev1.AgentSourceMaterializationBundleManifestSchemaVersion_AGENT_SOURCE_MATERIALIZATION_BUNDLE_MANIFEST_SCHEMA_VERSION_V1,
		PayloadAssemblyVersion: runtimev1.AgentSourceMaterializationPayloadAssemblyVersion_AGENT_SOURCE_MATERIALIZATION_PAYLOAD_ASSEMBLY_VERSION_V1,
		PacketId:               manifest.PacketID, ChallengeDigest: manifest.ChallengeDigest, TotalCanonicalBytes: manifest.TotalCanonicalBytes, ComponentCount: manifest.ComponentCount, ChunkCount: manifest.ChunkCount,
	}
	for _, descriptor := range manifest.Components {
		protoManifest.Components = append(protoManifest.Components, &runtimev1.SourceMaterializationBundleComponentDescriptorV1{ComponentId: descriptor.ComponentID, Kind: sourceMaterializationTestComponentKind(descriptor.Kind), SchemaVersion: descriptor.SchemaVersion, Revision: descriptor.Revision, ContentHash: descriptor.ContentHash, CanonicalBytesHash: descriptor.CanonicalBytesHash, CanonicalByteLength: descriptor.CanonicalByteLength})
	}
	for _, chunk := range manifest.Chunks {
		protoManifest.Chunks = append(protoManifest.Chunks, &runtimev1.SourceMaterializationBundleChunkDescriptorV1{GlobalOrdinal: chunk.GlobalOrdinal, ComponentOffset: chunk.ComponentOffset, Length: chunk.Length, ChunkSha256: chunk.ChunkSHA256})
	}
	control := &runtimev1.SourceMaterializationBeginControl{
		PacketEnvelope: &runtimev1.SourceMaterializationPacketEnvelopeV2{
			PacketSchemaVersion: runtimev1.AgentSourceMaterializationPacketSchemaVersion_AGENT_SOURCE_MATERIALIZATION_PACKET_SCHEMA_VERSION_V2,
			PacketId:            envelope.PacketID, Issuer: envelope.Issuer, KeyId: envelope.KeyID, Algorithm: runtimev1.AgentSourceMaterializationProofAlgorithm_AGENT_SOURCE_MATERIALIZATION_PROOF_ALGORITHM_RS256,
			KeyUse: runtimev1.AgentSourceMaterializationKeyUse_AGENT_SOURCE_MATERIALIZATION_KEY_USE_SIG, IssuedAt: timestamppb.New(now), ExpiresAt: timestamppb.New(expiresAt), Nonce: envelope.Nonce,
			IntendedRuntimeAudience: envelope.IntendedRuntimeAudience, ChallengeId: envelope.ChallengeID, ChallengeDigest: envelope.ChallengeDigest, ChallengeLimits: protoLimits,
			MaterializerAccountId: envelope.MaterializerAccountID, SourceRef: protoSourceRef, PayloadHash: envelope.PayloadHash, BundleManifestHash: manifestHash, PacketHash: packetHash,
		},
		PacketProof: sourceMaterializationTestProof(t, envelope.KeyID, packetHash, false), BundleTransportManifest: protoManifest,
	}
	provider := &sourceMaterializationTestJWKSProvider{documents: []sourceMaterializationJWKSDocument{{Issuer: envelope.Issuer, Keys: []sourceMaterializationJWK{sourceMaterializationTestJWK(t, envelope.KeyID)}}}}
	expected := sourceMaterializationBeginExpectationsV2{MaterializerAccountID: envelope.MaterializerAccountID, ChallengeID: envelope.ChallengeID, IntendedRuntimeAudience: envelope.IntendedRuntimeAudience, ChallengeDigest: envelope.ChallengeDigest, SourceRef: protoSourceRef, Limits: protoLimits, ExpiresAt: expiresAt.Add(time.Minute)}
	return control, expected, provider, now
}

func TestVerifySourceMaterializationBeginControlV2RecomputesManifestPacketAndProof(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{"worldCharacter", "realmPersona"} {
		t.Run(kind, func(t *testing.T) {
			control, expected, provider, now := sourceMaterializationVerifiedControlFixture(t, kind)
			verified, err := verifySourceMaterializationBeginControlV2(context.Background(), control, expected, now, provider)
			if err != nil {
				t.Fatalf("verifySourceMaterializationBeginControlV2: %v", err)
			}
			if verified.PacketHash != control.GetPacketEnvelope().GetPacketHash() || !isLowerSHA256(verified.KeyFingerprint) {
				t.Fatalf("verified = %#v", verified)
			}
		})
	}
}

func TestVerifySourceMaterializationBeginControlV2FailsClosed(t *testing.T) {
	t.Parallel()
	tests := map[string]func(*runtimev1.SourceMaterializationBeginControl, *sourceMaterializationBeginExpectationsV2){
		"v1 or unspecified schema": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.PacketEnvelope.PacketSchemaVersion = runtimev1.AgentSourceMaterializationPacketSchemaVersion_AGENT_SOURCE_MATERIALIZATION_PACKET_SCHEMA_VERSION_UNSPECIFIED
		},
		"wrong account": func(_ *runtimev1.SourceMaterializationBeginControl, expected *sourceMaterializationBeginExpectationsV2) {
			expected.MaterializerAccountID = "attacker"
		},
		"wrong audience": func(_ *runtimev1.SourceMaterializationBeginControl, expected *sourceMaterializationBeginExpectationsV2) {
			expected.IntendedRuntimeAudience = "runtime-instance:other"
		},
		"chunk offset": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.BundleTransportManifest.Chunks[0].ComponentOffset = 1
		},
		"limit plus one": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.BundleTransportManifest.TotalCanonicalBytes = control.PacketEnvelope.ChallengeLimits.MaxBundleBytes + 1
		},
		"forged proof": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.PacketProof = "forged..proof"
		},
		"empty nonce": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.PacketEnvelope.Nonce = ""
		},
		"empty issuer": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.PacketEnvelope.Issuer = ""
		},
		"wrong algorithm": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.PacketEnvelope.Algorithm = runtimev1.AgentSourceMaterializationProofAlgorithm_AGENT_SOURCE_MATERIALIZATION_PROOF_ALGORITHM_UNSPECIFIED
		},
		"packet hash tamper": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.PacketEnvelope.PacketHash = strings.Repeat("0", 64)
		},
		"manifest hash tamper": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.PacketEnvelope.BundleManifestHash = strings.Repeat("0", 64)
		},
		"source binding": func(_ *runtimev1.SourceMaterializationBeginControl, expected *sourceMaterializationBeginExpectationsV2) {
			expected.SourceRef.SourceId = "source-other"
		},
		"packet expiry exceeds challenge": func(_ *runtimev1.SourceMaterializationBeginControl, expected *sourceMaterializationBeginExpectationsV2) {
			expected.ExpiresAt = expected.ExpiresAt.Add(-2 * time.Minute)
		},
		"unknown component kind": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.BundleTransportManifest.Components[0].Kind = runtimev1.AgentSourceMaterializationComponentKind_AGENT_SOURCE_MATERIALIZATION_COMPONENT_KIND_UNSPECIFIED
		},
		"component count plus one": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.BundleTransportManifest.ComponentCount++
		},
		"chunk count plus one": func(control *runtimev1.SourceMaterializationBeginControl, _ *sourceMaterializationBeginExpectationsV2) {
			control.BundleTransportManifest.ChunkCount++
		},
	}
	for name, mutate := range tests {
		t.Run(name, func(t *testing.T) {
			control, expected, provider, now := sourceMaterializationVerifiedControlFixture(t, "realmPersona")
			mutate(control, &expected)
			if _, err := verifySourceMaterializationBeginControlV2(context.Background(), control, expected, now, provider); err == nil {
				t.Fatal("invalid begin control was admitted")
			}
		})
	}
	t.Run("expired", func(t *testing.T) {
		control, expected, provider, now := sourceMaterializationVerifiedControlFixture(t, "realmPersona")
		if _, err := verifySourceMaterializationBeginControlV2(context.Background(), control, expected, now.Add(6*time.Minute), provider); err == nil {
			t.Fatal("expired packet was admitted")
		}
	})
	t.Run("issuer registry mismatch", func(t *testing.T) {
		control, expected, provider, now := sourceMaterializationVerifiedControlFixture(t, "realmPersona")
		provider.documents[0].Issuer = "https://other-realm.test"
		if _, err := verifySourceMaterializationBeginControlV2(context.Background(), control, expected, now, provider); err == nil {
			t.Fatal("issuer-mismatched JWKS was admitted")
		}
	})
}

func TestSourceMaterializationManifestAcceptsExactLimitsAndRejectsEachLimitPlusOne(t *testing.T) {
	t.Parallel()
	control, _, _, _ := sourceMaterializationVerifiedControlFixture(t, "realmPersona")
	envelope, _, err := envelopeFromProto(control.PacketEnvelope)
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := manifestFromProto(control.BundleTransportManifest)
	if err != nil {
		t.Fatal(err)
	}
	var maxChunk uint64
	for _, chunk := range manifest.Chunks {
		if chunk.Length > maxChunk {
			maxChunk = chunk.Length
		}
	}
	envelope.ChallengeLimits = sourceMaterializationLimitsV2{MaxBundleBytes: manifest.TotalCanonicalBytes, MaxComponentCount: manifest.ComponentCount, MaxChunkBytes: maxChunk, MaxChunks: manifest.ChunkCount}
	if err := validateSourceMaterializationManifestV1(manifest, envelope); err != nil {
		t.Fatalf("exact limits rejected: %v", err)
	}
	for name, mutate := range map[string]func(*sourceMaterializationBundleManifestValueV1, *sourceMaterializationPacketEnvelopeV2){
		"bundle": func(manifest *sourceMaterializationBundleManifestValueV1, envelope *sourceMaterializationPacketEnvelopeV2) {
			envelope.ChallengeLimits.MaxBundleBytes = manifest.TotalCanonicalBytes - 1
		},
		"component": func(_ *sourceMaterializationBundleManifestValueV1, envelope *sourceMaterializationPacketEnvelopeV2) {
			envelope.ChallengeLimits.MaxComponentCount--
		},
		"chunk bytes": func(_ *sourceMaterializationBundleManifestValueV1, envelope *sourceMaterializationPacketEnvelopeV2) {
			envelope.ChallengeLimits.MaxChunkBytes--
		},
		"chunk count": func(_ *sourceMaterializationBundleManifestValueV1, envelope *sourceMaterializationPacketEnvelopeV2) {
			envelope.ChallengeLimits.MaxChunks--
		},
	} {
		t.Run(name, func(t *testing.T) {
			changedManifest := manifest
			changedEnvelope := envelope
			mutate(&changedManifest, &changedEnvelope)
			if err := validateSourceMaterializationManifestV1(changedManifest, changedEnvelope); err == nil {
				t.Fatal("limit+1 was admitted")
			}
		})
	}
}
