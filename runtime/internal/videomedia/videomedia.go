// Package videomedia owns validation, MP4 encoding/muxing, and final media
// inspection for Runtime-private raw video candidates.
package videomedia

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image/png"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

const (
	MIMETypeMP4 = "video/mp4"
	MIMETypePNG = "image/png"

	FailureUnavailable FailureKind = "unavailable"
	FailureMedia       FailureKind = "media"
	FailureEncode      FailureKind = "encode"
)

// FailureKind identifies the private media phase that failed.
type FailureKind string

// Error is a typed private media failure. It is mapped to a public reason only
// by the ScenarioJob owner.
type Error struct {
	Kind FailureKind
	Op   string
	Err  error
}

func (e *Error) Error() string {
	if e == nil {
		return "video media processing failed"
	}
	if e.Err == nil {
		return e.Op
	}
	if e.Op == "" {
		return e.Err.Error()
	}
	return e.Op + ": " + e.Err.Error()
}

func (e *Error) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Err
}

// FailureKindOf returns the typed private phase, if present.
func FailureKindOf(err error) FailureKind {
	var mediaErr *Error
	if errors.As(err, &mediaErr) {
		return mediaErr.Kind
	}
	return ""
}

// Facts are independently observed from the final MP4 and accompany its bytes
type Facts struct {
	MIMEType   string
	SizeBytes  int64
	SHA256     string
	Width      int
	Height     int
	FPS        int
	FrameCount int
	Duration   time.Duration
	Channels   int
	SampleRate int
}

// StillImage is an inspected image derived from the final video container.
type StillImage struct {
	Bytes      []byte
	MIMEType   string
	SizeBytes  int64
	SHA256     string
	Width      int
	Height     int
	FrameIndex int
}

// Result is the final inspected artifact candidate. LastFrame is populated
// only when the captured invocation requested it.
type Result struct {
	Bytes     []byte
	Facts     Facts
	LastFrame *StillImage
}

// Pipeline is the narrow ScenarioJob-facing encode/mux/inspect seam.
type Pipeline interface {
	EncodeAndInspect(context.Context, *capabilitydriver.VideoInvocationPlan, localexecution.RawAVCandidate) (Result, error)
}

// Processor invokes exact ffmpeg and ffprobe executables supplied by daemon
// composition. It never searches PATH.
type Processor struct {
	ffmpegPath  string
	ffprobePath string
}

// PinnedCodecDependencyDir is the exact media-codec dependency install
// directory expected under the managed dependencies root. It pins
// BtbN/FFmpeg-Builds tag autobuild-2026-08-06-13-39, asset
// ffmpeg-n8.1.2-34-g9b6c8969e0-win64-gpl-8.1.zip
// (sha256 ca516dbc913758d927256bc91050b0d50decd56bf8e4963a1375d666f7fcda05).
const PinnedCodecDependencyDir = "media-codec/ffmpeg-n8.1.2-34-g9b6c8969e0-win64-gpl-8.1/bin"

// NewFromDependenciesRoot resolves the pinned codec executables under the
// managed dependencies root and fails closed when they are absent.
func NewFromDependenciesRoot(dependenciesRoot string) (*Processor, error) {
	root := strings.TrimSpace(dependenciesRoot)
	if root == "" {
		return nil, &Error{Kind: FailureUnavailable, Op: "resolve codec dependency", Err: fmt.Errorf("dependencies root is empty")}
	}
	suffix := ""
	if runtime.GOOS == "windows" {
		suffix = ".exe"
	}
	base := filepath.Join(root, filepath.FromSlash(PinnedCodecDependencyDir))
	return New(filepath.Join(base, "ffmpeg"+suffix), filepath.Join(base, "ffprobe"+suffix))
}

// New validates both executable paths and fails closed when codec tooling is
// unavailable.
func New(ffmpegPath string, ffprobePath string) (*Processor, error) {
	ffmpeg, err := validateExecutablePath("ffmpeg", ffmpegPath)
	if err != nil {
		return nil, err
	}
	ffprobe, err := validateExecutablePath("ffprobe", ffprobePath)
	if err != nil {
		return nil, err
	}
	return &Processor{ffmpegPath: ffmpeg, ffprobePath: ffprobe}, nil
}

func validateExecutablePath(name string, raw string) (string, error) {
	path := strings.TrimSpace(raw)
	if path == "" {
		return "", &Error{Kind: FailureUnavailable, Op: "resolve " + name, Err: fmt.Errorf("executable path is empty")}
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", &Error{Kind: FailureUnavailable, Op: "resolve " + name, Err: err}
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return "", &Error{Kind: FailureUnavailable, Op: "resolve " + name, Err: err}
	}
	if info.IsDir() || !info.Mode().IsRegular() {
		return "", &Error{Kind: FailureUnavailable, Op: "resolve " + name, Err: fmt.Errorf("path is not a regular file")}
	}
	return filepath.Clean(absolute), nil
}

