package ai

import (
	"context"
	"runtime"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/realtimecore"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

type videoSessionRecord struct {
	mu                          sync.Mutex
	id, accountID, subject      string
	generation                  uint64
	format                      *runtimev1.AiVideoSessionFormat
	ctx                         context.Context
	cancel                      context.CancelFunc
	host                        localexecution.VideoFaceSwapSession
	pending                     chan *runtimev1.SubmitVideoSessionFrameRequest
	results                     *realtimecore.Stream[*runtimev1.AiVideoSessionResult]
	lastSequence, lastTimestamp uint64
	lastConsumption             time.Time
	closed                      bool
	closeOnce                   sync.Once
	closeErr                    error
}

type videoSessionStore struct {
	mu      sync.RWMutex
	records map[string]*videoSessionRecord
}

func newVideoSessionStore() *videoSessionStore {
	return &videoSessionStore{records: make(map[string]*videoSessionRecord)}
}
func (store *videoSessionStore) get(id string) *videoSessionRecord {
	store.mu.RLock()
	defer store.mu.RUnlock()
	return store.records[id]
}
func (store *videoSessionStore) add(record *videoSessionRecord) {
	store.mu.Lock()
	defer store.mu.Unlock()
	store.records[record.id] = record
}
func (store *videoSessionStore) remove(id string) {
	store.mu.Lock()
	defer store.mu.Unlock()
	delete(store.records, id)
}
func (store *videoSessionStore) all() []*videoSessionRecord {
	store.mu.RLock()
	defer store.mu.RUnlock()
	result := make([]*videoSessionRecord, 0, len(store.records))
	for _, record := range store.records {
		result = append(result, record)
	}
	return result
}

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-session-operations
func (s *Service) OpenVideoSession(ctx context.Context, req *runtimev1.OpenVideoSessionRequest) (*runtimev1.OpenVideoSessionResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 || !localAppBoundedIdentifier(req.ReferenceImageArtifactId) || req.Format == nil || len(req.Format.ProtoReflect().GetUnknown()) != 0 || req.Format.Width != 1280 || req.Format.Height != 720 || req.Format.PixelFormat != runtimev1.AiVideoPixelFormat_AI_VIDEO_PIXEL_FORMAT_RGB8 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	decision, err := localAppScenarioDecision(ctx, accountservice.LocalAppOperationVideoSessionOpen, localappop.AppOperationIDVideoSessionOpen)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	ctx = localAppOwnerCallContext(ctx, decision)
	head := localAppScenarioHead(decision)
	ctx, intent, err := s.captureScenarioExecutionIntent(ctx, head, capabilitydriver.VideoFaceSwapContract)
	if err != nil {
		return nil, err
	}
	if !intent.IsLocal() {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	selected, err := s.resolveReferencedLocalExecution(ctx, intent)
	if err != nil {
		return nil, err
	}
	if selected == nil || !selected.Configured {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_CONFIGURATION_NOT_CONFIGURED)
	}
	resolved, reason := s.capabilityDrivers.Resolve(capabilitydriver.VideoFaceSwapContract, capabilitydriver.IdentityFromProto(selected.DriverIdentity))
	driver, ok := resolved.(capabilitydriver.InsightFaceVideoDriver)
	if !ok || reason != runtimev1.LocalCapabilityReason_LOCAL_CAPABILITY_REASON_UNSPECIFIED {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_DRIVER_UNAVAILABLE)
	}
	reference, err := s.resolveLocalImageArtifactInput(ctx, head, req.ReferenceImageArtifactId, capabilitydriver.ImageResolvedInputRoleSource)
	if err != nil {
		return nil, err
	}
	models, err := driver.PlanVideoFaceSwapSession(runtime.GOOS+"/"+runtime.GOARCH, selected.RecipeID, reference.ImageBytes, projectInvocationExactBindings(selected.ExactBindings), invocationExactDependencySources(selected.ExactDependencySources))
	if err != nil {
		return nil, localImageExecutionError(err)
	}
	if s.localFaceSwapHost == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_LOCAL_EXECUTION_LOAD_FAILED)
	}
	id := ulid.Make().String()
	host, err := s.localFaceSwapHost.OpenVideoFaceSwapSession(ctx, models, reference.ImageBytes, id, req.Format.Width, req.Format.Height)
	if err != nil {
		if _, ok := grpcerr.ExtractReasonCode(err); ok {
			return nil, err
		}
		return nil, localImageExecutionError(err)
	}
	if err := ctx.Err(); err != nil {
		_ = host.Close()
		return nil, localImageExecutionError(err)
	}
	results, err := realtimecore.NewStream[*runtimev1.AiVideoSessionResult](realtimecore.Config{RealtimeSessionID: id, ChannelID: id, AdapterKind: "video.face_swap", Generation: 1, Capacity: 4, PressureAt: 3})
	if err != nil {
		_ = host.Close()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	_ = results.Transition(1, realtimecore.LifecycleReady)
	life, stop := context.WithCancel(context.Background())
	record := &videoSessionRecord{id: id, accountID: decision.AccountID, subject: decision.RegisteredAppSubject, generation: 1, format: proto.Clone(req.Format).(*runtimev1.AiVideoSessionFormat), ctx: life, cancel: stop, host: host, pending: make(chan *runtimev1.SubmitVideoSessionFrameRequest, 1), results: results, lastConsumption: time.Now()}
	s.videoSessions.add(record)
	go s.runVideoSession(record)
	go s.watchVideoSessionConsumer(record)
	return &runtimev1.OpenVideoSessionResponse{VideoSessionId: id, Generation: 1, Format: proto.Clone(record.format).(*runtimev1.AiVideoSessionFormat), MaximumInFlightSubmissions: 2}, nil
}

