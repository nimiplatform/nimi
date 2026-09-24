package ai

import (
	"context"
	"fmt"
	"slices"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

// EmbeddingOwner is Runtime-private custody provenance. Callers get neither an
// App operation nor permission to supply these identifiers over the wire.
type EmbeddingOwner struct {
	Kind         string   `json:"kind"`
	AgentRef     string   `json:"agent_ref"`
	OperationID  string   `json:"operation_id"`
	BankRef      string   `json:"bank_ref,omitempty"`
	LifecycleRef string   `json:"lifecycle_ref,omitempty"`
	MemoryRefs   []string `json:"memory_refs,omitempty"`
}

type embeddingPayload struct {
	Owner EmbeddingOwner `json:"owner"`
	State string         `json:"state"`
}

func (owner EmbeddingOwner) valid() bool {
	if strings.TrimSpace(owner.AgentRef) == "" || strings.TrimSpace(owner.OperationID) == "" {
		return false
	}
	if owner.Kind == "source" {
		return owner.BankRef == "" && owner.LifecycleRef == "" && len(owner.MemoryRefs) == 0
	}
	return owner.Kind == "memory" && strings.TrimSpace(owner.BankRef) != "" && strings.TrimSpace(owner.LifecycleRef) != ""
}

func cloneEmbeddingPayload(input *embeddingPayload) *embeddingPayload {
	if input == nil {
		return nil
	}
	out := *input
	out.Owner.MemoryRefs = append([]string(nil), input.Owner.MemoryRefs...)
	return &out
}

func validateScenarioJobPayload(job *runtimev1.ScenarioJob, local *localResolvedAssembly, cloud *cloudResolvedAssembly, payload *embeddingPayload) error {
	if payload == nil {
		return validateScenarioJobCapturedInputsPair(job, local, cloud)
	}
	if !payload.Owner.valid() || job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED || job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_SYNC || job.GetHead().GetSubjectUserId() == "" {
		return fmt.Errorf("embedding payload owner is invalid")
	}
	switch payload.State {
	case "retained", "pending":
		return validateScenarioJobCapturedInputsPair(job, local, cloud)
	case "disposed":
		if !isTerminalScenarioJobStatus(job.GetStatus()) || local != nil || cloud != nil || len(job.GetArtifacts()) != 0 {
			return fmt.Errorf("disposed embedding payload is not metadata-only")
		}
		clean := cloneScenarioJob(job)
		stripEmbeddingFailureContent(clean)
		if job.GetReasonDetail() != clean.GetReasonDetail() || !proto.Equal(job.GetReasonMetadata(), clean.GetReasonMetadata()) {
			return fmt.Errorf("disposed embedding Job retains noncanonical failure content")
		}
		return nil
	default:
		return fmt.Errorf("embedding payload disposition is invalid")
	}
}

// A scope is either an exact captured operation, one Agent's Memory copies,
// or startup's abandoned executions. It is never supplied by an App request.
type embeddingDisposalScope struct {
	account   string
	owner     *EmbeddingOwner
	jobs      map[string]bool
	agent     string
	abandoned bool
}

func (scope embeddingDisposalScope) matches(id, account string, payload *embeddingPayload) (bool, error) {
	if scope.jobs != nil {
		if !scope.jobs[id] {
			return false, nil
		}
		if payload == nil || account != scope.account || !sameEmbeddingOwner(payload.Owner, *scope.owner) {
			return false, fmt.Errorf("embedding payload ownership mismatch")
		}
	} else {
		if payload == nil {
			return false, nil
		}
		if scope.agent != "" && payload.Owner.Kind == "memory" && payload.Owner.AgentRef == "" {
			return false, fmt.Errorf("embedding recovery Agent attribution is unavailable")
		}
		if scope.agent != "" && (payload.Owner.Kind != "memory" || payload.Owner.AgentRef != scope.agent) {
			return false, nil
		}
	}
	if payload == nil || !payload.Owner.valid() || strings.TrimSpace(account) == "" {
		return false, fmt.Errorf("embedding payload owner is incomplete")
	}
	return true, nil
}

func sameEmbeddingOwner(a, b EmbeddingOwner) bool {
	return a.Kind == b.Kind && a.AgentRef == b.AgentRef && a.OperationID == b.OperationID && a.BankRef == b.BankRef && a.LifecycleRef == b.LifecycleRef && slices.Equal(a.MemoryRefs, b.MemoryRefs)
}

// @nimi-authority: rule.nimi.runtime.service-operations.memory-derived-payload-lifecycle
// One owner transition per batch; absence is confirmed against both the live
// store and its recovery copies. Disposed metadata can therefore expire normally.
func (s *Service) disposeEmbeddingPayloads(ctx context.Context, scope embeddingDisposalScope) error {
	store := s.scenarioJobs
	type target struct {
		id      string
		running bool
		done    <-chan struct{}
	}
	var targets []target
	store.mu.Lock()
	for id, record := range store.jobs {
		if scope.abandoned && !isTerminalScenarioJobStatus(record.job.GetStatus()) {
			continue
		}
		matched, err := scope.matches(id, record.job.GetHead().GetSubjectUserId(), record.payload)
		if err != nil {
			store.mu.Unlock()
			return err
		}
		if !matched || record.payload.State == "disposed" {
			continue
		}
		targets = append(targets, target{id, record.executionStarted, record.executionDone})
	}
	if len(targets) > 0 {
		for _, target := range targets {
			store.jobs[target.id].payload.State = "pending"
			store.markDurableJobChangedLocked(target.id)
		}
		if err := store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistPayloadFence}); err != nil {
			store.mu.Unlock()
			return err
		}
	}
	store.mu.Unlock()
	for _, target := range targets {
		if _, _, err := store.requestCancel(target.id, "embedding payload disposition"); err != nil {
			return err
		}
	}
	for _, target := range targets {
		if target.running {
			select {
			case <-target.done:
			case <-ctx.Done():
				return ctx.Err()
			}
		}
		if err := s.releaseCloudCredentialCustodyForJobDurably(target.id); err != nil {
			return err
		}
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if err := s.scrubEmbeddingRecoveryCopiesLocked(scope); err != nil {
		return err
	}
	type previous struct {
		record *scenarioJobRecord
		local  *localResolvedAssembly
		cloud  *cloudResolvedAssembly
		job    *runtimev1.ScenarioJob
	}
	var previousRecords []previous
	for _, target := range targets {
		record := store.jobs[target.id]
		if record == nil || record.payload.State == "disposed" {
			continue
		}
		if record.executionStarted || !isTerminalScenarioJobStatus(record.job.GetStatus()) {
			return fmt.Errorf("embedding payload execution has not stopped")
		}
		previousRecords = append(previousRecords, previous{record, record.resolvedAssembly, record.cloudAssembly, record.job})
	}
	for _, old := range previousRecords {
		record := old.record
		record.resolvedAssembly, record.cloudAssembly = nil, nil
		record.job = cloneScenarioJob(record.job)
		stripEmbeddingFailureContent(record.job)
		record.payload.State = "disposed"
		store.markDurableJobChangedLocked(record.job.GetJobId())
	}
	if len(previousRecords) == 0 {
		return nil
	}
	// The dispose write rewrites the store, so no superseded row keeps the
	// disposed content on disk.
	if err := store.persistDurableJobsLocked(scenarioJobPersistenceAttempt{Operation: scenarioJobPersistPayloadDispose}); err != nil {
		for _, old := range previousRecords {
			old.record.resolvedAssembly, old.record.cloudAssembly, old.record.job = old.local, old.cloud, old.job
			old.record.payload.State = "pending"
		}
		return err
	}
	for _, old := range previousRecords {
		for _, event := range old.record.events {
			stripEmbeddingFailureContent(event.GetJob())
		}
	}
	return nil
}

