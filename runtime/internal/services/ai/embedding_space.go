package ai

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
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
	return embeddingSpaceIDForDimensions(kind, connectorRef, dimensions, parts...)
}

func embeddingSpaceIDForDimensions(kind, connectorRef string, dimensions int, parts ...proto.Message) (string, error) {
	if dimensions <= 0 {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
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
	return localEmbeddingIdentitySpaceID(effective.effectiveInputIdentity, vectors)
}

func localEmbeddingIdentitySpaceID(input *runtimev1.LoadoutEffectiveInputIdentity, vectors []*runtimev1.EmbeddingVector) (string, error) {
	identity := normalizedEmbeddingIdentity(input)
	return embeddingSpaceID("local", "", vectors, identity)
}

func normalizedEmbeddingIdentity(input *runtimev1.LoadoutEffectiveInputIdentity) *runtimev1.LoadoutEffectiveInputIdentity {
	identity := proto.Clone(input).(*runtimev1.LoadoutEffectiveInputIdentity)
	// A new Loadout or re-import of identical content does not change its space.
	identity.LoadoutId = ""
	for _, axis := range identity.ModelAxes {
		axis.ModelAssetId = ""
	}
	return identity
}

func cloudEmbeddingSpaceID(effective *cloudEmbedEffectiveInputs, vectors []*runtimev1.EmbeddingVector) (string, error) {
	return embeddingSpaceID("cloud", effective.connector.ConnectorID, vectors, cloudEmbeddingSpaceParts(effective)...)
}

func cloudEmbeddingSpaceParts(effective *cloudEmbedEffectiveInputs) []proto.Message {
	// Catalog identity admits the captured target, but its provider-wide
	// inventory revision does not change this model's embedding semantics.
	target := proto.Clone(effective.rawTarget).(*structpb.Struct)
	delete(target.Fields, "remoteModelCatalogId")
	connectorTarget := &structpb.Struct{Fields: map[string]*structpb.Value{
		"endpoint": structpb.NewStringValue(connector.ResolveEndpoint(
			effective.connector.Provider, strings.TrimSpace(effective.connector.Endpoint))),
		"authKind":            structpb.NewStringValue(effective.connector.AuthKind.String()),
		"providerAuthProfile": structpb.NewStringValue(effective.connector.ProviderAuthProfile),
	}}
	return []proto.Message{effective.implementation, target, effective.defaults, connectorTarget}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-output-contract
func validateEmbeddingOutput(vectors []*runtimev1.EmbeddingVector, count, dimension int) error {
	invalid := func() error { return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID) }
	if count <= 0 || dimension <= 0 || len(vectors) != count {
		return invalid()
	}
	for _, vector := range vectors {
		if len(vector.GetValues()) != dimension {
			return invalid()
		}
		for _, value := range vector.GetValues() {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return invalid()
			}
		}
	}
	return nil
}