// ValidateCandidate performs all raw candidate checks without invoking a
// process or touching the filesystem.
func ValidateCandidate(plan *capabilitydriver.VideoInvocationPlan, candidate localexecution.RawAVCandidate) error {
	if plan == nil {
		return mediaFailure("validate candidate", fmt.Errorf("video invocation plan is missing"))
	}
	width, height := plan.Size()
	frameCount := plan.FrameCount()
	if width <= 0 || height <= 0 || frameCount <= 0 {
		return mediaFailure("validate candidate", fmt.Errorf("video invocation plan is incomplete"))
	}
	if candidate.FrameCount != frameCount || len(candidate.Frames) != frameCount || len(candidate.Frames) == 0 {
		return mediaFailure("validate candidate", fmt.Errorf("frame count does not match the captured plan"))
	}
	if plan.FPS() != 24 || candidate.FPS != 24 {
		return mediaFailure("validate candidate", fmt.Errorf("candidate fps must be 24"))
	}
	expectedFrameBytes := width * height * 3
	for index, frame := range candidate.Frames {
		if frame.Width != width || frame.Height != height {
			return mediaFailure("validate candidate", fmt.Errorf("frame %d shape does not match the captured plan", index))
		}
		if len(frame.RGBBytes) != expectedFrameBytes {
			return mediaFailure("validate candidate", fmt.Errorf("frame %d RGB byte length is invalid", index))
		}
	}
	if !plan.AudioRequired() || candidate.Audio.Channels != 2 || candidate.Audio.SampleRate != 32000 || len(candidate.Audio.PCMSamples) == 0 {
		return mediaFailure("validate candidate", fmt.Errorf("candidate audio must be non-empty stereo 32000 Hz PCM"))
	}
	if len(candidate.Audio.PCMSamples)%candidate.Audio.Channels != 0 {
		return mediaFailure("validate candidate", fmt.Errorf("candidate audio is not complete interleaved PCM"))
	}
	for index, sample := range candidate.Audio.PCMSamples {
		if math.IsNaN(float64(sample)) || math.IsInf(float64(sample), 0) {
			return mediaFailure("validate candidate", fmt.Errorf("candidate audio sample %d is not finite", index))
		}
	}
	return nil
}

// EncodeAndInspect writes a private float32 WAV, streams packed RGB24 frames
// to one ffmpeg invocation, probes the staged MP4, and removes all staging
// files before returning.
func (p *Processor) EncodeAndInspect(ctx context.Context, plan *capabilitydriver.VideoInvocationPlan, candidate localexecution.RawAVCandidate) (Result, error) {
	if p == nil || p.ffmpegPath == "" || p.ffprobePath == "" {
		return Result{}, &Error{Kind: FailureUnavailable, Op: "encode video", Err: fmt.Errorf("codec processor is unavailable")}
	}
	if err := ValidateCandidate(plan, candidate); err != nil {
		return Result{}, err
	}
	stagingDir, err := os.MkdirTemp("", "nimi-video-media-")
	if err != nil {
		return Result{}, &Error{Kind: FailureUnavailable, Op: "create private video staging", Err: err}
	}
	defer func() { _ = os.RemoveAll(stagingDir) }()

	audioPath := filepath.Join(stagingDir, "audio-f32.wav")
	outputPath := filepath.Join(stagingDir, "output.mp4")
	if err := writeFloat32WAV(audioPath, candidate.Audio); err != nil {
		return Result{}, &Error{Kind: FailureEncode, Op: "write staged audio", Err: err}
	}
	width, height := plan.Size()
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-f", "rawvideo", "-pix_fmt", "rgb24", "-s", fmt.Sprintf("%dx%d", width, height), "-r", "24", "-i", "pipe:0",
		"-i", audioPath,
		"-map", "0:v:0", "-map", "1:a:0", "-frames:v", strconv.Itoa(plan.FrameCount()),
		"-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "32000", "-ac", "2", "-movflags", "+faststart",
		outputPath,
	}
	command := exec.CommandContext(ctx, p.ffmpegPath, args...)
	readers := make([]io.Reader, 0, len(candidate.Frames))
	for _, frame := range candidate.Frames {
		readers = append(readers, bytes.NewReader(frame.RGBBytes))
	}
	command.Stdin = io.MultiReader(readers...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return Result{}, &Error{Kind: FailureEncode, Op: "ffmpeg encode/mux", Err: commandFailure(err, stderr.String())}
	}
	facts, err := p.inspect(ctx, outputPath, plan)
	if err != nil {
		return Result{}, err
	}
	payload, err := os.ReadFile(outputPath)
	if err != nil {
		return Result{}, mediaFailure("read inspected MP4", err)
	}
	if len(payload) == 0 {
		return Result{}, mediaFailure("read inspected MP4", fmt.Errorf("encoded MP4 is empty"))
	}
	digest := sha256.Sum256(payload)
	facts.MIMEType = MIMETypeMP4
	facts.SizeBytes = int64(len(payload))
	facts.SHA256 = hex.EncodeToString(digest[:])
	result := Result{Bytes: payload, Facts: facts}
	if plan.ReturnLastFrame() {
		lastFrame, err := p.extractLastFrame(ctx, outputPath, stagingDir, plan)
		if err != nil {
			return Result{}, err
		}
		result.LastFrame = lastFrame
	}
	return result, nil
}