func (s *Service) disposeEmbeddingJob(ctx context.Context, id, accountID string, owner EmbeddingOwner) error {
	return s.disposeEmbeddingPayloads(ctx, embeddingDisposalScope{account: accountID, owner: &owner, jobs: map[string]bool{id: true}})
}

func (s *Service) resumeEmbeddingPayloadDisposals(ctx context.Context) error {
	return s.disposeEmbeddingPayloads(ctx, embeddingDisposalScope{abandoned: true})
}

func (s *Service) DisposeMemoryEmbeddingForOwner(ctx context.Context, agent string, raw []byte) error {
	var execution memoryEmbeddingExecution
	if err := decodeScenarioJobStrictJSON(raw, &execution); err != nil || execution.Owner.Kind != "memory" || execution.Owner.AgentRef != agent {
		return fmt.Errorf("Memory payload owner mismatch")
	}
	return s.DiscardMemoryEmbedding(ctx, raw)
}

// Runtime lifecycle calls this only after its durable exact-Agent fence. The
// scope includes unpublished captures in quarantine, without a second ledger.
func (s *Service) DisposeAgentMemoryEmbeddingPayloads(ctx context.Context, agent string) error {
	if strings.TrimSpace(agent) == "" {
		return fmt.Errorf("Memory Agent custody is missing")
	}
	return s.disposeEmbeddingPayloads(ctx, embeddingDisposalScope{agent: agent})
}

func stripEmbeddingFailureContent(job *runtimev1.ScenarioJob) {
	job.ReasonDetail, job.ReasonMetadata = "", nil
	if job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_FAILED {
		job.ReasonDetail = "embedding execution failed"
		job.ReasonMetadata = defaultScenarioJobFailureMetadata(job.GetReasonCode())
	}
}
