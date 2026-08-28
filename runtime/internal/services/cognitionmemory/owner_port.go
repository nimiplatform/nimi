package cognitionmemory

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// OwnerPort is the single active Runtime-side boundary to the Cognition Memory
// owner. Product operations cross it only as the stable protobuf contract;
// Remember execution and derived-index maintenance remain owner-internal.
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r027
type OwnerPort interface {
	EnsureBank(context.Context, *runtimev1.CognitionMemoryEnsureBankRequest) (*runtimev1.CognitionMemoryEnsureBankResponse, error)
	Commit(context.Context, *runtimev1.CognitionMemoryCommitRequest) (*runtimev1.CognitionMemoryCommitResponse, error)
	Recall(context.Context, *runtimev1.CognitionMemoryRecallRequest, memoryv1.EmbeddingPort) (*runtimev1.CognitionMemoryRecallResponse, error)
	Forget(context.Context, *runtimev1.CognitionMemoryForgetRequest) (*runtimev1.CognitionMemoryForgetResponse, error)
	ApplyCutoff(context.Context, *runtimev1.CognitionMemoryApplyCutoffRequest) (*runtimev1.CognitionMemoryApplyCutoffResponse, error)
	DeleteBank(context.Context, *runtimev1.CognitionMemoryDeleteBankRequest) (*runtimev1.CognitionMemoryDeleteBankResponse, error)
	InspectStatus(context.Context, *runtimev1.CognitionMemoryInspectStatusRequest) (*runtimev1.CognitionMemoryInspectStatusResponse, error)
	Inspect(context.Context, *runtimev1.CognitionMemoryInspectRequest) (*runtimev1.CognitionMemoryInspectResponse, error)

	ExecuteRemember(context.Context, string) (memoryv1.DecisionResult, error)
	RebuildEmbedding(context.Context, string, string, memoryv1.CapabilitySnapshot, memoryv1.EmbeddingPort) (memoryv1.Outcome, error)
	NeedsEmbeddingRebuild(context.Context, string, memoryv1.CapabilitySnapshot) (bool, error)
}

type OwnerBindingResolver func(context.Context, string) (Binding, error)
type OwnerCapabilityResolver func(context.Context, Binding) (memoryv1.CapabilitySnapshot, error)

type OwnerAdapter struct {
	core                *memoryv1.Core
	resolveBinding      OwnerBindingResolver
	resolveCapabilities OwnerCapabilityResolver
}

func NewOwnerAdapter(core *memoryv1.Core, resolveBinding OwnerBindingResolver, resolveCapabilities OwnerCapabilityResolver) *OwnerAdapter {
	return &OwnerAdapter{core: core, resolveBinding: resolveBinding, resolveCapabilities: resolveCapabilities}
}

func (a *OwnerAdapter) EnsureBank(ctx context.Context, request *runtimev1.CognitionMemoryEnsureBankRequest) (*runtimev1.CognitionMemoryEnsureBankResponse, error) {
	response := &runtimev1.CognitionMemoryEnsureBankResponse{}
	if err := validateOwnerContractVersion(request.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	if a == nil || a.core == nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnavailable)
		return response, ownerContractError(memoryv1.OutcomeUnavailable, "owner_unavailable")
	}
	result, err := a.core.EnsureBank(ctx, memoryv1.EnsureBankRequest{
		ContractVersion: request.GetContractVersion(),
		BindingRef:      request.GetBankBinding().GetValue(),
		OperationID:     request.GetOperation().GetValue(),
	})
	response.Outcome = ownerProtoOutcome(result.Outcome)
	if result.BindingRef != "" {
		response.BankBinding = &runtimev1.CognitionMemoryBankBindingRef{Value: result.BindingRef}
	}
	if result.BankRef != "" {
		response.Bank = &runtimev1.CognitionMemoryBankRef{Value: result.BankRef}
	}
	if result.LifecycleRef != "" {
		response.LifecycleCutoff = &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: result.LifecycleRef}
	}
	return response, err
}

func (a *OwnerAdapter) Commit(ctx context.Context, request *runtimev1.CognitionMemoryCommitRequest) (*runtimev1.CognitionMemoryCommitResponse, error) {
	response := &runtimev1.CognitionMemoryCommitResponse{}
	envelope := request.GetEnvelope()
	if err := validateOwnerContractVersion(envelope.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	if a == nil || a.core == nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnavailable)
		return response, ownerContractError(memoryv1.OutcomeUnavailable, "owner_unavailable")
	}
	mapped, err := ownerCommitRequest(envelope)
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	result, err := a.core.ReceiveCommittedEvent(ctx, mapped)
	response.Outcome = ownerProtoOutcome(result.Outcome)
	if result.BankRef != "" {
		response.Bank = &runtimev1.CognitionMemoryBankRef{Value: result.BankRef}
	}
	if result.EventRef != "" {
		response.Event = &runtimev1.CognitionMemoryEventRef{Value: result.EventRef}
	}
	if result.OperationID != "" {
		response.Operation = &runtimev1.CognitionMemoryOperationRef{Value: result.OperationID}
	}
	response.DeliverySequence = result.DeliverySequence
	response.ReceivedFrontier = result.ReceivedFrontier
	return response, err
}