func (p *Processor) extractLastFrame(ctx context.Context, videoPath string, stagingDir string, plan *capabilitydriver.VideoInvocationPlan) (*StillImage, error) {
	outputPath := filepath.Join(stagingDir, "last-frame.png")
	args := []string{
		"-hide_banner", "-loglevel", "error", "-y",
		"-i", videoPath, "-map", "0:v:0",
		"-vf", fmt.Sprintf("select=eq(n\\,%d)", plan.FrameCount()-1),
		"-frames:v", "1", "-c:v", "png", outputPath,
	}
	command := exec.CommandContext(ctx, p.ffmpegPath, args...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return nil, &Error{Kind: FailureEncode, Op: "ffmpeg extract last frame", Err: commandFailure(err, stderr.String())}
	}
	payload, err := os.ReadFile(outputPath)
	if err != nil {
		return nil, mediaFailure("read extracted last frame", err)
	}
	config, err := png.DecodeConfig(bytes.NewReader(payload))
	if err != nil {
		return nil, mediaFailure("inspect extracted last frame PNG", err)
	}
	width, height := plan.Size()
	if config.Width != width || config.Height != height {
		return nil, mediaFailure("inspect extracted last frame PNG", fmt.Errorf("image shape %dx%d does not match %dx%d", config.Width, config.Height, width, height))
	}
	digest := sha256.Sum256(payload)
	return &StillImage{
		Bytes: payload, MIMEType: MIMETypePNG, SizeBytes: int64(len(payload)), SHA256: hex.EncodeToString(digest[:]),
		Width: config.Width, Height: config.Height, FrameIndex: plan.FrameCount() - 1,
	}, nil
}

