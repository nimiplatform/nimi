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

func TestCopyCanonicalRangePreservesBitsAndProtectsDestination(t *testing.T) {
	sourcePath := writeTestWAV(t, []float32{0.5, -0.5, float32(math.Copysign(0, -1)), 1.25, -1.25, 0.125, 0.75, -0.75}, 2)
	facts, err := InspectCanonical(context.Background(), sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	destination := filepath.Join(t.TempDir(), "selection.wav")
	got, err := CopyCanonicalRange(context.Background(), source, facts, 1, 3, destination)
	if err != nil {
		t.Fatal(err)
	}
	checked, err := InspectCanonical(context.Background(), destination)
	if err != nil || checked != got || got.FrameCount != 2 {
		t.Fatalf("invalid selection facts: %+v %v", got, err)
	}
	before, err := os.ReadFile(destination)
	if err != nil {
		t.Fatal(err)
	}
	original, err := os.ReadFile(sourcePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(before[got.DataOffset:], original[facts.DataOffset+8:facts.DataOffset+24]) {
		t.Fatal("selected PCM bits changed")
	}
	if _, err := CopyCanonicalRange(context.Background(), source, facts, 0, 4, destination); err == nil {
		t.Fatal("overwrote an existing selection")
	}
	after, err := os.ReadFile(destination)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatal("existing destination changed")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	canceled := filepath.Join(t.TempDir(), "canceled.wav")
	if _, err := CopyCanonicalRange(ctx, source, facts, 0, 2, canceled); !errors.Is(err, context.Canceled) {
		t.Fatalf("expected cancellation: %v", err)
	}
	if _, err := os.Stat(canceled); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("canceled operation left an output")
	}
	truncated := filepath.Join(t.TempDir(), "truncated.wav")
	if _, err := CopyCanonicalRange(context.Background(), bytes.NewReader(original[:len(original)-8]), facts, 0, 4, truncated); err == nil {
		t.Fatal("accepted truncated source")
	}
	if _, err := os.Stat(truncated); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("failed operation left an output")
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

func TestDecodeArgumentsUseExplicitChannelMatrix(t *testing.T) {
	index := func(args []string, value string) int {
		for i, arg := range args {
			if arg == value {
				return i
			}
		}
		return -1
	}
	for _, test := range []struct {
		mode ChannelMode
		pan  string
	}{{ChannelMonoToStereo, "pan=stereo|c0=c0|c1=c0"}, {ChannelStereoToMono, "pan=mono|c0=0.5*c0+0.5*c1"}, {ChannelPreserve, ""}} {
		args := decodeArguments("source.wav", 44100, test.mode)
		if index(args, "-ac") >= 0 {
			t.Fatalf("mode %d uses the implicit equal-power rematrix: %v", test.mode, args)
		}
		filter := index(args, "-af")
		if test.pan == "" {
			if filter >= 0 {
				t.Fatalf("preserve mode added a channel filter: %v", args)
			}
		} else if filter < 0 || args[filter+1] != test.pan {
			t.Fatalf("mode %d channel matrix = %v, want %s", test.mode, args, test.pan)
		}
		if rate := index(args, "-ar"); rate < 0 || args[rate+1] != "44100" {
			t.Fatalf("explicit target rate was dropped: %v", args)
		}
	}
}

func writeRateTestWAV(t *testing.T, name string, rate uint32, channels uint16, samples []float32) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), name)
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := writeHeader(file, rate, channels, int64(len(samples)*4)); err != nil {
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

func readTestPCM(t *testing.T, path string) (Facts, []float32) {
	t.Helper()
	facts, err := InspectCanonical(context.Background(), path)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	samples := make([]float32, facts.FrameCount*uint64(facts.Channels))
	if err := binary.Read(bytes.NewReader(data[facts.DataOffset:]), binary.LittleEndian, samples); err != nil {
		t.Fatal(err)
	}
	return facts, samples
}

// TestPrepareChannelConversionIntegration runs the supplied managed codec on
// synthetic canonical sources; a skip never establishes the conversion.
func TestPrepareChannelConversionIntegration(t *testing.T) {
	ffmpeg, ffprobe := os.Getenv("NIMI_AUDIO_TEST_FFMPEG"), os.Getenv("NIMI_AUDIO_TEST_FFPROBE")
	if ffmpeg == "" || ffprobe == "" {
		t.Skip("managed codec paths were not supplied")
	}
	processor, err := New(ffmpeg, ffprobe)
	if err != nil {
		t.Fatal(err)
	}
	mono := make([]float32, 24000)
	for i := range mono {
		mono[i] = float32(0.5 * math.Sin(2*math.Pi*440*float64(i)/24000))
	}
	monoPath := writeRateTestWAV(t, "mono.wav", 24000, 1, mono)
	duplicated, err := processor.Prepare(context.Background(), Input{Path: monoPath, MIMEType: "audio/wav", ChannelMode: ChannelMonoToStereo}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	facts, stereo := readTestPCM(t, duplicated.Path)
	if facts.Channels != 2 || facts.SampleRateHz != 24000 || facts.FrameCount != uint64(len(mono)) {
		t.Fatalf("mono-to-stereo facts = %+v", facts)
	}
	for i, sample := range mono {
		if stereo[2*i] != sample || stereo[2*i+1] != sample {
			t.Fatalf("frame %d is not an exact duplicate: %v %v want %v", i, stereo[2*i], stereo[2*i+1], sample)
		}
	}
	resampled, err := processor.Prepare(context.Background(), Input{Path: monoPath, MIMEType: "audio/wav", TargetSampleRateHz: 44100}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	upmixed, err := processor.Prepare(context.Background(), Input{Path: monoPath, MIMEType: "audio/wav", TargetSampleRateHz: 44100, ChannelMode: ChannelMonoToStereo}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	resampledFacts, resampledMono := readTestPCM(t, resampled.Path)
	upmixedFacts, upmixedStereo := readTestPCM(t, upmixed.Path)
	if upmixedFacts.Channels != 2 || upmixedFacts.SampleRateHz != 44100 || upmixedFacts.FrameCount != resampledFacts.FrameCount {
		t.Fatalf("resampled upmix facts = %+v vs %+v", upmixedFacts, resampledFacts)
	}
	for i, sample := range resampledMono {
		if upmixedStereo[2*i] != sample || upmixedStereo[2*i+1] != sample {
			t.Fatalf("resampled frame %d changed gain: %v %v want %v", i, upmixedStereo[2*i], upmixedStereo[2*i+1], sample)
		}
	}
	pair := make([]float32, 2*44100)
	for i := 0; i < 44100; i++ {
		pair[2*i] = float32(0.4 * math.Sin(2*math.Pi*440*float64(i)/44100))
		pair[2*i+1] = float32(0.2 * math.Sin(2*math.Pi*330*float64(i)/44100))
	}
	averaged, err := processor.Prepare(context.Background(), Input{Path: writeRateTestWAV(t, "stereo.wav", 44100, 2, pair), MIMEType: "audio/wav", ChannelMode: ChannelStereoToMono}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	averageFacts, average := readTestPCM(t, averaged.Path)
	if averageFacts.Channels != 1 || averageFacts.FrameCount != 44100 {
		t.Fatalf("stereo-to-mono facts = %+v", averageFacts)
	}
	for i, sample := range average {
		if want := (pair[2*i] + pair[2*i+1]) / 2; math.Abs(float64(sample-want)) > 1e-6 {
			t.Fatalf("frame %d = %v, want average %v", i, sample, want)
		}
	}
}