func (a *OwnerAdapter) Recall(ctx context.Context, request *runtimev1.CognitionMemoryRecallRequest, embeddingPort memoryv1.EmbeddingPort) (*runtimev1.CognitionMemoryRecallResponse, error) {
	response := &runtimev1.CognitionMemoryRecallResponse{}
	if err := validateOwnerContractVersion(request.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	if a == nil || a.core == nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnavailable)
		return response, ownerContractError(memoryv1.OutcomeUnavailable, "owner_unavailable")
	}
	binding, err := a.ownerBinding(ctx, request.GetBankBinding().GetValue(), request.GetBank().GetValue())
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	subject, err := ownerRecallSubject(request.GetSubjectScope(), binding)
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	snapshot, err := a.ownerCapabilitySnapshot(ctx, binding, request.GetCapabilities())
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	result, err := a.core.Recall(ctx, memoryv1.RecallRequest{
		OperationID: request.GetOperation().GetValue(), BindingRef: binding.BindingRef, BankRef: binding.BankRef,
		LifecycleRef: binding.LifecycleRef, Subject: subject, Query: request.GetQuery(), Limit: int(request.GetLimit()), Capabilities: snapshot,
	}, embeddingPort)
	response.Outcome = ownerProtoOutcome(result.Outcome)
	for _, hit := range result.Hits {
		response.Hits = append(response.Hits, ownerProtoMemory(hit))
	}
	return response, err
}

