package runtimeagent

import (
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// K-AGCORE-144..150 Runtime Agent execution config domain. The admitted
// capability set, readiness vocabulary, and scope names are fixed by
// .nimi/spec/runtime/kernel/tables/agent-execution-config.yaml.
const (
	executionCapabilityTextGenerate  = "text.generate"
	executionCapabilityImageGenerate = "image.generate"

	executionConfigSeedAppID = "runtime"

	// executionConfigChangedEventType is the table-admitted
	// runtime.agent.execution_config.changed event family name; this wave it
	// is the audit operation for committed mutations. The app-message
	// projection of the changed/readiness_changed families is deferred: the
	// existing chatAppEmit seam is session-scoped (targets a caller app id)
	// and has no clean instance-scoped fan-out home yet, so the gRPC
	// subscription stream is the only push channel this wave.
	executionConfigChangedEventType = "runtime.agent.execution_config.changed"
)

// admittedExecutionCapabilities is the table-admitted capability set in the
// deterministic order readiness snapshots project it.
var admittedExecutionCapabilities = []string{
	executionCapabilityTextGenerate,
	executionCapabilityImageGenerate,
}

func isAdmittedExecutionCapability(capability string) bool {
	for _, admitted := range admittedExecutionCapabilities {
		if capability == admitted {
			return true
		}
	}
	return false
}

// initExecutionConfig runs at service construction: it seeds the bootstrap
// config when no committed row exists (K-AGCORE-150) and computes the initial
// readiness projection. It never overwrites an existing committed config.
func (s *Service) initExecutionConfig() error {
	if s.execConfigRepo == nil {
		// No persistence backend: the execution config surface stays
		// unavailable and every RPC on it fails closed with Internal.
		return nil
	}
	_, exists, err := s.execConfigRepo.load()
	if err != nil {
		return fmt.Errorf("load execution config at start: %w", err)
	}
	if !exists {
		seed := &runtimev1.RuntimeAgentExecutionConfig{
			Revision: 1,
			Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
				{
					Capability:  executionCapabilityTextGenerate,
					ModelId:     texttarget.InternalDefaultLocalTextModelAlias,
					RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
				},
			},
			UpdatedAt:      timestamppb.New(time.Now().UTC()),
			UpdatedByAppId: executionConfigSeedAppID,
		}
		if err := s.execConfigRepo.commitSeed(seed); err != nil {
			if errors.Is(err, errExecutionConfigAlreadySeeded) {
				// Another writer committed first; the existing config wins.
				return s.refreshExecutionReadiness()
			}
			return fmt.Errorf("seed execution config: %w", err)
		}
		s.recordExecutionConfigAudit(seed, "runtime.agent.execution_config.seeded")
		if s.logger != nil {
			s.logger.Info(
				"seeded runtime agent execution config",
				"revision", seed.GetRevision(),
				"text_generate_model", texttarget.InternalDefaultLocalTextModelAlias,
			)
		}
	}
	// refreshExecutionReadiness recomputes the projection and pushes the new
	// snapshot (carrying the committed config_revision) to every in-process
	// subscriber; it is the K-AGCORE-149 change broadcast for seed and load.
	return s.refreshExecutionReadiness()
}

// committedExecutionConfig loads the committed config. After seeding, a
// missing row is an internal fail-closed error, never a silent re-seed
// (K-AGCORE-150).
func (s *Service) committedExecutionConfig() (*runtimev1.RuntimeAgentExecutionConfig, error) {
	if s == nil || s.execConfigRepo == nil {
		return nil, status.Error(codes.Internal, "runtime agent execution config store unavailable")
	}
	config, exists, err := s.execConfigRepo.load()
	if err != nil {
		return nil, status.Errorf(codes.Internal, "load runtime agent execution config: %v", err)
	}
	if !exists {
		return nil, status.Error(codes.Internal, "runtime agent execution config missing after seed (K-AGCORE-150)")
	}
	return config, nil
}

