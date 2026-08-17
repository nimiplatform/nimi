package ai

import (
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimeidentity"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
)

const (
	voiceAssetDeleteRetryCooldown    = 30 * time.Second
	maxVoiceAssetDeleteRetryAttempts = 4
)

type voiceAssetCloudBinding struct {
	CapabilityContract  string
	Implementation      *runtimev1.CapabilityImplementationIdentity
	ProviderModelTarget *structpb.Struct
	ConnectorID         string
}

func (b *voiceAssetCloudBinding) Clone() *voiceAssetCloudBinding {
	if b == nil {
		return nil
	}
	implementation, _ := proto.Clone(b.Implementation).(*runtimev1.CapabilityImplementationIdentity)
	target, _ := proto.Clone(b.ProviderModelTarget).(*structpb.Struct)
	return &voiceAssetCloudBinding{
		CapabilityContract: strings.TrimSpace(b.CapabilityContract), Implementation: implementation,
		ProviderModelTarget: target, ConnectorID: strings.TrimSpace(b.ConnectorID),
	}
}

func (b *voiceAssetCloudBinding) Valid() bool {
	return b != nil &&
		b.CapabilityContract == "voice.create" &&
		b.Implementation != nil &&
		strings.TrimSpace(b.Implementation.GetImplementationId()) != "" &&
		strings.TrimSpace(b.Implementation.GetDriverId()) != "" &&
		strings.TrimSpace(b.Implementation.GetDriverDialect()) != "" &&
		b.ProviderModelTarget != nil && len(b.ProviderModelTarget.GetFields()) > 0 &&
		strings.TrimSpace(b.ConnectorID) != ""
}

type voiceAssetStore struct {
	mu            sync.RWMutex
	assets        map[string]*runtimev1.VoiceAsset
	targets       map[string]*runtimeidentity.Target
	cloudBindings map[string]*voiceAssetCloudBinding
	pending       map[string]bool
	durablePath   string
}

type voiceAssetDeleteResult struct {
	Attempted              bool
	Succeeded              bool
	ReconciliationRequired bool
	PendingReconciliation  bool
	Exhausted              bool
	DeleteSemantics        string
	LastError              string
	LastAttemptAt          time.Time
	NextRetryAfter         time.Time
	RetryAttemptCount      int
}

func newVoiceAssetStore() *voiceAssetStore {
	return &voiceAssetStore{
		assets:        make(map[string]*runtimev1.VoiceAsset),
		targets:       make(map[string]*runtimeidentity.Target),
		cloudBindings: make(map[string]*voiceAssetCloudBinding),
		pending:       make(map[string]bool),
	}
}

func cloneVoiceAsset(input *runtimev1.VoiceAsset) *runtimev1.VoiceAsset {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.VoiceAsset)
	if !ok {
		return nil
	}
	return out
}

func cloneVoiceReference(input *runtimev1.VoiceReference) *runtimev1.VoiceReference {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.VoiceReference)
	if !ok {
		return nil
	}
	return out
}

func cloneScenarioJob(input *runtimev1.ScenarioJob) *runtimev1.ScenarioJob {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioJob)
	if !ok {
		return nil
	}
	return out
}

func cloneScenarioJobEvent(input *runtimev1.ScenarioJobEvent) *runtimev1.ScenarioJobEvent {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioJobEvent)
	if !ok {
		return nil
	}
	return out
}

func cloneScenarioHead(input *runtimev1.ScenarioRequestHead) *runtimev1.ScenarioRequestHead {
	if input == nil {
		return nil
	}
	cloned := proto.Clone(input)
	out, ok := cloned.(*runtimev1.ScenarioRequestHead)
	if !ok {
		return nil
	}
	return out
}

func structFromMap(values map[string]any) *structpb.Struct {
	if len(values) == 0 {
		return nil
	}
	out, err := structpb.NewStruct(values)
	if err != nil {
		return nil
	}
	return out
}

func metadataMap(input *structpb.Struct) map[string]any {
	if input == nil {
		return map[string]any{}
	}
	out := make(map[string]any, len(input.GetFields()))
	for key, value := range input.GetFields() {
		out[key] = value.AsInterface()
	}
	return out
}

func mergeStructFields(existing *structpb.Struct, values map[string]any) *structpb.Struct {
	merged := metadataMap(existing)
	for key, value := range values {
		merged[key] = value
	}
	return structFromMap(merged)
}

func applyVoiceAssetDeleteResultMetadata(asset *runtimev1.VoiceAsset, result voiceAssetDeleteResult, now time.Time) {
	if asset == nil {
		return
	}
	fields := metadataMap(asset.GetMetadata())
	if strings.TrimSpace(anyString(fields["deleted_at"])) == "" {
		fields["deleted_at"] = now.Format(time.RFC3339Nano)
	}
	fields["provider_delete_attempted"] = result.Attempted
	fields["provider_delete_succeeded"] = result.Succeeded
	fields["provider_delete_reconciliation_pending"] = result.PendingReconciliation
	fields["provider_delete_reconciliation_exhausted"] = result.Exhausted
	if strings.TrimSpace(result.DeleteSemantics) != "" {
		fields["provider_delete_semantics_effective"] = strings.TrimSpace(result.DeleteSemantics)
	}
	if !result.LastAttemptAt.IsZero() {
		fields["provider_delete_last_attempt_at"] = result.LastAttemptAt.UTC().Format(time.RFC3339Nano)
	}
	if result.RetryAttemptCount > 0 {
		fields["provider_delete_retry_attempt_count"] = float64(result.RetryAttemptCount)
	}
	if !result.NextRetryAfter.IsZero() {
		fields["provider_delete_next_retry_at"] = result.NextRetryAfter.UTC().Format(time.RFC3339Nano)
	} else {
		delete(fields, "provider_delete_next_retry_at")
	}
	if strings.TrimSpace(result.LastError) != "" {
		fields["provider_delete_last_error"] = strings.TrimSpace(result.LastError)
	} else {
		delete(fields, "provider_delete_last_error")
	}
	if result.ReconciliationRequired {
		fields["provider_delete_runtime_reconciliation_required"] = true
	}
	asset.Metadata = structFromMap(fields)
}

func anyString(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	default:
		return ""
	}
}

func isTerminalScenarioJobStatus(status runtimev1.ScenarioJobStatus) bool {
	switch status {
	case runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_CANCELED,
		runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_TIMEOUT:
		return true
	default:
		return false
	}
}