func (s *Service) authorizedVideoSession(ctx context.Context, id string, generation uint64, operation accountservice.LocalAppOperation, appOperation string) (*videoSessionRecord, error) {
	decision, err := localAppScenarioDecision(ctx, operation, appOperation)
	if err != nil {
		return nil, err
	}
	if !localAppBoundedIdentifier(id) || generation == 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	record := s.videoSessions.get(id)
	if record == nil || record.accountID != decision.AccountID || record.subject != decision.RegisteredAppSubject {
		return nil, grpcerr.WithReasonCode(codes.PermissionDenied, runtimev1.ReasonCode_APP_SCOPE_FORBIDDEN)
	}
	if record.generation != generation {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_VIDEO_SESSION_GENERATION_INVALID)
	}
	return record, nil
}

func (s *Service) SubmitVideoSessionFrame(ctx context.Context, req *runtimev1.SubmitVideoSessionFrameRequest) (*runtimev1.SubmitVideoSessionFrameResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	record, err := s.authorizedVideoSession(ctx, req.VideoSessionId, req.Generation, accountservice.LocalAppOperationVideoSessionFrameSubmit, localappop.AppOperationIDVideoSessionFrameSubmit)
	if err != nil {
		return nil, err
	}
	record.mu.Lock()
	if record.closed {
		record.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
	}
	if req.Sequence == 0 || req.Sequence <= record.lastSequence || (record.lastSequence > 0 && req.TimestampUs < record.lastTimestamp) || len(req.Frame) != int(record.format.Width*record.format.Height*3) {
		record.mu.Unlock()
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	record.lastSequence, record.lastTimestamp = req.Sequence, req.TimestampUs
	frame := proto.Clone(req).(*runtimev1.SubmitVideoSessionFrameRequest)
	var dropped *runtimev1.SubmitVideoSessionFrameRequest
	select {
	case dropped = <-record.pending:
	default:
	}
	var publishErr error
	if dropped != nil {
		if record.results.Snapshot().BufferedItems == 0 {
			record.lastConsumption = time.Now()
		}
		_, publishErr = record.results.Publish(record.generation, &runtimev1.AiVideoSessionResult{VideoSessionId: record.id, Generation: record.generation, Result: &runtimev1.AiVideoSessionResult_InputDropped{InputDropped: &runtimev1.AiVideoFrameDisposition{Sequence: dropped.Sequence, TimestampUs: dropped.TimestampUs, ReasonCode: runtimev1.ReasonCode_AI_VIDEO_SESSION_OVERLOADED}}})
	}
	record.pending <- frame
	record.mu.Unlock()
	if publishErr != nil {
		_ = s.terminateVideoSession(record, runtimev1.ReasonCode_AI_VIDEO_SESSION_OVERLOADED, realtimecore.TerminalSlowConsumer)
	}
	return &runtimev1.SubmitVideoSessionFrameResponse{Accepted: true, Sequence: req.Sequence}, nil
}

func (s *Service) ReadVideoSessionResult(ctx context.Context, req *runtimev1.ReadVideoSessionResultRequest) (*runtimev1.ReadVideoSessionResultResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	record, err := s.authorizedVideoSession(ctx, req.VideoSessionId, req.Generation, accountservice.LocalAppOperationVideoSessionResultRead, localappop.AppOperationIDVideoSessionResultRead)
	if err != nil {
		return nil, err
	}
	queue, release, err := record.results.ClaimReader()
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.ResourceExhausted, runtimev1.ReasonCode_AI_VIDEO_SESSION_OVERLOADED)
	}
	defer release()
	timer := time.NewTimer(250 * time.Millisecond)
	defer timer.Stop()
	select {
	case result, ok := <-queue:
		if !ok {
			return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED)
		}
		record.mu.Lock()
		record.lastConsumption = time.Now()
		record.mu.Unlock()
		return &runtimev1.ReadVideoSessionResultResponse{Result: result}, nil
	case <-timer.C:
		return &runtimev1.ReadVideoSessionResultResponse{}, nil
	case <-ctx.Done():
		return nil, localImageExecutionError(ctx.Err())
	}
}

