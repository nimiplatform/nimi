//go:build (windows && amd64) || (darwin && arm64 && cgo)

package managedimagebackend

import (
	"context"
	"testing"
)

func TestOpaqueVideoCancellationBeforeNativeStart(t *testing.T) {
	for _, phase := range []string{"options", "native entry"} {
		t.Run(phase, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			engine := &opaqueVideoEngine{ctx: 1, model: VideoModelRequest{RecipeID: "wan22-ti2v-5b", ConditioningMode: "wan22-text"}}
			running, interrupted := false, false
			engine.api = sdVideoAPI{
				videoOpts: func() uintptr { return 1 },
				freeOpts:  func(uintptr) {},
				setString: func(uintptr, string, string) int32 {
					if phase == "options" {
						cancel()
					}
					return 0
				},
				setInt:      func(uintptr, string, int64) int32 { return 0 },
				setFloat:    func(uintptr, string, float64) int32 { return 0 },
				setProgress: func(uintptr, uintptr, uintptr) {},
				cancel: func(uintptr, int32) {
					interrupted = running
				},
				generate: func(uintptr, uintptr, *uintptr) int32 {
					if phase == "options" {
						t.Fatal("entered native inference after cancellation during option setup")
					}
					cancel()
					_ = engine.Cancel() // 1147 ignores this call until native execution starts.
					running = true
					engine.reportProgress(&sdGenerationProgress{}, 0)
					if !interrupted {
						t.Fatal("the first native event missed the pending cancellation")
					}
					return 10
				},
			}
			if _, err := engine.Generate(ctx, VideoGenerateRequest{}, nil); VideoErrorKindOf(err) != VideoErrorCanceled {
				t.Fatalf("early cancellation returned %v", err)
			}
		})
	}
}