// upsertExecutionConfig validates and commits a full replacement config via
// expected-revision CAS, emits the change audit record, and refreshes the
// readiness projection.
func (s *Service) upsertExecutionConfig(appID string, expectedRevision uint64, bindings []*runtimev1.RuntimeAgentExecutionCapabilityBinding) (*runtimev1.RuntimeAgentExecutionConfig, error) {
	if s.isClosed() {
		return nil, status.Error(codes.Unavailable, "runtime agent service is closed")
	}
	trimmedAppID := strings.TrimSpace(appID)
	if trimmedAppID == "" {
		return nil, status.Error(codes.InvalidArgument, "context.app_id is required for execution config mutation")
	}
	normalized, err := normalizeExecutionConfigBindings(bindings)
	if err != nil {
		return nil, err
	}

	s.execConfigMu.Lock()
	defer s.execConfigMu.Unlock()

	current, err := s.committedExecutionConfig()
	if err != nil {
		return nil, err
	}
	if current.GetRevision() != expectedRevision {
		return nil, executionConfigRevisionConflictError(expectedRevision, current.GetRevision())
	}
	next := &runtimev1.RuntimeAgentExecutionConfig{
		Revision:       expectedRevision + 1,
		Bindings:       normalized,
		UpdatedAt:      timestamppb.New(time.Now().UTC()),
		UpdatedByAppId: trimmedAppID,
	}
	if err := s.execConfigRepo.commitMutation(expectedRevision, next); err != nil {
		if errors.Is(err, errExecutionConfigRevisionConflict) {
			return nil, executionConfigRevisionConflictError(expectedRevision, current.GetRevision())
		}
		if errors.Is(err, errExecutionConfigMissing) {
			return nil, status.Error(codes.Internal, "runtime agent execution config missing after seed (K-AGCORE-150)")
		}
		return nil, status.Errorf(codes.Internal, "commit runtime agent execution config: %v", err)
	}
	s.recordExecutionConfigAudit(next, executionConfigChangedEventType)
	// refreshExecutionReadiness pushes the post-mutation snapshot (new
	// config_revision) to all subscribers: the K-AGCORE-149 change broadcast.
	if err := s.refreshExecutionReadiness(); err != nil && s.logger != nil {
		s.logger.Warn("recompute execution readiness after config mutation failed", "error", err)
	}
	return cloneExecutionConfig(next), nil
}

func executionConfigRevisionConflictError(expected uint64, committed uint64) error {
	return status.Errorf(
		codes.Aborted,
		"execution config concurrent modification: expected_revision=%d committed_revision=%d; re-read the committed config and retry",
		expected, committed,
	)
}

// normalizeExecutionConfigBindings validates the full replacement binding set
// fail-closed and returns trimmed clones (K-AGCORE-144).
func normalizeExecutionConfigBindings(bindings []*runtimev1.RuntimeAgentExecutionCapabilityBinding) ([]*runtimev1.RuntimeAgentExecutionCapabilityBinding, error) {
	if len(bindings) == 0 {
		return nil, status.Error(codes.InvalidArgument, "execution config requires at least the text.generate binding")
	}
	seen := make(map[string]struct{}, len(bindings))
	out := make([]*runtimev1.RuntimeAgentExecutionCapabilityBinding, 0, len(bindings))
	for _, binding := range bindings {
		if binding == nil {
			return nil, status.Error(codes.InvalidArgument, "execution config binding must not be empty")
		}
		capability := strings.TrimSpace(binding.GetCapability())
		if capability == "" {
			return nil, status.Error(codes.InvalidArgument, "execution config binding capability is required")
		}
		if !isAdmittedExecutionCapability(capability) {
			return nil, status.Errorf(codes.InvalidArgument, "execution config capability %q is not admitted", capability)
		}
		if _, dup := seen[capability]; dup {
			return nil, status.Errorf(codes.InvalidArgument, "execution config capability %q bound more than once", capability)
		}
		seen[capability] = struct{}{}
		modelID := strings.TrimSpace(binding.GetModelId())
		if modelID == "" {
			return nil, status.Errorf(codes.InvalidArgument, "execution config binding for %q requires model_id", capability)
		}
		routePolicy := binding.GetRoutePolicy()
		if routePolicy == runtimev1.RoutePolicy_ROUTE_POLICY_UNSPECIFIED {
			return nil, status.Errorf(codes.InvalidArgument, "execution config binding for %q requires an explicit route_policy", capability)
		}
		targetRef := binding.GetTargetRef()
		if targetRef != nil {
			switch target := targetRef.GetTarget().(type) {
			case *runtimev1.RuntimeDurableTargetRef_LocalRuntime:
				if routePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
					return nil, status.Errorf(codes.InvalidArgument, "execution config binding for %q has a local_runtime target_ref but route_policy is not local", capability)
				}
				_ = target
			case *runtimev1.RuntimeDurableTargetRef_Cloud:
				if routePolicy != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
					return nil, status.Errorf(codes.InvalidArgument, "execution config binding for %q has a cloud target_ref but route_policy is not cloud", capability)
				}
			default:
				return nil, status.Errorf(codes.InvalidArgument, "execution config binding for %q target_ref must set exactly one of local_runtime or cloud", capability)
			}
		}
		cloned := proto.Clone(binding).(*runtimev1.RuntimeAgentExecutionCapabilityBinding)
		cloned.Capability = capability
		cloned.ModelId = modelID
		cloned.ConnectorId = strings.TrimSpace(binding.GetConnectorId())
		out = append(out, cloned)
	}
	if _, ok := seen[executionCapabilityTextGenerate]; !ok {
		return nil, status.Error(codes.InvalidArgument, "execution config must retain the required text.generate binding")
	}
	return out, nil
}

