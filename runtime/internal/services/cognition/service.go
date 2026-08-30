package cognition

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	nimicognition "github.com/nimiplatform/nimi/nimi-cognition/cognition"
	"github.com/nimiplatform/nimi/nimi-cognition/memoryv1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
)

type AgentSourceUnit struct {
	UnitID         string
	Category       string
	SourcePath     string
	SourceRef      AgentSourceRef
	Text           string
	ProvenanceRefs []string
	Priority       int64
	Score          float64
}

type AgentSourceOmission struct {
	UnitID         string
	Category       string
	SourcePath     string
	SourceRef      AgentSourceRef
	OmissionReason string
	ProvenanceRefs []string
}

type AgentSourceRef struct {
	Kind          string
	WorldID       string
	RefID         string
	SchemaVersion string
	ContentHash   string
}

type AgentSourceOutcome struct {
	Status            string
	ScopeID           string
	SnapshotIdentity  string
	PartitionIdentity string
	Generation        uint64
	UnitCount         uint32
	OmissionCount     uint32
	Units             []AgentSourceUnit
}

type DataRootCheckResource struct {
	Kind   string
	Status string
	Reason string
}

type AgentSourceEmbeddingExecution struct {
	Status    string
	Identity  string
	Dimension int
	Vectors   [][]float64
}

type AgentSourceEmbeddingExecutor func(context.Context, string, string, []string) (AgentSourceEmbeddingExecution, error)

func (s *Service) SetAgentSourceEmbeddingExecutor(executor AgentSourceEmbeddingExecutor) {
	if s == nil {
		return
	}
	s.mu.Lock()
	s.agentSourceEmbeddingExecutor = executor
	s.mu.Unlock()
}

