package localexecution

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"io"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const MaxFaceSwapImageBytes = 32 * 1024 * 1024
const MaxFaceSwapImageDimension = 4096

type FaceSwapExecutionHost interface {
	AdmitImageFaceSwap(*capabilitydriver.ImageFaceSwapInvocationPlan) error
	ExecuteImageFaceSwap(context.Context, *capabilitydriver.ImageFaceSwapInvocationPlan, func() error) (ImageArtifact, error)
	AdmitVideoFaceSwap(*capabilitydriver.VideoFaceSwapInvocationPlan) error
	ExecuteVideoFaceSwap(context.Context, *capabilitydriver.VideoFaceSwapInvocationPlan, func() error, func(int32, int32)) (*VideoFaceSwapArtifact, error)
	OpenVideoFaceSwapSession(context.Context, capabilitydriver.FaceSwapModelPlan, []byte, string, uint32, uint32) (VideoFaceSwapSession, error)
}

type VideoFaceSwapSession interface {
	ReplaceFrame(context.Context, []byte) ([]byte, error)
	Close() error
}

const MaxFaceSwapVideoBytes = 32 * 1024 * 1024
const MaxFaceSwapVideoOutputBytes = 512 * 1024 * 1024

type VideoFaceSwapArtifact struct {
	Body          io.ReadCloser
	SizeBytes     int64
	Width, Height uint32
	Summary       *runtimev1.VideoFaceSwapSummary
}

func ValidateVideoFaceSwapSummary(summary *runtimev1.VideoFaceSwapSummary) error {
	if summary == nil || summary.TotalFrames == 0 || summary.TotalFrames > 9000 || summary.TransformedFrames > summary.TotalFrames || summary.PreservedFrames > summary.TotalFrames || summary.TransformedFrames+summary.PreservedFrames != summary.TotalFrames || summary.DurationUs == 0 || summary.DurationUs > 300000000 || (summary.FrameRate != 24 && summary.FrameRate != 25 && summary.FrameRate != 30) {
		return fmt.Errorf("video face replacement summary is invalid")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.face-swap-input
func FaceSwapImageSize(data []byte) (uint32, uint32, error) {
	if len(data) == 0 || len(data) > MaxFaceSwapImageBytes {
		return 0, 0, fmt.Errorf("face replacement image exceeds its byte bound")
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "jpeg" && format != "png") {
		return 0, 0, fmt.Errorf("face replacement requires a decodable JPEG or PNG")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > MaxFaceSwapImageDimension || config.Height > MaxFaceSwapImageDimension {
		return 0, 0, fmt.Errorf("face replacement image exceeds its dimension bound")
	}
	return VisionLocateImageSize(data)
}