func (a *OwnerAdapter) Forget(ctx context.Context, request *runtimev1.CognitionMemoryForgetRequest) (*runtimev1.CognitionMemoryForgetResponse, error) {
	response := &runtimev1.CognitionMemoryForgetResponse{}
	if err := validateOwnerContractVersion(request.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	binding, err := a.ownerBinding(ctx, request.GetBankBinding().GetValue(), request.GetBank().GetValue())
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	targets := make([]string, 0, len(request.GetTargets()))
	for _, target := range request.GetTargets() {
		targets = append(targets, target.GetValue())
	}
	result, err := a.core.ForgetExact(ctx, memoryv1.ForgetRequest{
		OperationID: request.GetOperation().GetValue(), BindingRef: binding.BindingRef, BankRef: binding.BankRef,
		LifecycleRef: binding.LifecycleRef, TargetMemoryRefs: targets, Confirmed: request.GetConfirmed(),
	})
	response.Outcome = ownerProtoOutcome(result.Outcome)
	for _, ref := range result.AffectedMemoryRefs {
		response.AffectedMemories = append(response.AffectedMemories, &runtimev1.CognitionMemoryRef{Value: ref})
	}
	return response, err
}

func (a *OwnerAdapter) ApplyCutoff(ctx context.Context, request *runtimev1.CognitionMemoryApplyCutoffRequest) (*runtimev1.CognitionMemoryApplyCutoffResponse, error) {
	response := &runtimev1.CognitionMemoryApplyCutoffResponse{}
	if err := validateOwnerContractVersion(request.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	binding, err := a.ownerBinding(ctx, request.GetBankBinding().GetValue(), request.GetBank().GetValue())
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	result, err := a.core.ApplyCutoff(ctx, memoryv1.CutoffRequest{
		ContractVersion: request.GetContractVersion(), BindingRef: binding.BindingRef, BankRef: binding.BankRef,
		OperationID: request.GetOperation().GetValue(), CurrentLifecycleRef: binding.LifecycleRef,
		NewLifecycleRef: request.GetCutoff().GetValue(), ReplacementBindingRef: request.GetReplacementBankBinding().GetValue(), DeleteAll: request.GetDeleteAll(),
	})
	response.Outcome = ownerProtoOutcome(result.Outcome)
	if result.LifecycleRef != "" {
		response.Cutoff = &runtimev1.CognitionMemoryLifecycleCutoffRef{Value: result.LifecycleRef}
	}
	if result.ReplacementBindingRef != "" {
		response.ReplacementBankBinding = &runtimev1.CognitionMemoryBankBindingRef{Value: result.ReplacementBindingRef}
	}
	return response, err
}

func (a *OwnerAdapter) DeleteBank(ctx context.Context, request *runtimev1.CognitionMemoryDeleteBankRequest) (*runtimev1.CognitionMemoryDeleteBankResponse, error) {
	response := &runtimev1.CognitionMemoryDeleteBankResponse{}
	if err := validateOwnerContractVersion(request.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	if a == nil || a.core == nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnavailable)
		return response, ownerContractError(memoryv1.OutcomeUnavailable, "owner_unavailable")
	}
	result, err := a.core.DeleteBank(ctx, memoryv1.DeleteBankRequest{
		OperationID: request.GetOperation().GetValue(), BindingRef: request.GetBankBinding().GetValue(), BankRef: request.GetBank().GetValue(),
		LifecycleRef: request.GetCutoff().GetValue(), Reason: ownerDeleteReason(request.GetReason()),
	})
	response.Outcome = ownerProtoOutcome(result.Outcome)
	return response, err
}

func (a *OwnerAdapter) InspectStatus(ctx context.Context, request *runtimev1.CognitionMemoryInspectStatusRequest) (*runtimev1.CognitionMemoryInspectStatusResponse, error) {
	response := &runtimev1.CognitionMemoryInspectStatusResponse{}
	if err := validateOwnerContractVersion(request.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	if !validRef(request.GetOperation().GetValue()) {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeInvalid)
		return response, ownerContractError(memoryv1.OutcomeInvalid, "operation_id")
	}
	binding, err := a.ownerBinding(ctx, request.GetBankBinding().GetValue(), request.GetBank().GetValue())
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	status, err := a.core.InspectStatus(ctx, binding.BindingRef, binding.BankRef)
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	response.Outcome = ownerProtoOutcome(memoryv1.OutcomeReady)
	response.Frontiers = &runtimev1.CognitionMemoryFrontiers{DeliveryFrontier: binding.DeliveryFrontier, ReceivedFrontier: status.Frontiers.Received, ReadyFrontier: status.Frontiers.Ready}
	for _, event := range status.Events {
		response.Events = append(response.Events, &runtimev1.CognitionMemoryEventStatus{
			Event: &runtimev1.CognitionMemoryEventRef{Value: event.EventRef}, Operation: &runtimev1.CognitionMemoryOperationRef{Value: event.OperationID},
			DeliverySequence: event.DeliverySequence, Outcome: ownerProtoOutcome(event.Outcome),
		})
	}
	response.CurrentCount = uint64(status.Current)
	response.SupersededCount = uint64(status.Superseded)
	response.ForgottenCount = uint64(status.Forgotten)
	return response, nil
}

func (a *OwnerAdapter) Inspect(ctx context.Context, request *runtimev1.CognitionMemoryInspectRequest) (*runtimev1.CognitionMemoryInspectResponse, error) {
	response := &runtimev1.CognitionMemoryInspectResponse{}
	if err := validateOwnerContractVersion(request.GetContractVersion()); err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeUnsupported)
		return response, err
	}
	if !validRef(request.GetOperation().GetValue()) {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeInvalid)
		return response, ownerContractError(memoryv1.OutcomeInvalid, "operation_id")
	}
	binding, err := a.ownerBinding(ctx, request.GetBankBinding().GetValue(), request.GetBank().GetValue())
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	limit := int(request.GetLimit())
	if limit == 0 {
		limit = 100
	}
	if limit < 1 || limit > 100 {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeInvalid)
		return response, ownerContractError(memoryv1.OutcomeInvalid, "inspect_limit")
	}
	cursor, err := decodeOwnerInspectCursor(request.GetPageToken())
	if err != nil {
		response.Outcome = ownerProtoOutcome(memoryv1.OutcomeInvalid)
		return response, err
	}
	pageRequest := memoryv1.MemoryPageRequest{BankRef: binding.BankRef, Limit: limit}
	if cursor != nil {
		pageRequest.AfterUpdatedAt = cursor.UpdatedAt
		pageRequest.AfterMemoryRef = cursor.MemoryRef
	}
	page, err := a.core.ListMemoriesPage(ctx, pageRequest)
	if err != nil {
		response.Outcome = ownerProtoOutcome(errorOutcome(err))
		return response, err
	}
	for _, item := range page.Items {
		response.Memories = append(response.Memories, ownerProtoMemory(item))
	}
	if page.HasMore && len(page.Items) > 0 {
		response.NextPageToken, err = encodeOwnerInspectCursor(page.Items[len(page.Items)-1])
		if err != nil {
			response.Outcome = ownerProtoOutcome(memoryv1.OutcomeFailed)
			return response, err
		}
	}
	response.Outcome = ownerProtoOutcome(memoryv1.OutcomeReady)
	return response, nil
}

