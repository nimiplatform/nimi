package memory

import (
	"crypto/sha256"
	"encoding/hex"
	"sort"
	"strconv"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	grpcerr "github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const memoryMetadataFieldEmbeddingGenerationID = "_runtime_embedding_generation_id"

func sortBanks(items []*runtimev1.MemoryBank) {
	sort.Slice(items, func(i, j int) bool {
		if items[i].GetLocator().GetScope() == items[j].GetLocator().GetScope() {
			return items[i].GetBankId() < items[j].GetBankId()
		}
		return items[i].GetLocator().GetScope() < items[j].GetLocator().GetScope()
	})
}

func okAck() *runtimev1.Ack {
	return &runtimev1.Ack{Ok: true, ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED}
}

func cloneBank(input *runtimev1.MemoryBank) *runtimev1.MemoryBank {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryBank)
}

func cloneRecord(input *runtimev1.MemoryRecord) *runtimev1.MemoryRecord {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryRecord)
}

func cloneReflectionResult(input *runtimev1.MemoryReflectionResult) *runtimev1.MemoryReflectionResult {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryReflectionResult)
}

func cloneEvent(input *runtimev1.MemoryEvent) *runtimev1.MemoryEvent {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryEvent)
}

func cloneLocator(input *runtimev1.MemoryBankLocator) *runtimev1.MemoryBankLocator {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryBankLocator)
}

func cloneEmbeddingProfile(input *runtimev1.MemoryEmbeddingProfile) *runtimev1.MemoryEmbeddingProfile {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryEmbeddingProfile)
}

func cloneProvenance(input *runtimev1.MemoryProvenance) *runtimev1.MemoryProvenance {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.MemoryProvenance)
}

func cloneStruct(input *structpb.Struct) *structpb.Struct {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*structpb.Struct)
}

func cloneAppPrivateOwner(input *runtimev1.AppPrivateBankOwner) *runtimev1.AppPrivateBankOwner {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.AppPrivateBankOwner)
}

func cloneWorkspacePrivateOwner(input *runtimev1.WorkspacePrivateBankOwner) *runtimev1.WorkspacePrivateBankOwner {
	if input == nil {
		return nil
	}
	return proto.Clone(input).(*runtimev1.WorkspacePrivateBankOwner)
}

func cloneBankState(input *bankState) *bankState {
	if input == nil {
		return nil
	}
	out := &bankState{
		Bank:                    cloneBank(input.Bank),
		Records:                 make(map[string]*runtimev1.MemoryRecord, len(input.Records)),
		Order:                   append([]string(nil), input.Order...),
		PendingEmbeddingCutover: clonePendingEmbeddingCutoverState(input.PendingEmbeddingCutover),
	}
	for key, record := range input.Records {
		out.Records[key] = cloneRecord(record)
	}
	return out
}

func clonePendingEmbeddingCutoverState(input *pendingEmbeddingCutoverState) *pendingEmbeddingCutoverState {
	if input == nil {
		return nil
	}
	return &pendingEmbeddingCutoverState{
		GenerationID:      strings.TrimSpace(input.GenerationID),
		TargetProfile:     cloneEmbeddingProfile(input.TargetProfile),
		RevisionToken:     strings.TrimSpace(input.RevisionToken),
		ReadyForCutover:   input.ReadyForCutover,
		BlockedReasonCode: input.BlockedReasonCode,
	}
}

func ensureStruct(input *structpb.Struct) *structpb.Struct {
	if input != nil {
		if input.Fields == nil {
			input.Fields = make(map[string]*structpb.Value)
		}
		return input
	}
	return &structpb.Struct{Fields: make(map[string]*structpb.Value)}
}

func currentEmbeddingGenerationID(bank *runtimev1.MemoryBank) string {
	if bank == nil {
		return ""
	}
	return firstStringFromStruct(bank.GetMetadata(), memoryMetadataFieldEmbeddingGenerationID)
}

func setCurrentEmbeddingGenerationID(bank *runtimev1.MemoryBank, generationID string) {
	if bank == nil {
		return
	}
	trimmed := strings.TrimSpace(generationID)
	metadata := ensureStruct(cloneStruct(bank.GetMetadata()))
	if trimmed == "" {
		delete(metadata.Fields, memoryMetadataFieldEmbeddingGenerationID)
	} else {
		metadata.Fields[memoryMetadataFieldEmbeddingGenerationID] = structpb.NewStringValue(trimmed)
	}
	bank.Metadata = metadata
}

func embeddingGenerationID(seed string) string {
	trimmed := strings.TrimSpace(seed)
	if trimmed == "" {
		return ""
	}
	sum := sha256.Sum256([]byte(trimmed))
	return "megen_" + hex.EncodeToString(sum[:8])
}

func clampPageSize(raw int32, fallback int, max int) int {
	value := int(raw)
	if value <= 0 {
		return fallback
	}
	if value > max {
		return max
	}
	return value
}

func decodePageToken(raw string) (int, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return 0, nil
	}
	value, err := strconv.Atoi(trimmed)
	if err != nil || value < 0 {
		return 0, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID)
	}
	return value, nil
}

func encodePageToken(offset int) string {
	if offset <= 0 {
		return ""
	}
	return strconv.Itoa(offset)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func firstStringFromStruct(input *structpb.Struct, field string) string {
	if input == nil {
		return ""
	}
	value := input.GetFields()[field]
	if value == nil {
		return ""
	}
	return strings.TrimSpace(value.GetStringValue())
}

func minInt(a int, b int) int {
	if a < b {
		return a
	}
	return b
}
