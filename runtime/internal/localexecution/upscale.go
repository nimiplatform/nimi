package localexecution

import (
	"context"
	"io"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

const MaxUpscaleInputBytes = 32 << 20
const MaxUpscaleOutputBytes = 512 << 20

type UpscaleArtifact struct {
	Body          io.ReadCloser
	SizeBytes     int64
	MIMEType      string
	Width, Height uint32
	FPS           uint32
	DurationMS    int64
}

type UpscaleExecutionHost interface {
	AdmitUpscale(*capabilitydriver.UpscaleInvocationPlan) error
	ExecuteUpscale(context.Context, *capabilitydriver.UpscaleInvocationPlan, func() error) (*UpscaleArtifact, error)
}
