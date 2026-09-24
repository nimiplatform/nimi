package audiomedia

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const PreparationTimeout = 60 * time.Second

var ErrCodecUnavailable = errors.New("exact managed audio codec is unavailable")

// ChannelMode is the explicit channel-domain conversion requested for an
// already canonical source. It is never applied implicitly.
type ChannelMode uint32

const (
	ChannelUnspecified  ChannelMode = 0
	ChannelPreserve     ChannelMode = 1
	ChannelMonoToStereo ChannelMode = 2
	ChannelStereoToMono ChannelMode = 3
)

// Processor receives exact managed codec executables from Runtime composition.
// It never resolves programs from PATH or downloads an input or dependency.
type Processor struct {
	ffmpeg, ffprobe string
}

type Input struct {
	// Path is a Runtime-owned immutable snapshot, never a public App path.
	Path               string
	MIMEType           string
	TargetSampleRateHz uint32
	// ChannelMode requests an explicit channel-domain conversion. Preserve (or
	// Unspecified) keeps the source channel count unchanged.
	ChannelMode ChannelMode
}

// Prepared is an unpublished, complete staging object. The caller commits it
// through artifact custody and removes this owned file after consuming it.
type Prepared struct {
	Path  string
	Facts Facts
}

func New(ffmpeg, ffprobe string) (*Processor, error) {
	for _, path := range []string{ffmpeg, ffprobe} {
		if !filepath.IsAbs(path) {
			return nil, fmt.Errorf("codec executable path must be absolute")
		}
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() {
			return nil, ErrCodecUnavailable
		}
	}
	return &Processor{ffmpeg: ffmpeg, ffprobe: ffprobe}, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.canonical-audio-preparation
func (p *Processor) Prepare(ctx context.Context, input Input, stagingDirectory string) (result Prepared, err error) {
	if p == nil || p.ffmpeg == "" || p.ffprobe == "" {
		return Prepared{}, ErrCodecUnavailable
	}
	ctx, cancel := context.WithTimeout(ctx, PreparationTimeout)
	defer cancel()
	if err := ctx.Err(); err != nil {
		return Prepared{}, err
	}
	if !filepath.IsAbs(input.Path) || !filepath.IsAbs(stagingDirectory) {
		return Prepared{}, fmt.Errorf("audio snapshot and staging paths must be absolute")
	}
	info, err := os.Stat(input.Path)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 || info.Size() > MaxInputBytes {
		return Prepared{}, fmt.Errorf("audio snapshot size or type is invalid")
	}
	mime := strings.ToLower(strings.TrimSpace(input.MIMEType))
	expectedFormat := map[string]string{"audio/wav": "wav", "audio/mpeg": "mp3", "audio/flac": "flac"}[mime]
	channelMode := input.ChannelMode
	if channelMode == ChannelUnspecified {
		channelMode = ChannelPreserve
	}
	if expectedFormat == "" || (input.TargetSampleRateHz != 0 && !validFormat(input.TargetSampleRateHz, 1)) ||
		(channelMode != ChannelPreserve && channelMode != ChannelMonoToStereo && channelMode != ChannelStereoToMono) {
		return Prepared{}, fmt.Errorf("unsupported audio input format, target sample rate or channel mode")
	}
	canonical, canonicalErr := InspectCanonical(ctx, input.Path)
	if ctx.Err() != nil {
		return Prepared{}, ctx.Err()
	}
	if canonicalErr == nil && mime != "audio/wav" {
		return Prepared{}, fmt.Errorf("audio MIME does not match the actual container")
	}
	if (input.TargetSampleRateHz != 0 || channelMode != ChannelPreserve) && canonicalErr != nil {
		return Prepared{}, fmt.Errorf("explicit domain conversion requires an already canonical source")
	}
	output, err := os.CreateTemp(stagingDirectory, "canonical-audio-*.wav")
	if err != nil {
		return Prepared{}, fmt.Errorf("create canonical audio staging: %w", err)
	}
	defer func() {
		_ = output.Close()
		if err != nil {
			_ = os.Remove(output.Name())
		}
	}()
	if canonicalErr == nil && channelMode == ChannelPreserve && (input.TargetSampleRateHz == 0 || input.TargetSampleRateHz == canonical.SampleRateHz) {
		source, openErr := os.Open(input.Path)
		if openErr != nil {
			return Prepared{}, fmt.Errorf("open canonical snapshot: %w", openErr)
		}
		defer func() { _ = source.Close() }()
		count, copyErr := io.CopyBuffer(output, &contextReader{ctx: ctx, reader: io.LimitReader(source, MaxInputBytes+1)}, make([]byte, bufferBytes))
		if copyErr != nil {
			return Prepared{}, fmt.Errorf("copy canonical snapshot: %w", copyErr)
		}
		if count != canonical.SizeBytes {
			return Prepared{}, fmt.Errorf("copy canonical snapshot: copied %d of %d bytes", count, canonical.SizeBytes)
		}
	} else {
		rate, channels, probeErr := p.probe(ctx, input.Path, expectedFormat)
		if probeErr != nil {
			return Prepared{}, probeErr
		}
		if input.TargetSampleRateHz != 0 {
			rate = input.TargetSampleRateHz
		}
		outChannels := channels
		switch channelMode {
		case ChannelPreserve:
		case ChannelMonoToStereo:
			if channels != 1 {
				return Prepared{}, fmt.Errorf("mono-to-stereo conversion requires a mono source")
			}
			outChannels = 2
		case ChannelStereoToMono:
			if channels != 2 {
				return Prepared{}, fmt.Errorf("stereo-to-mono conversion requires a stereo source")
			}
			outChannels = 1
		}
		if _, err = output.Write(make([]byte, pcmHeaderBytes)); err != nil {
			return Prepared{}, fmt.Errorf("reserve WAV header: %w", err)
		}
		args := decodeArguments(input.Path, input.TargetSampleRateHz, channelMode)
		decodeCtx, stopDecode := context.WithCancel(ctx)
		defer stopDecode()
		command := exec.CommandContext(decodeCtx, p.ffmpeg, args...)
		configureCodecCommand(command)
		command.WaitDelay = 3 * time.Second
		diagnostic := &boundedBuffer{limit: 32 << 10}
		command.Stderr = diagnostic
		stdout, pipeErr := command.StdoutPipe()
		if pipeErr != nil {
			return Prepared{}, fmt.Errorf("open codec output: %w", pipeErr)
		}
		if err := command.Start(); err != nil {
			_ = stdout.Close()
			return Prepared{}, fmt.Errorf("start managed audio decoder: %w", err)
		}
		limit := int64(rate) * int64(outChannels) * 4 * MaxSeconds
		count, copyErr := copyFinitePCM(decodeCtx, output, stdout, limit)
		if copyErr != nil {
			stopDecode()
			_ = stdout.Close()
		}
		waitErr := command.Wait()
		if ctx.Err() != nil {
			return Prepared{}, ctx.Err()
		}
		if copyErr != nil {
			return Prepared{}, copyErr
		}
		if waitErr != nil {
			return Prepared{}, fmt.Errorf("managed audio decoder failed: %w", waitErr)
		}
		if count == 0 || count%int64(outChannels*4) != 0 {
			return Prepared{}, fmt.Errorf("decoder returned empty audio or incomplete frames")
		}
		if err := writeHeader(output, rate, outChannels, count); err != nil {
			return Prepared{}, fmt.Errorf("finish canonical WAV header: %w", err)
		}
	}
	if err := output.Sync(); err != nil {
		return Prepared{}, fmt.Errorf("sync canonical audio: %w", err)
	}
	if err := output.Close(); err != nil {
		return Prepared{}, fmt.Errorf("close canonical audio: %w", err)
	}
	facts, err := InspectCanonical(ctx, output.Name())
	if err != nil {
		return Prepared{}, fmt.Errorf("inspect complete canonical audio: %w", err)
	}
	if ctx.Err() != nil {
		return Prepared{}, ctx.Err()
	}
	return Prepared{Path: output.Name(), Facts: facts}, nil
}

// decodeArguments maps a requested channel conversion to an explicit pan
// matrix. The codec's implicit -ac rematrix applies equal-power gains (each
// mono-to-stereo channel at about -3 dB, stereo-to-mono as 0.707*(L+R)), which
// is not the admitted duplicate or average conversion.
func decodeArguments(path string, targetRateHz uint32, mode ChannelMode) []string {
	args := []string{"-nostdin", "-v", "error", "-xerror", "-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,flac", "-i", path, "-map", "0:a:0", "-vn", "-sn", "-dn"}
	if targetRateHz != 0 {
		args = append(args, "-ar", strconv.FormatUint(uint64(targetRateHz), 10))
	}
	switch mode {
	case ChannelMonoToStereo:
		args = append(args, "-af", "pan=stereo|c0=c0|c1=c0")
	case ChannelStereoToMono:
		args = append(args, "-af", "pan=mono|c0=0.5*c0+0.5*c1")
	}
	return append(args, "-c:a", "pcm_f32le", "-f", "f32le", "pipe:1")
}

func (p *Processor) probe(ctx context.Context, path, expectedFormat string) (uint32, uint16, error) {
	for _, executable := range []string{p.ffmpeg, p.ffprobe} {
		info, err := os.Stat(executable)
		if err != nil || !info.Mode().IsRegular() {
			return 0, 0, ErrCodecUnavailable
		}
	}
	command := exec.CommandContext(ctx, p.ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "wav,mp3,flac", "-show_entries", "format=format_name:stream=codec_type,sample_rate,channels", "-of", "json", "-i", path)
	configureCodecCommand(command)
	command.WaitDelay = 3 * time.Second
	output, diagnostic := &boundedBuffer{limit: 64 << 10}, &boundedBuffer{limit: 32 << 10}
	command.Stdout, command.Stderr = output, diagnostic
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return 0, 0, ctx.Err()
		}
		return 0, 0, fmt.Errorf("probe audio snapshot: %w", err)
	}
	var document struct {
		Streams []struct {
			CodecType  string `json:"codec_type"`
			SampleRate string `json:"sample_rate"`
			Channels   uint16 `json:"channels"`
		} `json:"streams"`
		Format struct {
			Name string `json:"format_name"`
		} `json:"format"`
	}
	if output.overflow || json.Unmarshal(output.Bytes(), &document) != nil || document.Format.Name != expectedFormat {
		return 0, 0, fmt.Errorf("invalid probe result or mismatched audio container")
	}
	var rate uint32
	var channels uint16
	count := 0
	for _, stream := range document.Streams {
		if stream.CodecType != "audio" {
			continue
		}
		count++
		value, err := strconv.ParseUint(stream.SampleRate, 10, 32)
		if err != nil || !validFormat(uint32(value), stream.Channels) {
			return 0, 0, fmt.Errorf("audio sample format is outside the canonical profile")
		}
		rate, channels = uint32(value), stream.Channels
	}
	if count != 1 {
		return 0, 0, fmt.Errorf("audio input must contain exactly one audio stream")
	}
	return rate, channels, nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(data []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(data)
}

type boundedBuffer struct {
	bytes.Buffer
	limit    int
	overflow bool
}

func (b *boundedBuffer) Write(data []byte) (int, error) {
	n := len(data)
	remaining := b.limit - b.Len()
	if len(data) > remaining {
		data = data[:remaining]
		b.overflow = true
	}
	_, _ = b.Buffer.Write(data)
	return n, nil
}
