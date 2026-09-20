package ai

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

const memoryEmbeddingBatchSize = 10

// MemoryEmbeddingDescription is compatibility metadata, never a Job or route selector.
// The predicted identity must still agree with each actual execution result.
type MemoryEmbeddingDescription struct {
	ConfigRevision uint64
	SpaceID        string
	Dimension      int
}

type MemoryEmbeddingResult struct {
	Vectors   [][]float64
	Dimension int
	SpaceID   string
}

type memoryEmbeddingSelection struct {
	MemoryEmbeddingDescription
	ctx    context.Context
	head   *runtimev1.ScenarioRequestHead
	intent executionintent.Intent
	local  *localexecution.SelectedLocalExecution
	cloud  *cloudEmbedEffectiveInputs
}

type memoryEmbeddingExecution struct {
	Owner          EmbeddingOwner `json:"owner"`
	ConfigRevision uint64         `json:"config_revision"`
	Version        int            `json:"version"`
	SpaceID        string         `json:"space_id"`
	Dimension      int            `json:"dimension"`
	Jobs           []string       `json:"jobs"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.embedding-space-identity
func (s *Service) DescribeMemoryEmbedding(ctx context.Context) (MemoryEmbeddingDescription, error) {
	ctx, releaseModelAssets := localexecution.WithModelAssetUseScope(ctx)
	defer releaseModelAssets()

	selected, err := s.resolveMemoryEmbeddingSelection(ctx)
	if err != nil {
		return MemoryEmbeddingDescription{}, err
	}
	return selected.MemoryEmbeddingDescription, nil
}

func (s *Service) resolveMemoryEmbeddingSelection(ctx context.Context) (*memoryEmbeddingSelection, error) {
	ctx, head, intent, revision, err := s.captureMemoryEmbeddingIntentAndRevision(ctx)
	if err != nil {
		return nil, err
	}
	selected := &memoryEmbeddingSelection{ctx: ctx, head: head, intent: intent}
	selected.ConfigRevision = revision
	if intent.IsLocal() {
		selected.local, err = s.resolveReferencedLocalExecution(ctx, intent)
		if err != nil {
			return nil, err
		}
		if !validSelectedEmbedExecution(selected.local) || len(selected.local.ExactBindings) != 1 {
			return nil, memoryEmbeddingUnavailable()
		}
		if err := requireSelectedFeatures(intent.RequiredFeatures, selected.local.ConfiguredFeatures); err != nil {
			return nil, err
		}
		dimension := selected.local.EmbeddingDimension
		if dimension <= 0 {
			return nil, memoryEmbeddingUnavailable()
		}
		selected.Dimension = int(dimension)
		identity := normalizedEmbeddingIdentity(projectLoadoutEffectiveInputIdentity(selected.local))
		selected.SpaceID, err = embeddingSpaceIDForDimensions("local", "", selected.Dimension, identity)
	} else if intent.IsCloud() {
		selected.cloud, err = s.captureCloudEmbedBinding(ctx, head)
		if err != nil {
			return nil, err
		}
		selected.Dimension = selected.cloud.dimension
		selected.SpaceID, err = embeddingSpaceIDForDimensions("cloud", selected.cloud.connector.ConnectorID, selected.Dimension, cloudEmbeddingSpaceParts(selected.cloud)...)
	} else {
		return nil, missingAIConfigRouteError()
	}
	if err != nil {
		return nil, err
	}
	return selected, nil
}

func memoryEmbeddingUnavailable() error {
	return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_CAPABILITY_CATALOG_MISMATCH)
}

// @nimi-authority: rule.nimi.runtime.security-core.r064
// Capture persists canonical ScenarioJobs and their complete assemblies before
// returning the private delivery references. No provider I/O occurs here.
func (s *Service) CaptureMemoryEmbedding(ctx context.Context, inputs []string, expectedSpaceID string, owner EmbeddingOwner) (_ MemoryEmbeddingDescription, _ []byte, resultErr error) {
	ctx, releaseModelAssets := localexecution.WithModelAssetUseScope(ctx)
	defer releaseModelAssets()

	if len(inputs) == 0 || strings.TrimSpace(expectedSpaceID) == "" || !owner.valid() {
		return MemoryEmbeddingDescription{}, nil, memoryEmbeddingUnavailable()
	}
	for _, input := range inputs {
		if strings.TrimSpace(input) == "" || len([]byte(input)) > 16*1024 {
			return MemoryEmbeddingDescription{}, nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
	}
	selected, err := s.resolveMemoryEmbeddingSelection(ctx)
	if err != nil {
		return MemoryEmbeddingDescription{}, nil, err
	}
	if selected.SpaceID != expectedSpaceID {
		return MemoryEmbeddingDescription{}, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	execution := memoryEmbeddingExecution{Owner: owner, Version: 2, ConfigRevision: selected.ConfigRevision, SpaceID: selected.SpaceID, Dimension: selected.Dimension}
	committed := false
	defer func() {
		if !committed && len(execution.Jobs) > 0 {
			if err := s.discardMemoryEmbeddingJobs(context.WithoutCancel(ctx), execution.Jobs, execution.Owner); err != nil {
				resultErr = errors.Join(resultErr, fmt.Errorf("discard incomplete embedding capture: %w", err))
			}
		}
	}()
	for offset := 0; offset < len(inputs); offset += memoryEmbeddingBatchSize {
		spec := &runtimev1.TextEmbedScenarioSpec{Inputs: append([]string(nil), inputs[offset:min(offset+memoryEmbeddingBatchSize, len(inputs))]...)}
		var job *runtimev1.ScenarioJob
		var preparedCtx context.Context
		if selected.local != nil {
			effective, captureErr := s.captureSelectedLocalEmbedEffectiveInputs(spec, selected.local, selected.intent.RequiredFeatures)
			if captureErr != nil {
				return MemoryEmbeddingDescription{}, nil, captureErr
			}
			effective.resolvedAssembly.AIConfigRevision = selected.ConfigRevision
			job, preparedCtx, err = s.prepareLocalScenarioJob(selected.ctx, selected.head, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
				runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.effectiveInputIdentity, effective.resolvedAssembly, &embeddingPayload{Owner: owner, State: "retained"})
		} else {
			effective, captureErr := s.bindCloudEmbedRequest(selected.ctx, selected.cloud, spec)
			if captureErr != nil {
				return MemoryEmbeddingDescription{}, nil, captureErr
			}
			effective.resolvedAssembly.AIConfigRevision = selected.ConfigRevision
			job, preparedCtx, err = s.prepareCloudScenarioJob(selected.ctx, selected.head, runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
				runtimev1.ExecutionMode_EXECUTION_MODE_SYNC, effective.modelResolved(), nil, effective.resolvedAssembly, &embeddingPayload{Owner: owner, State: "retained"})
			effective.release()
		}
		if err != nil {
			return MemoryEmbeddingDescription{}, nil, err
		}
		execution.Jobs = append(execution.Jobs, job.GetJobId())
		id := job.GetJobId()
		context.AfterFunc(preparedCtx, func() { s.cancelUnstartedMemoryEmbedding(id) })
	}
	raw, err := json.Marshal(execution)
	if err != nil {
		return MemoryEmbeddingDescription{}, nil, err
	}
	committed = true
	return selected.MemoryEmbeddingDescription, raw, nil
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r022
// A retry uses these exact jobs or fails; it never publishes replacement jobs.
// ScenarioJob restart policy already makes interrupted execution terminal.
func (s *Service) ExecuteMemoryEmbedding(ctx context.Context, raw []byte) (result MemoryEmbeddingResult, resultErr error) {
	ctx, releaseModelAssets := localexecution.WithModelAssetUseScope(ctx)
	defer releaseModelAssets()

	if s == nil || s.scenarioJobs == nil {
		return MemoryEmbeddingResult{}, memoryEmbeddingUnavailable()
	}
	var execution memoryEmbeddingExecution
	if err := decodeScenarioJobStrictJSON(raw, &execution); err != nil || execution.Version != 2 || execution.ConfigRevision == 0 || len(execution.Jobs) == 0 || execution.SpaceID == "" || execution.Dimension <= 0 {
		return MemoryEmbeddingResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	result = MemoryEmbeddingResult{Dimension: execution.Dimension, SpaceID: execution.SpaceID}
	ownsExecution := false
	defer func() {
		if ownsExecution {
			if err := s.discardMemoryEmbeddingJobs(context.WithoutCancel(ctx), execution.Jobs, execution.Owner); err != nil {
				result = MemoryEmbeddingResult{}
				resultErr = errors.Join(resultErr, fmt.Errorf("discard executed embedding payload: %w", err))
			}
		}
	}()
	for _, id := range execution.Jobs {
		s.scenarioJobs.mu.RLock()
		record := s.scenarioJobs.jobs[id]
		owned := record != nil && record.payload != nil && record.payload.State == "retained" && reflect.DeepEqual(record.payload.Owner, execution.Owner)
		s.scenarioJobs.mu.RUnlock()
		job, found := s.scenarioJobs.get(id)
		if !owned || !found || job.GetHead().GetSubjectUserId() != memoryEmbeddingAccountID(ctx) || job.GetScenarioType() != runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED || job.GetExecutionMode() != runtimev1.ExecutionMode_EXECUTION_MODE_SYNC || job.GetStatus() != runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED {
			return MemoryEmbeddingResult{}, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		jobCtx, cancel, claimErr := s.scenarioJobs.claimPreparedEmbedding(ctx, id)
		if claimErr != nil {
			return MemoryEmbeddingResult{}, claimErr
		}
		defer cancel()
		defer s.finishScenarioJobExecution(id)
		ownsExecution = true
		var vectors []*runtimev1.EmbeddingVector
		var spaceID string
		var err error
		if job.GetRouteDecision() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
			assembly, ok := s.scenarioJobs.resolvedAssembly(id)
			if !ok || assembly.AIConfigRevision != execution.ConfigRevision {
				return MemoryEmbeddingResult{}, memoryEmbeddingUnavailable()
			}
			effective, restoreErr := s.localEmbedEffectiveInputsFromResolvedAssembly(assembly)
			if restoreErr != nil {
				return MemoryEmbeddingResult{}, restoreErr
			}
			batch, _, _, runErr := s.runCapturedLocalEmbedJob(jobCtx, job, func(batch localexecution.EmbedResult) error {
				actual, err := localEmbeddingSpaceID(effective, batch.Vectors)
				return requireMemoryEmbeddingSpace(execution.SpaceID, actual, err)
			})
			if runErr != nil {
				return MemoryEmbeddingResult{}, runErr
			}
			vectors = batch.Vectors
			spaceID, err = localEmbeddingSpaceID(effective, vectors)
		} else if job.GetRouteDecision() == runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
			assembly, ok := s.scenarioJobs.cloudResolvedAssembly(id)
			if !ok || assembly.AIConfigRevision != execution.ConfigRevision {
				return MemoryEmbeddingResult{}, memoryEmbeddingUnavailable()
			}
			effective, restoreErr := s.cloudEmbedEffectiveInputsFromResolvedAssembly(assembly)
			if restoreErr != nil {
				return MemoryEmbeddingResult{}, restoreErr
			}
			batch, _, runErr := s.runCapturedCloudEmbedJob(jobCtx, job, func(batch capabilitydriver.CloudEmbedResult) error {
				actual, err := cloudEmbeddingSpaceID(effective, batch.Vectors)
				return requireMemoryEmbeddingSpace(execution.SpaceID, actual, err)
			})
			if runErr != nil {
				effective.release()
				return MemoryEmbeddingResult{}, runErr
			}
			vectors = batch.Vectors
			spaceID, err = cloudEmbeddingSpaceID(effective, vectors)
			effective.release()
		} else {
			return MemoryEmbeddingResult{}, memoryEmbeddingUnavailable()
		}
		if err != nil {
			return MemoryEmbeddingResult{}, err
		}
		if spaceID != execution.SpaceID {
			return MemoryEmbeddingResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		for _, vector := range vectors {
			result.Vectors = append(result.Vectors, append([]float64(nil), vector.GetValues()...))
		}
	}
	return result, nil
}

func (s *Service) DiscardMemoryEmbedding(ctx context.Context, raw []byte) error {
	var execution memoryEmbeddingExecution
	if err := decodeScenarioJobStrictJSON(raw, &execution); err != nil || execution.Version != 2 || !execution.Owner.valid() || len(execution.Jobs) == 0 {
		return fmt.Errorf("invalid embedding disposal reference")
	}
	return s.discardMemoryEmbeddingJobs(ctx, execution.Jobs, execution.Owner)
}

func (s *Service) discardMemoryEmbeddingJobs(ctx context.Context, ids []string, owner EmbeddingOwner) error {
	if s == nil || s.scenarioJobs == nil {
		return memoryEmbeddingUnavailable()
	}
	jobs := make(map[string]bool, len(ids))
	for _, id := range ids {
		if id == "" || strings.TrimSpace(id) != id {
			return fmt.Errorf("invalid embedding Job reference")
		}
		jobs[id] = true
	}
	return s.disposeEmbeddingPayloads(ctx, embeddingDisposalScope{account: memoryEmbeddingAccountID(ctx), owner: &owner, jobs: jobs})
}

func (s *Service) cancelUnstartedMemoryEmbedding(id string) {
	s.scenarioJobs.mu.RLock()
	record := s.scenarioJobs.jobs[id]
	pending := record != nil && record.job != nil && record.job.GetStatus() == runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_SUBMITTED && !record.executionStarted
	s.scenarioJobs.mu.RUnlock()
	if pending {
		_, _, _ = s.scenarioJobs.requestCancel(id, "Memory embedding context ended before execution")
		s.finishScenarioJobExecution(id)
		if job, found := s.scenarioJobs.get(id); found && isTerminalScenarioJobStatus(job.GetStatus()) {
			s.releaseCloudCredentialCustodyForJob(id)
			if record.payload != nil {
				if err := s.disposeEmbeddingJob(context.Background(), id, job.GetHead().GetSubjectUserId(), record.payload.Owner); err != nil {
					s.logScenarioJobPersistenceFailure("embedding payload cleanup pending", "job_id", id, "error", err)
				}
			}
		}
	}
}

func requireMemoryEmbeddingSpace(expected, actual string, err error) error {
	if err != nil {
		return err
	}
	if expected == "" || actual != expected {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}
