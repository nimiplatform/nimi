package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-session-operations
func (host *FaceSwapExecutionHost) OpenVideoFaceSwapSession(ctx context.Context, models capabilitydriver.FaceSwapModelPlan, reference []byte, sessionID string, width, height uint32) (localexecution.VideoFaceSwapSession, error) {
	if sessionID == "" || width != 1280 || height != 720 {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
	if _, _, err := localexecution.FaceSwapImageSize(reference); err != nil {
		return nil, grpcerr.WrapWithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, err, grpcerr.ReasonOptions{})
	}
	if err := host.admitModels(models); err != nil {
		return nil, executionFailure(localexecution.FailureLoad, err)
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return nil, err
	}
	retained := false
	defer func() {
		if !retained {
			release()
		}
	}()
	if host.poisoned != nil {
		return nil, executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	if _, err := sealInvocationModelContentContext(ctx, models.Bindings); err != nil {
		return nil, err
	}
	if err := host.start(ctx, models); err != nil {
		return nil, host.fail(ctx, executionFailure(localexecution.FailureLoad, err))
	}
	bindings := map[string]string{}
	for _, binding := range models.Bindings {
		bindings[binding.RequirementID] = binding.AbsolutePath
	}
	body, err := json.Marshal(struct {
		SessionID string            `json:"session_id"`
		Reference []byte            `json:"reference"`
		Bindings  map[string]string `json:"bindings"`
		Width     uint32            `json:"width"`
		Height    uint32            `json:"height"`
	}{sessionID, reference, bindings, width, height})
	if err != nil {
		return nil, host.fail(ctx, err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, host.endpoint+"/v1/video/session/open", bytes.NewReader(body))
	if err != nil {
		return nil, host.fail(ctx, err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-nimi-face-swap-token", host.token)
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		return nil, host.fail(ctx, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, host.fail(ctx, faceSwapSessionResponseError(response.Body))
	}
	var ready struct {
		Ready bool `json:"ready"`
	}
	if json.NewDecoder(io.LimitReader(response.Body, 1024)).Decode(&ready) != nil || !ready.Ready {
		return nil, host.fail(ctx, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	if err := ctx.Err(); err != nil {
		return nil, host.fail(ctx, err)
	}
	retained = true
	return &faceSwapSessionHost{host: host, endpoint: host.endpoint, token: host.token, sessionID: sessionID, size: int(width * height * 3), release: release}, nil
}

type faceSwapSessionHost struct {
	host                       *FaceSwapExecutionHost
	endpoint, token, sessionID string
	size                       int
	release                    func()
	closeOnce                  sync.Once
	closeErr                   error
}

func (session *faceSwapSessionHost) ReplaceFrame(ctx context.Context, frame []byte) ([]byte, error) {
	if len(frame) != session.size {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, session.endpoint+"/v1/video/session/frame", bytes.NewReader(frame))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("x-nimi-face-swap-token", session.token)
	request.Header.Set("x-nimi-face-swap-session", session.sessionID)
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		if ctx.Err() == nil {
			session.host.manager.logger.Warn("video frame Worker transport failed", "engine", engineFaceSwapExecutionHost, "error", err)
		}
		return nil, executionFailure(localexecution.FailureProcessCrash, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, faceSwapSessionResponseError(response.Body)
	}
	result, err := io.ReadAll(io.LimitReader(response.Body, int64(session.size+1)))
	if err != nil {
		return nil, err
	}
	if len(result) != session.size {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return result, nil
}

func (session *faceSwapSessionHost) Close() error {
	session.closeOnce.Do(func() { session.closeErr = session.host.stop(); session.release() })
	return session.closeErr
}

func faceSwapSessionResponseError(body io.Reader) error {
	var failure struct {
		Reason string `json:"reason_code"`
		Detail string `json:"detail"`
	}
	if err := json.NewDecoder(io.LimitReader(body, 16384)).Decode(&failure); err != nil {
		return grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, fmt.Errorf("video Worker failure response: %w", err), grpcerr.ReasonOptions{})
	}
	return grpcerr.WithReasonCodeOptions(codes.Internal, faceSwapWorkerReason(failure.Reason), grpcerr.ReasonOptions{Message: failure.Detail})
}
