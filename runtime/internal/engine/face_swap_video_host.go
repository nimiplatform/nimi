package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.local-compute.face-swap-video-driver
func (host *FaceSwapExecutionHost) AdmitVideoFaceSwap(plan *capabilitydriver.VideoFaceSwapInvocationPlan) error {
	if plan == nil || len(plan.TargetVideo) == 0 || len(plan.TargetVideo) > localexecution.MaxFaceSwapVideoBytes || (plan.NoFacePolicy != "fail" && plan.NoFacePolicy != "preserve_frame") {
		return fmt.Errorf("video face replacement requires bounded captured inputs")
	}
	if _, _, err := localexecution.FaceSwapImageSize(plan.ReferenceImage); err != nil {
		return err
	}
	if err := host.admitModels(plan.Models); err != nil {
		return err
	}
	_, err := host.videoWorkRoot()
	return err
}

func (host *FaceSwapExecutionHost) videoWorkRoot() (string, error) {
	if host == nil || host.manager == nil {
		return "", fmt.Errorf("face replacement manager is unavailable")
	}
	host.manager.mu.RLock()
	root := host.manager.runtimeWorkRoot
	host.manager.mu.RUnlock()
	if !filepath.IsAbs(root) {
		return "", fmt.Errorf("video face replacement requires a Runtime-owned work root")
	}
	return filepath.Join(root, "face-swap"), nil
}

func (host *FaceSwapExecutionHost) ExecuteVideoFaceSwap(ctx context.Context, plan *capabilitydriver.VideoFaceSwapInvocationPlan, onStart func() error, progress func(int32, int32)) (*localexecution.VideoFaceSwapArtifact, error) {
	if err := host.AdmitVideoFaceSwap(plan); err != nil {
		return nil, executionFailure(localexecution.FailureLoad, err)
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	if host.poisoned != nil {
		return nil, executionFailure(localexecution.FailureProcessCrash, host.poisoned)
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if onStart != nil {
		if err := onStart(); err != nil {
			return nil, err
		}
	}
	if _, err := sealInvocationModelContentContext(ctx, plan.Models.Bindings); err != nil {
		return nil, err
	}
	if err := host.start(ctx, plan.Models); err != nil {
		return nil, host.fail(ctx, executionFailure(localexecution.FailureLoad, err))
	}
	root, err := host.videoWorkRoot()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	work, err := os.MkdirTemp(root, "job-")
	if err != nil {
		return nil, err
	}
	retained := false
	defer func() {
		if !retained {
			_ = os.RemoveAll(work)
		}
	}()
	input, output := filepath.Join(work, "input.mp4"), filepath.Join(work, "output.mp4")
	if err := os.WriteFile(input, plan.TargetVideo, 0o600); err != nil {
		return nil, err
	}
	bindings := map[string]string{}
	for _, binding := range plan.Models.Bindings {
		bindings[binding.RequirementID] = binding.AbsolutePath
	}
	body, err := json.Marshal(struct {
		Reference    []byte            `json:"reference"`
		VideoPath    string            `json:"video_path"`
		OutputPath   string            `json:"output_path"`
		Bindings     map[string]string `json:"bindings"`
		NoFacePolicy string            `json:"no_face_policy"`
	}{plan.ReferenceImage, input, output, bindings, plan.NoFacePolicy})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, host.endpoint+"/v1/video/face-swap", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("x-nimi-face-swap-token", host.token)
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		return nil, host.fail(ctx, executionFailure(localexecution.FailureProcessCrash, err))
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, host.fail(ctx, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	decoder := json.NewDecoder(io.LimitReader(response.Body, 128*1024))
	decoder.DisallowUnknownFields()
	var result *localexecution.VideoFaceSwapArtifact
	for {
		var event struct {
			Type        string `json:"type"`
			Done, Total int32
			Reason      string `json:"reason_code"`
			Detail      string `json:"detail"`
			Summary     *struct {
				Total           uint32 `json:"frames_total"`
				Transformed     uint32 `json:"frames_transformed"`
				Preserved       uint32 `json:"frames_preserved"`
				Width           uint32 `json:"width"`
				Height          uint32 `json:"height"`
				DurationUS      uint64 `json:"duration_us"`
				RateNumerator   uint32 `json:"frame_rate_numerator"`
				RateDenominator uint32 `json:"frame_rate_denominator"`
				AudioPreserved  bool   `json:"audio_preserved"`
			} `json:"summary"`
		}
		if err := decoder.Decode(&event); err == io.EOF {
			break
		} else if err != nil {
			return nil, host.fail(ctx, err)
		}
		if result != nil {
			return nil, host.fail(ctx, fmt.Errorf("video Worker sent events after completion"))
		}
		switch event.Type {
		case "progress":
			if event.Done < 0 || event.Done > event.Total || event.Total <= 0 || event.Total > 9000 {
				return nil, host.fail(ctx, fmt.Errorf("invalid video progress"))
			}
			if progress != nil {
				progress(event.Done, event.Total)
			}
		case "failed":
			return nil, host.fail(ctx, grpcerr.WithReasonCodeOptions(codes.Internal, faceSwapWorkerReason(event.Reason), grpcerr.ReasonOptions{Message: event.Detail}))
		case "completed":
			v := event.Summary
			if v == nil || v.Width == 0 || v.Height == 0 || v.Width > 1920 || v.Height > 1920 || uint64(v.Width)*uint64(v.Height) > 1920*1080 || v.Width%2 != 0 || v.Height%2 != 0 || v.RateDenominator != 1 || (plan.NoFacePolicy == "fail" && v.Preserved != 0) {
				return nil, host.fail(ctx, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
			}
			summary := &runtimev1.VideoFaceSwapSummary{TotalFrames: v.Total, TransformedFrames: v.Transformed, PreservedFrames: v.Preserved, DurationUs: v.DurationUS, FrameRate: v.RateNumerator, AudioPreserved: v.AudioPreserved}
			if err := localexecution.ValidateVideoFaceSwapSummary(summary); err != nil {
				return nil, host.fail(ctx, grpcerr.WrapWithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID, err, grpcerr.ReasonOptions{}))
			}
			result = &localexecution.VideoFaceSwapArtifact{Width: v.Width, Height: v.Height, Summary: summary}
		default:
			return nil, host.fail(ctx, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, host.fail(ctx, err)
	}
	if result == nil {
		return nil, host.fail(ctx, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID))
	}
	file, err := os.Open(output)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > localexecution.MaxFaceSwapVideoOutputBytes {
		_ = file.Close()
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	result.SizeBytes = info.Size()
	result.Body = &faceSwapVideoBody{File: file, work: work}
	retained = true
	return result, nil
}

type faceSwapVideoBody struct {
	*os.File
	work string
}

func (body *faceSwapVideoBody) Close() error {
	err := body.File.Close()
	removeErr := os.RemoveAll(body.work)
	if err != nil {
		return err
	}
	return removeErr
}
