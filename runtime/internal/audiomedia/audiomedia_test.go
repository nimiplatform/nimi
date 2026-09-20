package audiomedia

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"
)

func writeTestWAV(t *testing.T, samples []float32, channels uint16) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "source.wav")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := writeHeader(file, 44100, channels, int64(len(samples)*4)); err != nil {
		t.Fatal(err)
	}
	if _, err := file.Seek(pcmHeaderBytes, io.SeekStart); err != nil {
		t.Fatal(err)
	}
	if err := binary.Write(file, binary.LittleEndian, samples); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestCanonicalFactsUseActualCompleteFrames(t *testing.T) {
	path := writeTestWAV(t, []float32{0, float32(math.Copysign(0, -1)), 1.25, -1.25}, 2)
	facts, err := InspectCanonical(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	if facts.FrameCount != 2 || facts.Channels != 2 || facts.SampleRateHz != 44100 || facts.DataOffset != pcmHeaderBytes || facts.SizeBytes != pcmHeaderBytes+16 {
		t.Fatalf("unexpected observed facts: %+v", facts)
	}
}

func TestCanonicalRejectsCorruptContainerAndSamples(t *testing.T) {
	for _, test := range []struct {
		name   string
		mutate func([]byte) []byte
	}{
		{"truncated", func(data []byte) []byte { return data[:len(data)-1] }},
		{"nan", func(data []byte) []byte {
			binary.LittleEndian.PutUint32(data[pcmHeaderBytes:], 0x7fc00000)
			return data
		}},
		{"infinity", func(data []byte) []byte {
			binary.LittleEndian.PutUint32(data[pcmHeaderBytes:], 0xff800000)
			return data
		}},
		{"false-frame-count", func(data []byte) []byte { binary.LittleEndian.PutUint32(data[46:50], 12); return data }},
		{"false-byte-rate", func(data []byte) []byte { binary.LittleEndian.PutUint32(data[28:32], 1); return data }},
		{"unsupported-channels", func(data []byte) []byte { binary.LittleEndian.PutUint16(data[22:24], 3); return data }},
	} {
		t.Run(test.name, func(t *testing.T) {
			path := writeTestWAV(t, []float32{0.1, 0.2, 0.3, 0.4}, 2)
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, test.mutate(data), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := InspectCanonical(context.Background(), path); err == nil {
				t.Fatal("invalid PCM was admitted")
			}
		})
	}
}

func TestStreamingPCMRejectsPartialSampleBoundAndCancellation(t *testing.T) {
	for _, test := range []struct {
		name string
		data []byte
		max  int64
	}{
		{"partial", []byte{0, 0, 0}, 32},
		{"excess", make([]byte, 8), 4},
	} {
		t.Run(test.name, func(t *testing.T) {
			if _, err := copyFinitePCM(context.Background(), io.Discard, bytes.NewReader(test.data), test.max); err == nil {
				t.Fatal("invalid decoded payload was admitted")
			}
		})
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := copyFinitePCM(ctx, io.Discard, bytes.NewReader(make([]byte, 8)), 8); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected canceled, got %v", err)
	}
}

func TestPrepareCanonicalCopiesExactBytes(t *testing.T) {
	// This branch never executes a codec; executable identity validation remains
	// separate from the integration test that runs the managed FFmpeg binary.
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	processor, err := New(executable, executable)
	if err != nil {
		t.Fatal(err)
	}
	path := writeTestWAV(t, []float32{0, float32(math.Copysign(0, -1)), 1.25, -1.25}, 2)
	result, err := processor.Prepare(context.Background(), Input{Path: path, MIMEType: "audio/wav"}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(result.Path)
	if err != nil || !bytes.Equal(want, got) {
		t.Fatalf("existing canonical bytes changed: %v", err)
	}
	if _, err := processor.Prepare(context.Background(), Input{Path: path, MIMEType: "audio/mpeg"}, t.TempDir()); err == nil {
		t.Fatal("mismatched MIME was admitted")
	}
}

// TestPrepareIntegration requires an actual supplied recording and managed
// codec paths. A skip never establishes engine or protected App acceptance.
func TestPrepareIntegration(t *testing.T) {
	ffmpeg, ffprobe, source := os.Getenv("NIMI_AUDIO_TEST_FFMPEG"), os.Getenv("NIMI_AUDIO_TEST_FFPROBE"), os.Getenv("NIMI_AUDIO_TEST_SOURCE")
	if ffmpeg == "" || ffprobe == "" || source == "" {
		t.Skip("real recording and managed codec paths were not supplied")
	}
	processor, err := New(ffmpeg, ffprobe)
	if err != nil {
		t.Fatal(err)
	}
	directory := os.Getenv("NIMI_AUDIO_TEST_OUTPUT")
	if directory == "" {
		directory = t.TempDir()
	} else if err := os.MkdirAll(directory, 0700); err != nil {
		t.Fatal(err)
	}
	prepared, err := processor.Prepare(context.Background(), Input{Path: source, MIMEType: "audio/mpeg"}, directory)
	if err != nil {
		t.Fatal(err)
	}
	if prepared.Facts.FrameCount == 0 {
		t.Fatal("real recording has no observed frames")
	}
	t.Logf("real canonical source: path=%s rate=%d channels=%d frames=%d durationMs=%d bytes=%d", prepared.Path, prepared.Facts.SampleRateHz, prepared.Facts.Channels, prepared.Facts.FrameCount, prepared.Facts.DurationMilliseconds(), prepared.Facts.SizeBytes)
	targetRate := uint32(48000)
	if prepared.Facts.SampleRateHz == targetRate {
		targetRate = 44100
	}
	converted, err := processor.Prepare(context.Background(), Input{Path: prepared.Path, MIMEType: "audio/wav", TargetSampleRateHz: targetRate}, directory)
	if err != nil {
		t.Fatal(err)
	}
	delta := int64(converted.Facts.DurationMilliseconds()) - int64(prepared.Facts.DurationMilliseconds())
	if converted.Facts.SampleRateHz != targetRate || converted.Facts.Channels != prepared.Facts.Channels || delta < -1 || delta > 1 {
		t.Fatalf("explicit resampling changed the timeline: %+v vs %+v", converted.Facts, prepared.Facts)
	}
	t.Logf("real explicit resampled source: path=%s rate=%d frames=%d durationMs=%d", converted.Path, targetRate, converted.Facts.FrameCount, converted.Facts.DurationMilliseconds())
}
