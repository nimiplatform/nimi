package engine

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestUpscaleImageDimensionsAndCompletePNGValidation(t *testing.T) {
	var encoded bytes.Buffer
	source := image.NewRGBA(image.Rect(0, 0, 32, 16))
	source.Set(0, 0, color.RGBA{R: 255, A: 255})
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	width, height, err := upscaleImageDimensions(encoded.Bytes(), 4)
	if err != nil || width != 128 || height != 64 {
		t.Fatal(width, height, err)
	}
	file := filepath.Join(t.TempDir(), "output.png")
	if err := os.WriteFile(file, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateUpscaledPNG(file, width, height); err == nil {
		t.Fatal("unchanged source dimensions accepted as a 4x result")
	}
	if err := os.WriteFile(file, encoded.Bytes()[:encoded.Len()-8], 0o600); err != nil {
		t.Fatal(err)
	}
	if err := validateUpscaledPNG(file, 32, 16); err == nil {
		t.Fatal("truncated output accepted from its valid header")
	}
}

func TestUpscaleCommandCancellationStopsChild(t *testing.T) {
	if os.Getenv("NIMI_TEST_UPSCALE_CHILD") == "1" {
		time.Sleep(900 * time.Millisecond)
		_ = os.WriteFile(os.Getenv("NIMI_TEST_UPSCALE_MARKER"), []byte("late"), 0o600)
		os.Exit(0)
	}
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	marker := filepath.Join(t.TempDir(), "late-output")
	ctx, cancel := context.WithCancel(context.Background())
	time.AfterFunc(100*time.Millisecond, cancel)
	_, err = runUpscaleCommand(ctx, "", map[string]string{"NIMI_TEST_UPSCALE_CHILD": "1", "NIMI_TEST_UPSCALE_MARKER": marker}, executable, "-test.run=^TestUpscaleCommandCancellationStopsChild$")
	if !errors.Is(err, context.Canceled) {
		t.Fatal("native command did not return cancellation", err)
	}
	time.Sleep(950 * time.Millisecond)
	if _, err := os.Stat(marker); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("canceled child wrote late output", err)
	}
}

func TestUpscaleInspectRealNimiTimeline(t *testing.T) {
	probe := os.Getenv("NIMI_UPSCALE_TEST_FFPROBE")
	source := os.Getenv("NIMI_UPSCALE_TEST_SOURCE")
	if probe == "" || source == "" {
		t.Skip("set the managed ffprobe and an actual Nimi H3 MP4 to run this codec regression")
	}
	facts, err := inspectUpscaleVideo(context.Background(), probe, source, 2)
	if err != nil {
		t.Fatal(err)
	}
	if facts.Frames != 22 || facts.FPS != 24 || !facts.Audio || len(facts.Timestamps) != 22 || facts.Durations[0] < 0.07 || facts.Durations[0] > 0.08 {
		t.Fatalf("actual Nimi AAC-primed timeline was changed or rejected: %+v", facts)
	}
}
