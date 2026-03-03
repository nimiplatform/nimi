package ai

import (
	"context"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/services/connector"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
)

const (
	defaultChunkSize            = 32
	defaultGenerateTimeout      = 30 * time.Second
	defaultStreamFirstTimeout   = 10 * time.Second
	defaultStreamTotalTimeout   = 120 * time.Second
	defaultEmbedTimeout         = 20 * time.Second
	defaultGenerateImageTimeout = 120 * time.Second
	defaultGenerateVideoTimeout = 300 * time.Second
	defaultSynthesizeTimeout    = 45 * time.Second
	defaultTranscribeTimeout    = 90 * time.Second
)

// Service implements RuntimeAiService with deterministic in-memory behavior.
type Service struct {
	runtimev1.UnimplementedRuntimeAiServiceServer
	logger                   *slog.Logger
	config                   Config
	selector                 *routeSelector
	audit                    *auditlog.Store
	registry                 *modelregistry.Registry
	registryPath             string
	scheduler                *scheduler.Scheduler
	mediaJobs                *mediaJobStore
	connStore                *connector.ConnectorStore
	localModel               localModelLister
	allowLoopback            bool
	streamFirstPacketTimeout time.Duration
}

// New creates a Service with all dependencies.
func New(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, daemonCfg config.Config) *Service {
	effectiveCfg := loadConfigFromEnv()
	effectiveCfg.EnforceEndpointSecurity = true
	effectiveCfg.AllowLoopbackEndpoint = daemonCfg.AllowLoopbackProviderEndpoint
	globalConc := daemonCfg.GlobalConcurrencyLimit
	if globalConc <= 0 {
		globalConc = 8
	}
	perAppConc := daemonCfg.PerAppConcurrencyLimit
	if perAppConc <= 0 {
		perAppConc = 2
	}
	svc := newFromProviderConfig(logger, registry, aiHealth, auditStore, connStore, effectiveCfg, globalConc, perAppConc)
	svc.allowLoopback = daemonCfg.AllowLoopbackProviderEndpoint
	return svc
}

// newFromProviderConfig is an internal constructor used by New and tests.
func newFromProviderConfig(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, connStore *connector.ConnectorStore, cfg Config, globalConc int, perAppConc int) *Service {
	if globalConc <= 0 {
		globalConc = 8
	}
	if perAppConc <= 0 {
		perAppConc = 2
	}
	return &Service{
		logger:                   logger,
		config:                   cfg,
		selector:                 newRouteSelectorWithRegistry(cfg, registry, aiHealth),
		audit:                    auditStore,
		registry:                 registry,
		scheduler:                scheduler.New(scheduler.Config{GlobalConcurrency: globalConc, PerAppConcurrency: perAppConc, StarvationThreshold: 30 * time.Second}),
		mediaJobs:                newMediaJobStore(),
		connStore:                connStore,
		streamFirstPacketTimeout: defaultStreamFirstTimeout,
	}
}

func (s *Service) SetModelRegistryPersistencePath(path string) {
	s.registryPath = strings.TrimSpace(path)
}

// SetLocalModelLister wires RuntimeLocalRuntimeService for local model availability checks.
func (s *Service) SetLocalModelLister(localSvc localModelLister) {
	s.localModel = localSvc
}

// CloudProvider returns the underlying cloud provider for cross-service wiring (e.g., ConnectorService probe).
func (s *Service) CloudProvider() *nimillm.CloudProvider {
	return s.selector.cloudProvider
}