func (s *Service) CloseVideoSession(ctx context.Context, req *runtimev1.CloseVideoSessionRequest) (*runtimev1.CloseVideoSessionResponse, error) {
	if req == nil || len(req.ProtoReflect().GetUnknown()) != 0 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	record, err := s.authorizedVideoSession(ctx, req.VideoSessionId, req.Generation, accountservice.LocalAppOperationVideoSessionClose, localappop.AppOperationIDVideoSessionClose)
	if err != nil {
		return nil, err
	}
	if err := s.terminateVideoSession(record, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED, realtimecore.TerminalCancelled); err != nil {
		return nil, localImageExecutionError(err)
	}
	s.videoSessions.remove(record.id)
	return &runtimev1.CloseVideoSessionResponse{Closed: true}, nil
}

func (s *Service) runVideoSession(record *videoSessionRecord) {
	for {
		select {
		case <-record.ctx.Done():
			return
		case frame := <-record.pending:
			pixels, err := record.host.ReplaceFrame(record.ctx, frame.Frame)
			if record.ctx.Err() != nil {
				return
			}
			result := &runtimev1.AiVideoSessionResult{VideoSessionId: record.id, Generation: record.generation}
			if err == nil {
				result.Result = &runtimev1.AiVideoSessionResult_Transformed{Transformed: &runtimev1.AiVideoTransformedFrame{Sequence: frame.Sequence, TimestampUs: frame.TimestampUs, Frame: pixels}}
			} else {
				reason, ok := grpcerr.ExtractReasonCode(err)
				if !ok {
					reason = reasonCodeOr(localImageExecutionError(err), runtimev1.ReasonCode_AI_LOCAL_EXECUTION_INFERENCE_FAILED)
				}
				disposition := &runtimev1.AiVideoFrameDisposition{Sequence: frame.Sequence, TimestampUs: frame.TimestampUs, ReasonCode: reason}
				switch reason {
				case runtimev1.ReasonCode_AI_FACE_TARGET_MISSING:
					result.Result = &runtimev1.AiVideoSessionResult_NoTargetFace{NoTargetFace: disposition}
				case runtimev1.ReasonCode_AI_FACE_TARGET_AMBIGUOUS, runtimev1.ReasonCode_AI_INPUT_INVALID:
					result.Result = &runtimev1.AiVideoSessionResult_InputRejected{InputRejected: disposition}
				default:
					_ = s.terminateVideoSession(record, reason, realtimecore.TerminalOwnerFailed)
					return
				}
			}
			record.mu.Lock()
			if record.closed {
				record.mu.Unlock()
				return
			}
			if record.results.Snapshot().BufferedItems == 0 {
				record.lastConsumption = time.Now()
			}
			_, publishErr := record.results.Publish(record.generation, result)
			record.mu.Unlock()
			if publishErr != nil {
				_ = s.terminateVideoSession(record, runtimev1.ReasonCode_AI_VIDEO_SESSION_OVERLOADED, realtimecore.TerminalSlowConsumer)
				return
			}
		}
	}
}

func (s *Service) watchVideoSessionConsumer(record *videoSessionRecord) {
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-record.ctx.Done():
			return
		case <-ticker.C:
			record.mu.Lock()
			stalled := !record.closed && record.results.Snapshot().BufferedItems > 0 && time.Since(record.lastConsumption) > 2*time.Second
			record.mu.Unlock()
			if stalled {
				_ = s.terminateVideoSession(record, runtimev1.ReasonCode_AI_VIDEO_SESSION_OVERLOADED, realtimecore.TerminalSlowConsumer)
				return
			}
		}
	}
}

func (s *Service) terminateVideoSession(record *videoSessionRecord, reason runtimev1.ReasonCode, terminal realtimecore.TerminalReason) error {
	record.closeOnce.Do(func() {
		record.mu.Lock()
		record.closed = true
		select {
		case <-record.pending:
		default:
		}
		record.mu.Unlock()
		record.cancel()
		record.closeErr = record.host.Close()
		if record.closeErr != nil {
			reason = runtimev1.ReasonCode_AI_LOCAL_EXECUTION_PROCESS_CRASHED
			terminal = realtimecore.TerminalOwnerFailed
		}
		_ = record.results.PublishTerminal(record.generation, &runtimev1.AiVideoSessionResult{VideoSessionId: record.id, Generation: record.generation, Result: &runtimev1.AiVideoSessionResult_SessionTerminal{SessionTerminal: &runtimev1.AiVideoSessionTerminal{ReasonCode: reason}}}, terminal)
	})
	return record.closeErr
}

// @nimi-authority: rule.nimi.runtime.protected-session.r016
func (s *Service) RevokeProtectedLocalAppVideoSession(id string) {
	if s == nil || s.videoSessions == nil {
		return
	}
	if record := s.videoSessions.get(id); record != nil {
		_ = s.terminateVideoSession(record, runtimev1.ReasonCode_AI_REALTIME_SESSION_CLOSED, realtimecore.TerminalStaleGeneration)
		s.videoSessions.remove(id)
	}
}