func (a *OwnerAdapter) ExecuteRemember(ctx context.Context, operationID string) (memoryv1.DecisionResult, error) {
	if a == nil || a.core == nil {
		return memoryv1.DecisionResult{Outcome: memoryv1.OutcomeUnavailable}, ownerContractError(memoryv1.OutcomeUnavailable, "owner_unavailable")
	}
	return a.core.ExecuteRemember(ctx, operationID)
}

func (a *OwnerAdapter) RebuildEmbedding(ctx context.Context, operationID, bankRef string, snapshot memoryv1.CapabilitySnapshot, port memoryv1.EmbeddingPort) (memoryv1.Outcome, error) {
	if a == nil || a.core == nil {
		return memoryv1.OutcomeUnavailable, ownerContractError(memoryv1.OutcomeUnavailable, "owner_unavailable")
	}
	return a.core.RebuildEmbedding(ctx, operationID, bankRef, snapshot, port)
}

func (a *OwnerAdapter) NeedsEmbeddingRebuild(ctx context.Context, bankRef string, snapshot memoryv1.CapabilitySnapshot) (bool, error) {
	if a == nil || a.core == nil {
		return false, ownerContractError(memoryv1.OutcomeUnavailable, "owner_unavailable")
	}
	return a.core.NeedsEmbeddingRebuild(ctx, bankRef, snapshot)
}

func (a *OwnerAdapter) ownerBinding(ctx context.Context, bindingRef, bankRef string) (Binding, error) {
	if a == nil || a.core == nil || a.resolveBinding == nil || !validRef(bindingRef) || !validRef(bankRef) {
		return Binding{}, ownerContractError(memoryv1.OutcomeInvalid, "bank_identity")
	}
	binding, err := a.resolveBinding(ctx, bindingRef)
	if err != nil {
		return Binding{}, fmt.Errorf("resolve owner binding: %w", err)
	}
	if binding.BindingRef != bindingRef || binding.BankRef != bankRef || !validRef(binding.LifecycleRef) {
		return Binding{}, ownerContractError(memoryv1.OutcomeConflict, "bank_binding")
	}
	return binding, nil
}

func (a *OwnerAdapter) ownerCapabilitySnapshot(ctx context.Context, binding Binding, input *runtimev1.CognitionMemoryCapabilitySnapshot) (memoryv1.CapabilitySnapshot, error) {
	snapshot := memoryv1.CapabilitySnapshot{ConfigRevision: input.GetConfigRevision()}
	for _, capability := range input.GetAvailable() {
		mapped, ok := ownerCapability(capability)
		if !ok {
			return memoryv1.CapabilitySnapshot{}, ownerContractError(memoryv1.OutcomeInvalid, "capability")
		}
		snapshot.Available = append(snapshot.Available, mapped)
	}
	if ownerHasEmbeddingCapability(snapshot.Available) {
		if a.resolveCapabilities == nil {
			return memoryv1.CapabilitySnapshot{}, ownerContractError(memoryv1.OutcomeUnavailable, "embedding_identity")
		}
		resolved, err := a.resolveCapabilities(ctx, binding)
		if err != nil {
			return memoryv1.CapabilitySnapshot{}, fmt.Errorf("resolve owner capability identity: %w", err)
		}
		if resolved.ConfigRevision != snapshot.ConfigRevision || !validRef(resolved.EmbeddingSpaceRef) || !ownerCapabilitiesCover(resolved.Available, snapshot.Available) {
			return memoryv1.CapabilitySnapshot{}, ownerContractError(memoryv1.OutcomeConflict, "embedding_identity")
		}
		snapshot.EmbeddingSpaceRef = resolved.EmbeddingSpaceRef
	}
	return snapshot, nil
}

func ownerRecallSubject(scope []*runtimev1.CognitionMemorySubjectRef, binding Binding) (memoryv1.TypedRef, error) {
	if len(scope) != 1 || scope[0] == nil || scope[0].GetKind() != "account_subject" || !validRef(scope[0].GetValue()) {
		return memoryv1.TypedRef{}, ownerContractError(memoryv1.OutcomeInvalid, "subject_scope")
	}
	if !validRef(binding.AccountSubjectRef) || scope[0].GetValue() != binding.AccountSubjectRef {
		return memoryv1.TypedRef{}, ownerContractError(memoryv1.OutcomeConflict, "subject_scope")
	}
	return memoryv1.TypedRef{Kind: scope[0].GetKind(), Value: scope[0].GetValue()}, nil
}

func validateOwnerContractVersion(version uint32) error {
	if version != memoryv1.ContractVersion {
		return ownerContractError(memoryv1.OutcomeUnsupported, "contract_version")
	}
	return nil
}

func ownerContractError(outcome memoryv1.Outcome, code string) error {
	return &memoryv1.ContractError{Outcome: outcome, Code: code}
}

