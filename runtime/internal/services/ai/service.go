package ai

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"github.com/nimiplatform/nimi/runtime/internal/scheduler"
	"github.com/nimiplatform/nimi/runtime/internal/usagemetrics"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"
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

var streamFirstPacketTimeout = defaultStreamFirstTimeout

// Service implements RuntimeAiService with deterministic in-memory behavior.
type Service struct {
	runtimev1.UnimplementedRuntimeAiServiceServer
	logger       *slog.Logger
	config       Config
	selector     *routeSelector
	audit        *auditlog.Store
	registry     *modelregistry.Registry
	registryPath string
	scheduler    *scheduler.Scheduler
	mediaJobs    *mediaJobStore
}

func New(logger *slog.Logger, cfg ...Config) *Service {
	return NewWithRegistry(logger, nil, cfg...)
}

func NewWithRegistry(logger *slog.Logger, registry *modelregistry.Registry, cfg ...Config) *Service {
	return NewWithDependencies(logger, registry, nil, nil, cfg...)
}

func NewWithDependencies(logger *slog.Logger, registry *modelregistry.Registry, aiHealth *providerhealth.Tracker, auditStore *auditlog.Store, cfg ...Config) *Service {
	effectiveCfg := loadConfigFromEnv()
	if len(cfg) > 0 {
		effectiveCfg = cfg[0].normalized()
	}
	return &Service{
		logger:    logger,
		config:    effectiveCfg,
		selector:  newRouteSelectorWithRegistry(effectiveCfg, registry, aiHealth),
		audit:     auditStore,
		registry:  registry,
		scheduler: scheduler.New(scheduler.Config{GlobalConcurrency: 8, PerAppConcurrency: 2, StarvationThreshold: 30 * time.Second}),
		mediaJobs: newMediaJobStore(),
	}
}

func (s *Service) SetModelRegistryPersistencePath(path string) {
	s.registryPath = strings.TrimSpace(path)
}

func (s *Service) Generate(ctx context.Context, req *runtimev1.GenerateRequest) (*runtimev1.GenerateResponse, error) {
	if err := validateGenerateRequest(req); err != nil {
		return nil, err
	}
	release, acquireResult, acquireErr := s.scheduler.Acquire(ctx, req.GetAppId())
	if acquireErr != nil {
		return nil, status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	defer release()
	s.attachQueueWaitUnary(ctx, acquireResult)
	s.logQueueWait("generate", req.GetAppId(), acquireResult)
	requestCtx, cancel := withTimeout(ctx, req.GetTimeoutMs(), defaultGenerateTimeout)
	defer cancel()

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
	if err != nil {
		return nil, err
	}
	s.recordRouteAutoSwitch(req.GetAppId(), req.GetSubjectUserId(), req.GetModelId(), modelResolved, routeInfo)

	traceID := ulid.Make().String()
	inputText := composeInputText(req.GetSystemPrompt(), req.GetInput())
	outputText, usage, finishReason, err := selectedProvider.generateText(requestCtx, modelResolved, req, inputText)
	if err != nil {
		return nil, err
	}
	if usage == nil {
		usage = estimateUsage(inputText, outputText)
	}

	output, err := structpb.NewStruct(map[string]any{
		"text":  outputText,
		"modal": req.GetModal().String(),
	})
	if err != nil {
		return nil, status.Error(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID.String())
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
	release, acquireResult, acquireErr := s.scheduler.Acquire(stream.Context(), req.GetAppId())
	if acquireErr != nil {
		return status.Error(codes.ResourceExhausted, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
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
	firstTimeout := streamFirstPacketTimeout
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

	selectedProvider, routeDecision, modelResolved, routeInfo, err := s.selector.resolveProvider(req.GetRoutePolicy(), req.GetFallback(), req.GetModelId())
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
			cause = status.Error(codes.DeadlineExceeded, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT.String())
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

	inputText := composeInputText(req.GetSystemPrompt(), req.GetInput())
	var usage *runtimev1.UsageStats
	var finishReason runtimev1.FinishReason
	var outputBuilder strings.Builder

	if streamer, ok := selectedProvider.(streamingTextProvider); ok {
		usage, finishReason, err = streamer.streamGenerateText(requestCtx, modelResolved, req, func(part string) error {
			firstPacketSeen.Store(true)
			outputBuilder.WriteString(part)
			return send(&runtimev1.StreamGenerateEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamGenerateEvent_Delta{
					Delta: &runtimev1.StreamDelta{Text: part},
				},
			})
		})
		if err != nil {
			return failAndStop(err)
		}
	} else {
		outputText, streamUsage, streamFinish, generateErr := selectedProvider.generateText(requestCtx, modelResolved, streamToGenerateRequest(req), inputText)
		if generateErr != nil {
			return failAndStop(generateErr)
		}
		usage = streamUsage
		finishReason = streamFinish
		parts := splitText(outputText, 24)
		for _, part := range parts {
			firstPacketSeen.Store(true)
			outputBuilder.WriteString(part)
			if err := send(&runtimev1.StreamGenerateEvent{
				EventType: runtimev1.StreamEventType_STREAM_EVENT_DELTA,
				Payload: &runtimev1.StreamGenerateEvent_Delta{
					Delta: &runtimev1.StreamDelta{Text: part},
				},
			}); err != nil {
				return err
			}
		}
	}

	outputText := outputBuilder.String()
	if usage == nil {
		usage = estimateUsage(inputText, outputText)
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

	if err := send(&runtimev1.StreamGenerateEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_USAGE,
		Payload: &runtimev1.StreamGenerateEvent_Usage{
			Usage: usage,
		},
	}); err != nil {
		return err
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

	return send(&runtimev1.StreamGenerateEvent{
		EventType: runtimev1.StreamEventType_STREAM_EVENT_COMPLETED,
		Payload: &runtimev1.StreamGenerateEvent_Completed{
			Completed: &runtimev1.StreamCompleted{
				FinishReason: finishReason,
			},
		},
	})
}
