package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-space-identity
// This is vector compatibility metadata, not an execution or configuration key.
// Hashing captured semantics lets Apps compare spaces without exposing their
// private composition or re-embedding every indexed document to compare it.
func embeddingSpaceID(kind, connectorRef string, vectors []*runtimev1.EmbeddingVector, parts ...proto.Message) (string, error) {
	if len(vectors) == 0 || len(vectors[0].GetValues()) == 0 {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	dimensions := len(vectors[0].GetValues())
	for _, vector := range vectors {
		if len(vector.GetValues()) != dimensions {
			return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
	}
	encoded := make([][]byte, 0, len(parts))
	for _, part := range parts {
		value, err := (proto.MarshalOptions{Deterministic: true}).Marshal(part)
		if err != nil {
			return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if len(value) == 0 {
			value = nil
		}
		encoded = append(encoded, value)
	}
	payload, err := json.Marshal(struct {
		Kind         string
		ConnectorRef string
		Dimensions   int
		Parts        [][]byte
	}{kind, connectorRef, dimensions, encoded})
	if err != nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	digest := sha256.Sum256(payload)
	return "emb-v1-" + hex.EncodeToString(digest[:]), nil
}

func localEmbeddingSpaceID(effective *localEmbedEffectiveInputs, vectors []*runtimev1.EmbeddingVector) (string, error) {
	if effective == nil || effective.effectiveInputIdentity == nil {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	identity := proto.Clone(effective.effectiveInputIdentity).(*runtimev1.LoadoutEffectiveInputIdentity)
	// A new Loadout or re-import of identical content does not change its space.
	identity.LoadoutId = ""
	for _, axis := range identity.ModelAxes {
		axis.ModelAssetId = ""
	}
	return embeddingSpaceID("local", "", vectors, identity)
}

func cloudEmbeddingSpaceID(effective *cloudEmbedEffectiveInputs, vectors []*runtimev1.EmbeddingVector) (string, error) {
	return embeddingSpaceID("cloud", effective.connector.ConnectorID, vectors,
		effective.implementation, effective.rawTarget, effective.defaults)
}