func ownerProtoOutcome(outcome memoryv1.Outcome) runtimev1.CognitionMemoryOutcome {
	switch outcome {
	case memoryv1.OutcomeUnsupported:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNSUPPORTED
	case memoryv1.OutcomeInvalid:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_INVALID
	case memoryv1.OutcomeUnconfigured:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNCONFIGURED
	case memoryv1.OutcomePending:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_PENDING
	case memoryv1.OutcomeBuilding:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_BUILDING
	case memoryv1.OutcomeReceived:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_RECEIVED
	case memoryv1.OutcomeProcessing:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_PROCESSING
	case memoryv1.OutcomeReady:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_READY
	case memoryv1.OutcomeNoHits:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_NO_HITS
	case memoryv1.OutcomeUnavailable:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNAVAILABLE
	case memoryv1.OutcomeFailed:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_FAILED
	case memoryv1.OutcomeNoEffect:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_NO_EFFECT
	case memoryv1.OutcomeRejected:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_REJECTED
	case memoryv1.OutcomeAdmitted:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_ADMITTED
	case memoryv1.OutcomeForgotten:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_FORGOTTEN
	case memoryv1.OutcomeDeleted:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_DELETED
	case memoryv1.OutcomeAlreadyAbsent:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_ALREADY_ABSENT
	case memoryv1.OutcomeCommitted:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_COMMITTED
	case memoryv1.OutcomeConflict:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_CONFLICT
	case memoryv1.OutcomeDuplicate:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_DUPLICATE
	default:
		return runtimev1.CognitionMemoryOutcome_COGNITION_MEMORY_OUTCOME_UNSPECIFIED
	}
}

func ownerMemoryOutcome(outcome runtimev1.CognitionMemoryOutcome) memoryv1.Outcome {
	for candidate, projected := range map[memoryv1.Outcome]runtimev1.CognitionMemoryOutcome{
		memoryv1.OutcomeUnsupported: ownerProtoOutcome(memoryv1.OutcomeUnsupported), memoryv1.OutcomeInvalid: ownerProtoOutcome(memoryv1.OutcomeInvalid),
		memoryv1.OutcomeUnconfigured: ownerProtoOutcome(memoryv1.OutcomeUnconfigured), memoryv1.OutcomePending: ownerProtoOutcome(memoryv1.OutcomePending),
		memoryv1.OutcomeBuilding: ownerProtoOutcome(memoryv1.OutcomeBuilding), memoryv1.OutcomeReceived: ownerProtoOutcome(memoryv1.OutcomeReceived),
		memoryv1.OutcomeProcessing: ownerProtoOutcome(memoryv1.OutcomeProcessing), memoryv1.OutcomeReady: ownerProtoOutcome(memoryv1.OutcomeReady),
		memoryv1.OutcomeNoHits: ownerProtoOutcome(memoryv1.OutcomeNoHits), memoryv1.OutcomeUnavailable: ownerProtoOutcome(memoryv1.OutcomeUnavailable),
		memoryv1.OutcomeFailed: ownerProtoOutcome(memoryv1.OutcomeFailed), memoryv1.OutcomeNoEffect: ownerProtoOutcome(memoryv1.OutcomeNoEffect),
		memoryv1.OutcomeRejected: ownerProtoOutcome(memoryv1.OutcomeRejected), memoryv1.OutcomeAdmitted: ownerProtoOutcome(memoryv1.OutcomeAdmitted),
		memoryv1.OutcomeForgotten: ownerProtoOutcome(memoryv1.OutcomeForgotten), memoryv1.OutcomeDeleted: ownerProtoOutcome(memoryv1.OutcomeDeleted),
		memoryv1.OutcomeAlreadyAbsent: ownerProtoOutcome(memoryv1.OutcomeAlreadyAbsent), memoryv1.OutcomeCommitted: ownerProtoOutcome(memoryv1.OutcomeCommitted),
		memoryv1.OutcomeConflict: ownerProtoOutcome(memoryv1.OutcomeConflict), memoryv1.OutcomeDuplicate: ownerProtoOutcome(memoryv1.OutcomeDuplicate),
	} {
		if projected == outcome {
			return candidate
		}
	}
	return memoryv1.OutcomeFailed
}