func (s *Service) agentSourceExecutor() AgentSourceEmbeddingExecutor {
	if s == nil {
		return nil
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.agentSourceEmbeddingExecutor
}

func (s *Service) IngestAgentSource(ctx context.Context, accountID, localAgentRef, scopeID, snapshotIdentity, partitionIdentity string, units []AgentSourceUnit, omissions []AgentSourceOmission) (AgentSourceOutcome, error) {
	if s == nil || s.sourceBridge == nil {
		return AgentSourceOutcome{}, errors.New("cognition service unavailable")
	}
	envelope := nimicognition.RuntimeSourceIngestionEnvelope{ScopeID: scopeID, SnapshotIdentity: snapshotIdentity, PartitionIdentity: partitionIdentity, Omissions: projectAgentSourceOmissions(omissions), CoverageCount: uint32(len(units) + len(omissions)), EmbeddingStatus: "building"}
	for _, unit := range units {
		projected := nimicognition.RuntimeSourceUnit{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: nimicognition.RuntimeSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority}
		envelope.Units = append(envelope.Units, projected)
	}
	building, err := s.sourceBridge.IngestAgentSource(ctx, agentSourceAuthorization(accountID, scopeID, nimicognition.RuntimeAuthorizationActionIngestAgentSource, nimicognition.RuntimeBridgeOperationIngestAgentSource), envelope)
	if err != nil {
		return AgentSourceOutcome{}, err
	}
	if building.ScopeID != scopeID || building.SnapshotIdentity != snapshotIdentity || building.PartitionIdentity != partitionIdentity ||
		building.UnitCount != uint32(len(units)) || building.OmissionCount != uint32(len(omissions)) || building.Status != "building" || building.Generation == 0 {
		return AgentSourceOutcome{}, errors.New("cognition service: building source generation binding is invalid")
	}
	s.startAgentSourceCompletion(accountID, localAgentRef, envelope, building.Generation)
	return projectAgentSourceOutcome(building), nil
}

func (s *Service) startAgentSourceCompletion(accountID, localAgentRef string, envelope nimicognition.RuntimeSourceIngestionEnvelope, generation uint64) {
	s.agentSourceLifecycleMu.Lock()
	if s.agentSourceLifecycleClosed {
		s.agentSourceLifecycleMu.Unlock()
		return
	}
	s.agentSourceWG.Add(1)
	lifecycleCtx := s.agentSourceLifecycleCtx
	s.agentSourceLifecycleMu.Unlock()
	go func() {
		defer s.agentSourceWG.Done()
		ctx, cancel := context.WithTimeout(lifecycleCtx, 5*time.Minute)
		defer cancel()
		s.completeAgentSourceGeneration(ctx, accountID, localAgentRef, envelope, generation)
	}()
}

func (s *Service) completeAgentSourceGeneration(ctx context.Context, accountID, localAgentRef string, envelope nimicognition.RuntimeSourceIngestionEnvelope, generation uint64) {
	execution := AgentSourceEmbeddingExecution{Status: "unconfigured"}
	if executor := s.agentSourceExecutor(); executor != nil {
		texts := make([]string, 0, len(envelope.Units))
		for _, unit := range envelope.Units {
			texts = append(texts, unit.Text)
		}
		resolved, executionErr := executor(ctx, accountID, localAgentRef, texts)
		resolved.Status = normalizeAgentSourceEmbeddingStatus(resolved.Status)
		if executionErr != nil && resolved.Status == "ready" {
			resolved.Status = "failure"
		}
		execution = resolved
		if executionErr != nil && s.logger != nil {
			s.logger.Warn("source Cognition embedding generation did not reach ready", "status", execution.Status, "error", executionErr)
		}
	}
	terminal := envelope
	terminal.Generation = generation
	terminal.EmbeddingStatus = execution.Status
	terminal.EmbeddingIdentity = ""
	terminal.EmbeddingDimension = 0
	if execution.Status == "ready" && strings.TrimSpace(execution.Identity) != "" && execution.Dimension > 0 && len(execution.Vectors) == len(terminal.Units) {
		terminal.EmbeddingIdentity = execution.Identity
		terminal.EmbeddingDimension = execution.Dimension
		for index := range terminal.Units {
			terminal.Units[index].Embedding = append([]float64(nil), execution.Vectors[index]...)
		}
	} else if execution.Status == "ready" {
		terminal.EmbeddingStatus = "failure"
	}
	auth := agentSourceAuthorization(accountID, terminal.ScopeID, nimicognition.RuntimeAuthorizationActionIngestAgentSource, nimicognition.RuntimeBridgeOperationIngestAgentSource)
	outcome, err := s.sourceBridge.IngestAgentSource(ctx, auth, terminal)
	if err != nil && terminal.EmbeddingStatus == "ready" {
		terminal.EmbeddingStatus = "failure"
		terminal.EmbeddingIdentity = ""
		terminal.EmbeddingDimension = 0
		for index := range terminal.Units {
			terminal.Units[index].Embedding = nil
		}
		outcome, err = s.sourceBridge.IngestAgentSource(ctx, auth, terminal)
	}
	if err != nil || outcome.ScopeID != terminal.ScopeID || outcome.SnapshotIdentity != terminal.SnapshotIdentity || outcome.PartitionIdentity != terminal.PartitionIdentity ||
		outcome.UnitCount != uint32(len(terminal.Units)) || outcome.OmissionCount != uint32(len(terminal.Omissions)) || outcome.Generation != generation {
		if s.logger != nil {
			s.logger.Warn("source Cognition generation did not commit terminal state", "status", terminal.EmbeddingStatus, "error", err)
		}
	}
}

func agentSourceAuthorization(accountID, scopeID string, action nimicognition.RuntimeAuthorizationAction, operation nimicognition.RuntimeBridgeOperation) nimicognition.RuntimeAuthorization {
	now := time.Now().UTC()
	return nimicognition.RuntimeAuthorization{Decision: nimicognition.RuntimeAuthorizationDecisionAllow, Action: action, Operation: operation, AccountID: accountID, AppID: "runtime.agent", ScopeID: scopeID, Owner: nimicognition.RuntimeSourceOwner{Kind: "runtime_local_agent_source"}, EvaluatedAt: now, ExpiresAt: now.Add(time.Minute)}
}

func normalizeAgentSourceEmbeddingStatus(status string) string {
	switch strings.TrimSpace(status) {
	case "ready":
		return "ready"
	case "unconfigured":
		return "unconfigured"
	case "unavailable":
		return "unavailable"
	case "failure":
		return "failure"
	default:
		return "failure"
	}
}

func projectAgentSourceOmissions(omissions []AgentSourceOmission) []nimicognition.RuntimeSourceOmission {
	result := make([]nimicognition.RuntimeSourceOmission, 0, len(omissions))
	for _, omission := range omissions {
		result = append(result, nimicognition.RuntimeSourceOmission{
			UnitID: omission.UnitID, Category: omission.Category, SourcePath: omission.SourcePath,
			SourceRef:      nimicognition.RuntimeSourceRef{Kind: omission.SourceRef.Kind, WorldID: omission.SourceRef.WorldID, RefID: omission.SourceRef.RefID, SchemaVersion: omission.SourceRef.SchemaVersion, ContentHash: omission.SourceRef.ContentHash},
			OmissionReason: omission.OmissionReason,
			ProvenanceRefs: append([]string{}, omission.ProvenanceRefs...),
		})
	}
	return result
}

func projectAgentSourceOutcome(out nimicognition.RuntimeSourceOutcome) AgentSourceOutcome {
	return AgentSourceOutcome{
		Status: out.Status, ScopeID: out.ScopeID, SnapshotIdentity: out.SnapshotIdentity,
		PartitionIdentity: out.PartitionIdentity, Generation: out.Generation,
		UnitCount: out.UnitCount, OmissionCount: out.OmissionCount,
	}
}

func (s *Service) SearchAgentSource(ctx context.Context, accountID, localAgentRef, scopeID, snapshotIdentity, query string, limit int) (AgentSourceOutcome, error) {
	if s == nil || s.sourceBridge == nil {
		return AgentSourceOutcome{Status: "unavailable", ScopeID: scopeID, SnapshotIdentity: snapshotIdentity}, nil
	}
	auth := agentSourceAuthorization(accountID, scopeID, nimicognition.RuntimeAuthorizationActionSearchAgentSource, nimicognition.RuntimeBridgeOperationSearchAgentSource)
	state, err := s.sourceBridge.InspectAgentSource(ctx, auth, scopeID, snapshotIdentity)
	if err != nil {
		return AgentSourceOutcome{}, err
	}
	if state.Status != "ready" {
		return projectAgentSourceOutcome(state), nil
	}
	executor := s.agentSourceExecutor()
	if executor == nil {
		out := projectAgentSourceOutcome(state)
		out.Status = "unconfigured"
		return out, nil
	}
	execution, executionErr := executor(ctx, accountID, localAgentRef, []string{query})
	execution.Status = normalizeAgentSourceEmbeddingStatus(execution.Status)
	if executionErr != nil && execution.Status == "ready" {
		execution.Status = "failure"
	}
	if executionErr != nil || execution.Status != "ready" || len(execution.Vectors) != 1 {
		if s.logger != nil {
			s.logger.Warn("source Cognition query embedding did not reach ready", "status", execution.Status, "error", executionErr)
		}
		out := projectAgentSourceOutcome(state)
		out.Status = execution.Status
		return out, nil
	}
	auth = agentSourceAuthorization(accountID, scopeID, nimicognition.RuntimeAuthorizationActionSearchAgentSource, nimicognition.RuntimeBridgeOperationSearchAgentSource)
	out, err := s.sourceBridge.SearchAgentSource(ctx, auth, scopeID, snapshotIdentity, execution.Identity, query, execution.Vectors[0], limit)
	if err != nil {
		return AgentSourceOutcome{}, err
	}
	result := projectAgentSourceOutcome(out)
	result.Units = make([]AgentSourceUnit, 0, len(out.Units))
	for _, unit := range out.Units {
		result.Units = append(result.Units, AgentSourceUnit{UnitID: unit.UnitID, Category: unit.Category, SourcePath: unit.SourcePath, SourceRef: AgentSourceRef{Kind: unit.SourceRef.Kind, WorldID: unit.SourceRef.WorldID, RefID: unit.SourceRef.RefID, SchemaVersion: unit.SourceRef.SchemaVersion, ContentHash: unit.SourceRef.ContentHash}, Text: unit.Text, ProvenanceRefs: append([]string{}, unit.ProvenanceRefs...), Priority: unit.Priority, Score: unit.Score})
	}
	return result, nil
}

func (s *Service) InspectAgentSource(ctx context.Context, accountID, scopeID, snapshotIdentity string) (AgentSourceOutcome, error) {
	if s == nil || s.sourceBridge == nil {
		return AgentSourceOutcome{Status: "unavailable"}, nil
	}
	now := time.Now().UTC()
	auth := nimicognition.RuntimeAuthorization{Decision: nimicognition.RuntimeAuthorizationDecisionAllow, Action: nimicognition.RuntimeAuthorizationActionSearchAgentSource, Operation: nimicognition.RuntimeBridgeOperationSearchAgentSource, AccountID: accountID, AppID: "runtime.agent", ScopeID: scopeID, Owner: nimicognition.RuntimeSourceOwner{Kind: "runtime_local_agent_source"}, EvaluatedAt: now, ExpiresAt: now.Add(time.Minute)}
	out, err := s.sourceBridge.InspectAgentSource(ctx, auth, scopeID, snapshotIdentity)
	return projectAgentSourceOutcome(out), err
}

func (s *Service) DeleteAgentSource(ctx context.Context, accountID, scopeID, snapshotIdentity string) (AgentSourceOutcome, error) {
	if s == nil || s.sourceBridge == nil {
		return AgentSourceOutcome{}, errors.New("cognition service unavailable")
	}
	now := time.Now().UTC()
	auth := nimicognition.RuntimeAuthorization{Decision: nimicognition.RuntimeAuthorizationDecisionAllow, Action: nimicognition.RuntimeAuthorizationActionDeleteAgentSource, Operation: nimicognition.RuntimeBridgeOperationDeleteAgentSource, AccountID: accountID, AppID: "runtime.agent", ScopeID: scopeID, Owner: nimicognition.RuntimeSourceOwner{Kind: "runtime_local_agent_source"}, EvaluatedAt: now, ExpiresAt: now.Add(time.Minute)}
	out, err := s.sourceBridge.DeleteAgentSource(ctx, auth, scopeID, snapshotIdentity)
	return projectAgentSourceOutcome(out), err
}

type Service struct {
	logger       *slog.Logger
	owner        *nimicognition.V1Owner
	sourceBridge *nimicognition.RuntimeSourceBridge
	root         string

	mu                           sync.RWMutex
	agentSourceEmbeddingExecutor AgentSourceEmbeddingExecutor
	agentSourceLifecycleMu       sync.Mutex
	agentSourceLifecycleCtx      context.Context
	agentSourceLifecycleCancel   context.CancelFunc
	agentSourceLifecycleClosed   bool
	agentSourceWG                sync.WaitGroup
}

func (s *Service) MemoryCore() *memoryv1.Core {
	if s == nil || s.owner == nil {
		return nil
	}
	return s.owner.MemoryCore()
}

// @nimi-authority: definition.nimi.cognition.runtime-bridge.domain
// @nimi-authority: rule.nimi.cognition.runtime-bridge.r002
// NewV1Owner constructs the in-process Cognition owner used only through the
// typed Memory and Agent Source bridges. It does not construct legacy
// Cognition services or implement an App-callable service.
func NewV1Owner(logger *slog.Logger, cfg config.Config) (*Service, error) {
	if logger == nil {
		logger = slog.Default()
	}
	root := filepath.Join(filepath.Dir(strings.TrimSpace(cfg.LocalStatePath)), "runtime-cognition")
	owner, err := nimicognition.NewV1Owner(root)
	if err != nil {
		return nil, fmt.Errorf("cognition service: init V1 owner: %w", err)
	}
	agentSourceLifecycleCtx, agentSourceLifecycleCancel := context.WithCancel(context.Background())
	return &Service{
		logger:                     logger,
		owner:                      owner,
		sourceBridge:               owner.SourceBridge(),
		root:                       root,
		agentSourceLifecycleCtx:    agentSourceLifecycleCtx,
		agentSourceLifecycleCancel: agentSourceLifecycleCancel,
	}, nil
}

// @nimi-authority: rule.nimi.cognition.runtime-bridge.r025
func (s *Service) CheckSyncRoot(dataRoot string) error {
	_, err := s.CheckSyncDataRoot(context.Background(), dataRoot)
	return err
}

// CheckSyncDataRoot delegates structural verification to the Cognition V1
// owner. Runtime receives only typed aggregate outcomes and never opens or
// interprets Cognition SQLite state.
// @nimi-authority: rule.nimi.platform.product-lifecycle.p-mig-007e
func (s *Service) CheckSyncDataRoot(ctx context.Context, dataRoot string) ([]DataRootCheckResource, error) {
	if s == nil || s.owner == nil || s.MemoryCore() == nil || s.sourceBridge == nil {
		return nil, errors.New("Cognition owner is unavailable")
	}
	expected := filepath.Join(filepath.Clean(strings.TrimSpace(dataRoot)), "accounts", "runtime", "runtime-cognition")
	if !sameCognitionPath(s.root, expected) {
		return nil, errors.New("Cognition owner is not bound to the current data-root activation")
	}
	inspection, err := s.owner.InspectStore(ctx)
	if err != nil {
		return nil, err
	}
	resources := make([]DataRootCheckResource, 0, len(inspection.Resources))
	for _, resource := range inspection.Resources {
		resources = append(resources, DataRootCheckResource{Kind: resource.Kind, Status: resource.Status, Reason: resource.Reason})
	}
	return resources, nil
}

func (s *Service) QuiesceDataRoot() {
	_ = s.QuiesceDataRootContext(context.Background())
}

func (s *Service) QuiesceDataRootContext(ctx context.Context) error {
	if s == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	s.agentSourceLifecycleMu.Lock()
	if !s.agentSourceLifecycleClosed {
		s.agentSourceLifecycleClosed = true
		if s.agentSourceLifecycleCancel != nil {
			s.agentSourceLifecycleCancel()
		}
	}
	s.agentSourceLifecycleMu.Unlock()
	done := make(chan struct{})
	go func() {
		s.agentSourceWG.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (s *Service) ResumeDataRootAfterAbort() {
	if s == nil || s.owner == nil {
		return
	}
	s.agentSourceLifecycleMu.Lock()
	if s.agentSourceLifecycleClosed {
		s.agentSourceLifecycleCtx, s.agentSourceLifecycleCancel = context.WithCancel(context.Background())
		s.agentSourceLifecycleClosed = false
	}
	s.agentSourceLifecycleMu.Unlock()
}

func sameCognitionPath(left string, right string) bool {
	left = filepath.Clean(strings.TrimSpace(left))
	right = filepath.Clean(strings.TrimSpace(right))
	if goruntime.GOOS == "windows" {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func (s *Service) Close() error {
	if s == nil || s.owner == nil {
		return nil
	}
	s.agentSourceLifecycleMu.Lock()
	if !s.agentSourceLifecycleClosed {
		s.agentSourceLifecycleClosed = true
		if s.agentSourceLifecycleCancel != nil {
			s.agentSourceLifecycleCancel()
		}
	}
	s.agentSourceLifecycleMu.Unlock()
	s.agentSourceWG.Wait()
	return s.owner.Close()
}