func (s *Service) Generate(ctx context.Context, req *runtimev1.GenerateRequest) (*runtimev1.GenerateResponse, error) {
	if err := validateGenerateRequest(req); err != nil {
		return nil, err
	}

	// K-KEYSRC-004: parse and validate key-source
	parsed := parseKeySource(ctx, req.GetConnectorId())
	if err := validateKeySource(parsed, req.GetAppId()); err != nil {
		return nil, err
	}
	remoteTarget, err := resolveKeySourceToTarget(ctx, parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return nil, err
	}
	if err := s.validateLocalModelRequest(ctx, req.GetModelId(), remoteTarget); err != nil {
		return nil, err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("generate", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultGenerateTimeout)
	defer cancel()

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(ctx, req.GetRoutePolicy(), req.GetFallback(), req.GetModelId(), remoteTarget)
	if err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	traceID := ulid.Make().String()
	inputText := nimillm.ComposeInputText(req.GetSystemPrompt(), req.GetInput())

	// Use WithTarget if remote target is available and provider is CloudProvider
	var outputText string
	var usage *runtimev1.UsageStats
	var finishReason runtimev1.FinishReason
	if remoteTarget != nil {
		if cp := s.selector.cloudProvider; cp != nil {
			outputText, usage, finishReason, err = cp.GenerateTextWithTarget(requestCtx, modelResolved, req, inputText, remoteTarget)
		} else {
			outputText, usage, finishReason, err = selectedProvider.GenerateText(requestCtx, modelResolved, req, inputText)
		}
	} else {
		outputText, usage, finishReason, err = selectedProvider.GenerateText(requestCtx, modelResolved, req, inputText)
	}
	if err != nil {
		return nil, err
	}
	if usage == nil {
		usage = &runtimev1.UsageStats{
			InputTokens:  -1,
			OutputTokens: -1,
			ComputeMs:    -1,
		}
	}

	output, err := structpb.NewStruct(map[string]any{
		"text":  outputText,
		"modal": req.GetModal().String(),
	})
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	resp := &runtimev1.GenerateResponse{
		Output:        output,
		FinishReason:  finishReason,
		Usage:         usage,
		RouteDecision: routeDecision,
		ModelResolved: modelResolved,
		TraceId:       traceID,
	}
	return resp, nil
}

func (s *Service) StreamGenerate(req *runtimev1.StreamGenerateRequest, stream grpc.ServerStreamingServer[runtimev1.StreamGenerateEvent]) error {
	if err := validateStreamGenerateRequest(req); err != nil {
		return err
	}

	// K-KEYSRC-004: parse and validate key-source
	parsed := parseKeySource(stream.Context(), req.GetConnectorId())
	if err := validateKeySource(parsed, req.GetAppId()); err != nil {
		return err
	}
	remoteTarget, err := resolveKeySourceToTarget(stream.Context(), parsed, s.connStore, s.allowLoopback)
	if err != nil {
		return err
	}
	if err := s.validateLocalModelRequest(stream.Context(), req.GetModelId(), remoteTarget); err != nil {
		return err
	}

	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetAppId())
	if acquireErr != nil {
		return grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	defer release()
	waitMs := s.attachQueueWait(stream.Context(), acquireResult)
	stream.SetTrailer(usagemetrics.QueueWaitTrailer(waitMs))
	s.logQueueWait("stream_generate", req.GetAppId(), acquireResult)
	totalTimeout := timeoutDuration(req.GetTimeoutMs(), defaultStreamTotalTimeout)
	requestBaseCtx, baseCancel := withTimeout(stream.Context(), req.GetTimeoutMs(), defaultStreamTotalTimeout)
	defer baseCancel()
	requestCtx, requestCancel := context.WithCancel(requestBaseCtx)
	defer requestCancel()
	firstPacketTimedOut := &atomic.Bool{}
	firstPacketSeen := &atomic.Bool{}
	firstTimeout := s.streamFirstPacketTimeout
	if totalTimeout > 0 && totalTimeout < firstTimeout {
		firstTimeout = totalTimeout
	}
	if firstTimeout > 0 {
		time.AfterFunc(firstTimeout, func() {
			if firstPacketSeen.Load() {
				return
			}
			firstPacketTimedOut.Store(true)
			requestCancel()
		})
	}

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProviderWithTarget(stream.Context(), req.GetRoutePolicy(), req.GetFallback(), req.GetModelId(), remoteTarget)
	if err != nil {
		return err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	traceID := ulid.Make().String()

	var seq uint64
	send := func(event *runtimev1.StreamGenerateEvent) error {
		seq++
		event.Sequence = seq
		event.TraceId = traceID
		event.Timestamp = timestamppb.New(time.Now().UTC())
		return stream.Send(event)
	}
	failAndStop := func(cause error) error {
		if firstPacketTimedOut.Load() && !firstPacketSeen.Load() {
			cause = grpcerr.WithReasonCode(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT)
		}
		return send(&runtimev1.StreamGenerateEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			Payload: &runtimev1.StreamGenerateEvent_Failed{
				Failed: &runtimev1.StreamFailed{
					ReasonCode: reasonCodeFromStreamError(cause),
					ActionHint: "retry stream request",
				},
			},
		})
	}

	if err := send(&runtimev1.StreamGenerateEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_STARTED,
		Payload: &runtimev1.StreamGenerateEvent_Started{
			Started: &runtimev1.StreamStarted{
				ModelResolved: modelResolved,
				RouteDecision: routeDecision,
			},
		},
	}); err != nil {
		return err
	}

	inputText := nimillm.ComposeInputText(req.GetSystemPrompt(), req.GetInput())
	var usage *runtimev1.UsageStats
	var finishReason runtimev1.FinishReason
	var outputBuilder strings.Builder
	streamSimulated := false

	// K-STREAM-006: 32-byte chunk buffering
	var chunkBuf strings.Builder
	sendDelta := func(text string) error {
		if text == "" {
			return nil // K-STREAM-003: delta must be non-empty
		}
		chunkBuf.WriteString(text)
		if chunkBuf.Len() < defaultChunkSize {
			return nil // buffer until >= 32 bytes
		}
		chunk := chunkBuf.String()
		chunkBuf.Reset()
		return send(&runtimev1.StreamGenerateEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamGenerateEvent_Delta{
				Delta: &runtimev1.StreamDelta{Text: chunk},
			},
		})
	}
	flushDelta := func() error {
		if chunkBuf.Len() == 0 {
			return nil
		}
		chunk := chunkBuf.String()
		chunkBuf.Reset()
		return send(&runtimev1.StreamGenerateEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
			Payload: &runtimev1.StreamGenerateEvent_Delta{
				Delta: &runtimev1.StreamDelta{Text: chunk},
			},
		})
	}

	if streamer, ok := selectedProvider.(streamingTextProvider); ok {
		requestCtx = nimillm.WithStreamSimulationFlag(requestCtx, &streamSimulated)
		usage, finishReason, err = streamer.StreamGenerateText(requestCtx, modelResolved, req, func(part string) error {
			firstPacketSeen.Store(true)
			outputBuilder.WriteString(part)
			return sendDelta(part)
		})
		if err != nil {
			return failAndStop(err)
		}
	} else {
		streamSimulated = true
		outputText, streamUsage, streamFinish, generateErr := selectedProvider.GenerateText(requestCtx, modelResolved, streamToGenerateRequest(req), inputText)
		if generateErr != nil {
			return failAndStop(generateErr)
		}
		usage = streamUsage
		finishReason = streamFinish
		parts := nimillm.SplitText(outputText, 24)
		for _, part := range parts {
			firstPacketSeen.Store(true)
			outputBuilder.WriteString(part)
			if err := sendDelta(part); err != nil {
				return err
			}
		}
	}

	// Flush remaining buffered delta before termframe
	if err := flushDelta(); err != nil {
		return err
	}

	// K-STREAM-003: usage fallback — if upstream lacks usage, fill -1
	if usage == nil {
		usage = &runtimev1.UsageStats{
			InputTokens:  -1,
			OutputTokens: -1,
			ComputeMs:    -1,
		}
	}

	if len(req.GetTools()) > 0 {
		tool := req.GetTools()[0]
		if err := send(&runtimev1.StreamGenerateEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_TOOL_CALL,
			Payload: &runtimev1.StreamGenerateEvent_ToolCall{
				ToolCall: &runtimev1.ToolCallEvent{
					ToolName:  tool.GetName(),
					ToolInput: tool.GetInputSchema(),
				},
			},
		}); err != nil {
			return err
		}

		toolOutput, _ := structpb.NewStruct(map[string]any{
			"ok": true,
		})
		if err := send(&runtimev1.StreamGenerateEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_TOOL_RESULT,
			Payload: &runtimev1.StreamGenerateEvent_ToolResult{
				ToolResult: &runtimev1.ToolResultEvent{
					ToolName:   tool.GetName(),
					ToolOutput: toolOutput,
				},
			},
		}); err != nil {
			return err
		}
	}

	if strings.Contains(strings.ToLower(modelResolved), "stream-fail") {
		return send(&runtimev1.StreamGenerateEvent{
			EventType: runtimev1.StreamEventType_STREAM_EVENT_FAILED,
			Payload: &runtimev1.StreamGenerateEvent_Failed{
				Failed: &runtimev1.StreamFailed{
					ReasonCode: runtimev1.ReasonCode_AI_STREAM_BROKEN,
					ActionHint: "retry stream request",
				},
			},
		})
	}

	if streamSimulated {
		s.recordStreamFallbackSimulated(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved)
	}

	// K-STREAM-003: single done=true termframe carrying usage + finish_reason
	return send(&runtimev1.StreamGenerateEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
		Payload: &runtimev1.StreamGenerateEvent_Completed{
			Completed: &runtimev1.StreamCompleted{
				FinishReason:    finishReason,
				Usage:           usage,
				StreamSimulated: streamSimulated,
			},
		},
	})
}

func (s *Service) recordStreamFallbackSimulated(appID string, subjectUserID string, requestedModelID string, resolvedModelID string) {
	if s.audit == nil {
		return
	}
	payload, _ := structpb.NewStruct(map[string]any{
		"requestedModelId": strings.TrimSpace(requestedModelID),
		"resolvedModelId":  strings.TrimSpace(resolvedModelID),
	})
	s.audit.AppendEvent(&runtimev1.AuditEventRecord{
		AuditId:       ulid.Make().String(),
		AppId:         strings.TrimSpace(appID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		Domain:        "runtime.ai",
		Operation:     "stream_fallback_simulated",
		ReasonCode:    runtimev1.ReasonCode_ACTION_EXECUTED,
		TraceId:       ulid.Make().String(),
		Timestamp:     timestamppb.New(time.Now().UTC()),
		Payload:       payload,
	})
}