func ownerCommitRequest(envelope *runtimev1.CognitionMemoryCommittedEventEnvelope) (memoryv1.CommitRequest, error) {
	if envelope == nil || envelope.GetCommittedAt() == nil || !envelope.GetCommittedAt().IsValid() {
		return memoryv1.CommitRequest{}, ownerContractError(memoryv1.OutcomeInvalid, "commit_envelope")
	}
	request := memoryv1.CommitRequest{
		ContractVersion: envelope.GetContractVersion(), BindingRef: envelope.GetBankBinding().GetValue(), BankRef: envelope.GetBank().GetValue(),
		EventRef: envelope.GetEvent().GetValue(), DeliverySequence: envelope.GetDeliverySequence(), OperationID: envelope.GetOperation().GetValue(),
		LifecycleRef: envelope.GetLifecycleCutoff().GetValue(), CommittedAt: envelope.GetCommittedAt().AsTime(),
	}
	for _, ref := range envelope.GetSubjects() {
		request.Subjects = append(request.Subjects, memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()})
	}
	for _, ref := range envelope.GetSources() {
		request.Sources = append(request.Sources, memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()})
	}
	switch {
	case envelope.GetMessageCommitted() != nil:
		message := envelope.GetMessageCommitted()
		fact := &memoryv1.MessageFact{Actor: ownerActor(message.GetActor()), Conversation: ownerTypedRef(message.GetConversation()), Message: ownerTypedRef(message.GetMessage())}
		for _, part := range message.GetParts() {
			mapped := memoryv1.MessagePart{PartRef: ownerTypedRef(part.GetPart())}
			switch {
			case part.GetText() != nil:
				mapped.Kind, mapped.Text = "text", part.GetText().GetText()
			case part.GetTranscription() != nil:
				mapped.Kind, mapped.Text, mapped.Transcription = "transcription", part.GetTranscription().GetText(), ownerTypedRef(part.GetTranscription().GetTranscription())
			case part.GetArtifact() != nil:
				mapped.Kind, mapped.ArtifactRef = "artifact", ownerTypedRef(part.GetArtifact().GetArtifact())
			default:
				return memoryv1.CommitRequest{}, ownerContractError(memoryv1.OutcomeUnsupported, "message_part")
			}
			fact.Parts = append(fact.Parts, mapped)
		}
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindMessage, Message: fact}
	case envelope.GetTurnTerminal() != nil:
		fact := envelope.GetTurnTerminal()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindTurnTerminal, Turn: &memoryv1.TurnTerminalFact{Conversation: ownerTypedRef(fact.GetConversation()), Turn: ownerTypedRef(fact.GetTurn()), State: ownerTerminalState(fact.GetState())}}
	case envelope.GetActivityTerminal() != nil:
		fact := envelope.GetActivityTerminal()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindActivity, Activity: &memoryv1.ActivityTerminalFact{Activity: ownerTypedRef(fact.GetActivity()), ActivityKind: fact.GetActivityKind(), State: ownerTerminalState(fact.GetState()), BoundedOutcome: fact.GetBoundedOutcome()}}
	case envelope.GetCorrectionCommitted() != nil:
		fact := envelope.GetCorrectionCommitted()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindCorrection, Correction: &memoryv1.CorrectionFact{TargetMemoryRef: fact.GetTargetMemory().GetValue(), CorrectedContent: fact.GetCorrectedContent()}}
	case envelope.GetRelationshipCommitted() != nil:
		fact := envelope.GetRelationshipCommitted()
		request.Fact = memoryv1.CommittedFact{Kind: memoryv1.EventKindRelationship, Relationship: &memoryv1.RelationshipFact{RelationshipKind: fact.GetRelationshipKind(), BoundedFact: fact.GetBoundedFact()}}
	default:
		return memoryv1.CommitRequest{}, ownerContractError(memoryv1.OutcomeUnsupported, "event_fact")
	}
	return request, nil
}

func ownerProtoMemory(item memoryv1.Memory) *runtimev1.CognitionMemoryHit {
	hit := &runtimev1.CognitionMemoryHit{
		Bank: &runtimev1.CognitionMemoryBankRef{Value: item.BankRef}, Memory: &runtimev1.CognitionMemoryRef{Value: item.MemoryRef}, Content: item.Content,
		EpistemicStatus: ownerProtoEpistemic(item.EpistemicStatus), Lifecycle: ownerProtoLifecycle(item.Lifecycle),
		OccurredAt: timestamppb.New(item.OccurredAt), UpdatedAt: timestamppb.New(item.UpdatedAt), SourceExplanation: item.SourceExplanation,
	}
	for _, ref := range item.Subjects {
		hit.Subjects = append(hit.Subjects, &runtimev1.CognitionMemorySubjectRef{Kind: ref.Kind, Value: ref.Value})
	}
	for _, ref := range item.Sources {
		hit.Sources = append(hit.Sources, &runtimev1.CognitionMemorySourceRef{Kind: ref.Kind, Value: ref.Value})
	}
	if item.EventRef != "" {
		hit.Sources = append(hit.Sources, &runtimev1.CognitionMemorySourceRef{Kind: "committed_event", Value: item.EventRef})
	}
	return hit
}