func cloneExecutionConfig(config *runtimev1.RuntimeAgentExecutionConfig) *runtimev1.RuntimeAgentExecutionConfig {
	if config == nil {
		return nil
	}
	return proto.Clone(config).(*runtimev1.RuntimeAgentExecutionConfig)
}

// recordExecutionConfigAudit writes the K-AGCORE-145 mutation audit record.
// When the audit store is not attached yet (the bootstrap seed commits during
// service construction, before SetAuditStore), the record is parked and
// flushed by SetAuditStore so the seed still enters the audit trail.
func (s *Service) recordExecutionConfigAudit(config *runtimev1.RuntimeAgentExecutionConfig, operation string) {
	if s == nil || config == nil {
		return
	}
	capabilities := make([]any, 0, len(config.GetBindings()))
	for _, binding := range config.GetBindings() {
		capabilities = append(capabilities, binding.GetCapability())
	}
	payload, err := structpb.NewStruct(map[string]any{
		"revision":          config.GetRevision(),
		"updated_by_app_id": config.GetUpdatedByAppId(),
		"capabilities":      capabilities,
		"recorded_at":       timestampString(config.GetUpdatedAt()),
	})
	if err != nil {
		if s.logger != nil {
			s.logger.Warn("build execution config audit payload failed", "error", err)
		}
		return
	}
	record := &runtimev1.AuditEventRecord{
		AuditId:     fmt.Sprintf("runtime-agent-execution-config-rev-%d", config.GetRevision()),
		AppId:       "runtime",
		Domain:      "runtime.agent",
		Operation:   operation,
		ReasonCode:  runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:     fmt.Sprintf("execution-config-rev-%d", config.GetRevision()),
		Timestamp:   config.GetUpdatedAt(),
		Payload:     payload,
		CallerId:    "runtime.agent.service",
		SurfaceId:   "runtime.agent.execution_config",
		Capability:  "runtime.agent.execution_config.write",
		PrincipalId: config.GetUpdatedByAppId(),
	}
	s.execAuditMu.Lock()
	store := s.auditStore
	if store == nil {
		// Only the bootstrap seed commits before SetAuditStore attaches the
		// store; park exactly that record so it still enters the audit trail.
		// Later mutations without a store follow the package audit precedent
		// (delegated_capability_audit.go): observable via logger, not parked.
		if s.execPendingSeedAudit == nil {
			s.execPendingSeedAudit = record
		}
		s.execAuditMu.Unlock()
		if s.logger != nil {
			s.logger.Info("execution config audit recorded without audit store", "operation", operation, "revision", config.GetRevision())
		}
		return
	}
	s.execAuditMu.Unlock()
	store.AppendEvent(record)
}

// flushPendingExecutionConfigAudit writes the parked seed audit record once
// the audit store is attached.
func (s *Service) flushPendingExecutionConfigAudit() {
	if s == nil {
		return
	}
	s.execAuditMu.Lock()
	record := s.execPendingSeedAudit
	store := s.auditStore
	if record == nil || store == nil {
		s.execAuditMu.Unlock()
		return
	}
	s.execPendingSeedAudit = nil
	s.execAuditMu.Unlock()
	store.AppendEvent(record)
}