func writeFloat32WAV(path string, audio localexecution.RawAudio) error {
	dataSize := uint64(len(audio.PCMSamples)) * 4
	if dataSize > math.MaxUint32-36 {
		return fmt.Errorf("float32 WAV exceeds RIFF size limit")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	defer file.Close()
	header := make([]byte, 44)
	copy(header[0:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], uint32(36+dataSize))
	copy(header[8:12], "WAVE")
	copy(header[12:16], "fmt ")
	binary.LittleEndian.PutUint32(header[16:20], 16)
	binary.LittleEndian.PutUint16(header[20:22], 3) // IEEE float32 PCM
	binary.LittleEndian.PutUint16(header[22:24], uint16(audio.Channels))
	binary.LittleEndian.PutUint32(header[24:28], uint32(audio.SampleRate))
	byteRate := audio.SampleRate * audio.Channels * 4
	binary.LittleEndian.PutUint32(header[28:32], uint32(byteRate))
	binary.LittleEndian.PutUint16(header[32:34], uint16(audio.Channels*4))
	binary.LittleEndian.PutUint16(header[34:36], 32)
	copy(header[36:40], "data")
	binary.LittleEndian.PutUint32(header[40:44], uint32(dataSize))
	if _, err := file.Write(header); err != nil {
		return err
	}
	buffer := make([]byte, 4*4096)
	for offset := 0; offset < len(audio.PCMSamples); {
		count := len(audio.PCMSamples) - offset
		if count > 4096 {
			count = 4096
		}
		for index := 0; index < count; index++ {
			binary.LittleEndian.PutUint32(buffer[index*4:index*4+4], math.Float32bits(audio.PCMSamples[offset+index]))
		}
		if _, err := file.Write(buffer[:count*4]); err != nil {
			return err
		}
		offset += count
	}
	return file.Close()
}

type probeDocument struct {
	Streams []probeStream `json:"streams"`
	Format  probeFormat   `json:"format"`
}

type probeStream struct {
	CodecType  string `json:"codec_type"`
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	FrameRate  string `json:"r_frame_rate"`
	FrameCount string `json:"nb_frames"`
	Duration   string `json:"duration"`
	Channels   int    `json:"channels"`
	SampleRate string `json:"sample_rate"`
}

type probeFormat struct {
	FormatName string `json:"format_name"`
	Duration   string `json:"duration"`
}

func (p *Processor) inspect(ctx context.Context, path string, plan *capabilitydriver.VideoInvocationPlan) (Facts, error) {
	args := []string{
		"-v", "error",
		"-show_entries", "format=format_name,duration:stream=codec_type,width,height,r_frame_rate,nb_frames,duration,channels,sample_rate",
		"-of", "json", path,
	}
	command := exec.CommandContext(ctx, p.ffprobePath, args...)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		return Facts{}, mediaFailure("ffprobe inspect", commandFailure(err, stderr.String()))
	}
	var document probeDocument
	if err := json.Unmarshal(stdout.Bytes(), &document); err != nil {
		return Facts{}, mediaFailure("decode ffprobe output", err)
	}
	if !formatContains(document.Format.FormatName, "mp4") {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("container is %q", document.Format.FormatName))
	}
	var video, audio *probeStream
	for index := range document.Streams {
		stream := &document.Streams[index]
		switch stream.CodecType {
		case "video":
			if video == nil {
				video = stream
			}
		case "audio":
			if audio == nil {
				audio = stream
			}
		}
	}
	if video == nil || audio == nil {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("both video and audio streams are required"))
	}
	width, height := plan.Size()
	if video.Width != width || video.Height != height {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("video shape %dx%d does not match %dx%d", video.Width, video.Height, width, height))
	}
	fps, err := parseRational(video.FrameRate)
	if err != nil || math.Abs(fps-24) > 0.0001 {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("video frame rate %q is not 24", video.FrameRate))
	}
	videoDuration, err := parsePositiveSeconds(video.Duration)
	if err != nil {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("video duration: %w", err))
	}
	frameCount, countErr := strconv.Atoi(strings.TrimSpace(video.FrameCount))
	if countErr == nil && frameCount > 0 {
		if frameCount != plan.FrameCount() {
			return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("video frame count %d does not match %d", frameCount, plan.FrameCount()))
		}
	} else if math.Abs(videoDuration*fps-float64(plan.FrameCount())) > 1.0 {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("video duration does not imply the captured frame count"))
	}
	if audio.Channels != 2 || strings.TrimSpace(audio.SampleRate) != "32000" {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("audio must be stereo 32000 Hz"))
	}
	audioDuration, err := parsePositiveSeconds(audio.Duration)
	if err != nil {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("audio duration: %w", err))
	}
	oneFrame := 1.0 / fps
	if math.Abs(videoDuration-audioDuration) > oneFrame+0.0001 {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("audio/video duration delta exceeds one frame"))
	}
	expectedDuration := float64(plan.FrameCount()) / fps
	if math.Abs(videoDuration-expectedDuration) > oneFrame+0.0001 {
		return Facts{}, mediaFailure("inspect MP4", fmt.Errorf("video duration does not match the captured frame grid"))
	}
	return Facts{
		Width: width, Height: height, FPS: 24, FrameCount: plan.FrameCount(),
		Duration: time.Duration(videoDuration * float64(time.Second)), Channels: 2, SampleRate: 32000,
	}, nil
}

func mediaFailure(op string, err error) error {
	return &Error{Kind: FailureMedia, Op: op, Err: err}
}

func commandFailure(err error, stderr string) error {
	stderr = strings.TrimSpace(stderr)
	if stderr == "" {
		return err
	}
	return fmt.Errorf("%w: %s", err, stderr)
}

func formatContains(raw string, target string) bool {
	for _, value := range strings.Split(strings.ToLower(raw), ",") {
		if strings.TrimSpace(value) == target {
			return true
		}
	}
	return false
}

func parseRational(raw string) (float64, error) {
	parts := strings.Split(strings.TrimSpace(raw), "/")
	if len(parts) != 2 {
		return 0, fmt.Errorf("invalid rational")
	}
	numerator, err := strconv.ParseFloat(parts[0], 64)
	if err != nil {
		return 0, err
	}
	denominator, err := strconv.ParseFloat(parts[1], 64)
	if err != nil || denominator == 0 {
		return 0, fmt.Errorf("invalid rational denominator")
	}
	return numerator / denominator, nil
}

func parsePositiveSeconds(raw string) (float64, error) {
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil || value <= 0 || math.IsNaN(value) || math.IsInf(value, 0) {
		return 0, fmt.Errorf("invalid duration %q", raw)
	}
	return value, nil
}