func ownerMemoryFromProto(hit *runtimev1.CognitionMemoryHit) (memoryv1.Memory, error) {
	if hit == nil || hit.GetOccurredAt() == nil || hit.GetUpdatedAt() == nil || !hit.GetOccurredAt().IsValid() || !hit.GetUpdatedAt().IsValid() {
		return memoryv1.Memory{}, ownerContractError(memoryv1.OutcomeFailed, "memory_hit")
	}
	item := memoryv1.Memory{
		MemoryRef: hit.GetMemory().GetValue(), BankRef: hit.GetBank().GetValue(), Content: hit.GetContent(),
		EpistemicStatus: ownerEpistemic(hit.GetEpistemicStatus()), Lifecycle: ownerLifecycle(hit.GetLifecycle()),
		OccurredAt: hit.GetOccurredAt().AsTime(), UpdatedAt: hit.GetUpdatedAt().AsTime(), SourceExplanation: hit.GetSourceExplanation(),
	}
	for _, ref := range hit.GetSubjects() {
		item.Subjects = append(item.Subjects, memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()})
	}
	for _, ref := range hit.GetSources() {
		if ref.GetKind() == "committed_event" && item.EventRef == "" {
			item.EventRef = ref.GetValue()
			continue
		}
		item.Sources = append(item.Sources, memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()})
	}
	if !validRef(item.MemoryRef) || !validRef(item.BankRef) || !validRef(item.EventRef) || item.EpistemicStatus == "" || item.Lifecycle == "" {
		return memoryv1.Memory{}, ownerContractError(memoryv1.OutcomeFailed, "memory_hit_identity")
	}
	return item, nil
}

type ownerInspectCursor struct {
	UpdatedAt string `json:"updated_at"`
	MemoryRef string `json:"memory_ref"`
}

func encodeOwnerInspectCursor(item memoryv1.Memory) (string, error) {
	raw, err := json.Marshal(ownerInspectCursor{UpdatedAt: item.UpdatedAt.UTC().Format(time.RFC3339Nano), MemoryRef: item.MemoryRef})
	if err != nil {
		return "", fmt.Errorf("encode owner inspect cursor: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func decodeOwnerInspectCursor(token string) (*ownerInspectCursor, error) {
	if token == "" {
		return nil, nil
	}
	if len(token) > 2048 {
		return nil, ownerContractError(memoryv1.OutcomeInvalid, "page_token")
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, ownerContractError(memoryv1.OutcomeInvalid, "page_token")
	}
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	var cursor ownerInspectCursor
	if err := decoder.Decode(&cursor); err != nil || !validRef(cursor.MemoryRef) {
		return nil, ownerContractError(memoryv1.OutcomeInvalid, "page_token")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return nil, ownerContractError(memoryv1.OutcomeInvalid, "page_token")
	}
	if _, err := time.Parse(time.RFC3339Nano, cursor.UpdatedAt); err != nil {
		return nil, ownerContractError(memoryv1.OutcomeInvalid, "page_token")
	}
	return &cursor, nil
}

func ownerCapability(value runtimev1.CognitionMemoryCapability) (memoryv1.Capability, bool) {
	switch value {
	case runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_FTS_INDEX:
		return memoryv1.CapabilityFTSIndex, true
	case runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_TEXT_EMBED:
		return memoryv1.CapabilityTextEmbed, true
	case runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_VECTOR_INDEX:
		return memoryv1.CapabilityVectorIndex, true
	default:
		return "", false
	}
}

func ownerProtoCapabilitySnapshot(snapshot memoryv1.CapabilitySnapshot) *runtimev1.CognitionMemoryCapabilitySnapshot {
	result := &runtimev1.CognitionMemoryCapabilitySnapshot{ConfigRevision: snapshot.ConfigRevision}
	for _, capability := range snapshot.Available {
		switch capability {
		case memoryv1.CapabilityFTSIndex:
			result.Available = append(result.Available, runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_FTS_INDEX)
		case memoryv1.CapabilityTextEmbed:
			result.Available = append(result.Available, runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_TEXT_EMBED)
		case memoryv1.CapabilityVectorIndex:
			result.Available = append(result.Available, runtimev1.CognitionMemoryCapability_COGNITION_MEMORY_CAPABILITY_VECTOR_INDEX)
		}
	}
	return result
}

func ownerCapabilitiesCover(available, requested []memoryv1.Capability) bool {
	set := make(map[memoryv1.Capability]struct{}, len(available))
	for _, capability := range available {
		set[capability] = struct{}{}
	}
	for _, capability := range requested {
		if _, ok := set[capability]; !ok {
			return false
		}
	}
	return true
}

func ownerHasEmbeddingCapability(capabilities []memoryv1.Capability) bool {
	for _, capability := range capabilities {
		if capability == memoryv1.CapabilityTextEmbed || capability == memoryv1.CapabilityVectorIndex {
			return true
		}
	}
	return false
}

func ownerDeleteReason(reason runtimev1.CognitionMemoryDeleteReason) memoryv1.DeleteReason {
	switch reason {
	case runtimev1.CognitionMemoryDeleteReason_COGNITION_MEMORY_DELETE_REASON_AGENT_TERMINATION:
		return memoryv1.DeleteReasonAgentTermination
	case runtimev1.CognitionMemoryDeleteReason_COGNITION_MEMORY_DELETE_REASON_ACCOUNT_TERMINATION:
		return memoryv1.DeleteReasonAccountTermination
	default:
		return ""
	}
}

func ownerProtoDeleteReason(reason memoryv1.DeleteReason) runtimev1.CognitionMemoryDeleteReason {
	switch reason {
	case memoryv1.DeleteReasonAgentTermination:
		return runtimev1.CognitionMemoryDeleteReason_COGNITION_MEMORY_DELETE_REASON_AGENT_TERMINATION
	case memoryv1.DeleteReasonAccountTermination:
		return runtimev1.CognitionMemoryDeleteReason_COGNITION_MEMORY_DELETE_REASON_ACCOUNT_TERMINATION
	default:
		return runtimev1.CognitionMemoryDeleteReason_COGNITION_MEMORY_DELETE_REASON_UNSPECIFIED
	}
}

func ownerActor(role runtimev1.CognitionMemoryActorRole) memoryv1.ActorRole {
	switch role {
	case runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_USER:
		return memoryv1.ActorUser
	case runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_ASSISTANT:
		return memoryv1.ActorAssistant
	case runtimev1.CognitionMemoryActorRole_COGNITION_MEMORY_ACTOR_ROLE_TOOL:
		return memoryv1.ActorTool
	default:
		return ""
	}
}

func ownerTerminalState(state runtimev1.CognitionMemoryTerminalState) memoryv1.TerminalState {
	switch state {
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_COMPLETED:
		return memoryv1.TerminalCompleted
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_FAILED:
		return memoryv1.TerminalFailed
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_INTERRUPTED:
		return memoryv1.TerminalInterrupted
	case runtimev1.CognitionMemoryTerminalState_COGNITION_MEMORY_TERMINAL_STATE_CANCELED:
		return memoryv1.TerminalCanceled
	default:
		return ""
	}
}

func ownerTypedRef(ref *runtimev1.CognitionMemorySourceRef) memoryv1.TypedRef {
	if ref == nil {
		return memoryv1.TypedRef{}
	}
	return memoryv1.TypedRef{Kind: ref.GetKind(), Value: ref.GetValue()}
}

func ownerProtoEpistemic(value memoryv1.EpistemicStatus) runtimev1.CognitionMemoryEpistemicStatus {
	switch value {
	case memoryv1.EpistemicExplicit:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_EXPLICIT
	case memoryv1.EpistemicInferred:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_INFERRED
	case memoryv1.EpistemicConsolidated:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_CONSOLIDATED
	default:
		return runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_UNSPECIFIED
	}
}

func ownerEpistemic(value runtimev1.CognitionMemoryEpistemicStatus) memoryv1.EpistemicStatus {
	switch value {
	case runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_EXPLICIT:
		return memoryv1.EpistemicExplicit
	case runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_INFERRED:
		return memoryv1.EpistemicInferred
	case runtimev1.CognitionMemoryEpistemicStatus_COGNITION_MEMORY_EPISTEMIC_STATUS_CONSOLIDATED:
		return memoryv1.EpistemicConsolidated
	default:
		return ""
	}
}

func ownerProtoLifecycle(value memoryv1.Lifecycle) runtimev1.CognitionMemoryLifecycle {
	switch value {
	case memoryv1.LifecycleCurrent:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_CURRENT
	case memoryv1.LifecycleSuperseded:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_SUPERSEDED
	case memoryv1.LifecycleConflicted:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_CONFLICTED
	case memoryv1.LifecycleForgotten:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_FORGOTTEN
	default:
		return runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_UNSPECIFIED
	}
}

func ownerLifecycle(value runtimev1.CognitionMemoryLifecycle) memoryv1.Lifecycle {
	switch value {
	case runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_CURRENT:
		return memoryv1.LifecycleCurrent
	case runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_SUPERSEDED:
		return memoryv1.LifecycleSuperseded
	case runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_CONFLICTED:
		return memoryv1.LifecycleConflicted
	case runtimev1.CognitionMemoryLifecycle_COGNITION_MEMORY_LIFECYCLE_FORGOTTEN:
		return memoryv1.LifecycleForgotten
	default:
		return ""
	}
}

var _ OwnerPort = (*OwnerAdapter)(nil)
