package engine

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type UpscaleExecutionHost struct {
	manager      *Manager
	resolveCodec func(context.Context) (string, string, error)
	lease        speechExecutionLease
}

func NewUpscaleExecutionHost(manager *Manager, resolveCodec func(context.Context) (string, string, error)) *UpscaleExecutionHost {
	return &UpscaleExecutionHost{manager: manager, resolveCodec: resolveCodec}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.media-upscale-contract
func (host *UpscaleExecutionHost) AdmitUpscale(plan *capabilitydriver.UpscaleInvocationPlan) error {
	if host == nil || host.manager == nil || plan == nil || len(plan.Bindings) != 2 || len(plan.Source) == 0 || len(plan.Source) > localexecution.MaxUpscaleInputBytes {
		return fmt.Errorf("super-resolution requires a bounded captured source and model bindings")
	}
	if err := admitManagedImageRecipeForCurrentHost(plan.Family, ""); err != nil {
		return err
	}
	if err := host.manager.validateManagedImageDependencySources(plan.Dependencies, ""); err != nil {
		return err
	}
	if plan.Video {
		if plan.MIMEType != "video/mp4" || host.resolveCodec == nil {
			return fmt.Errorf("video super-resolution requires MP4 and managed codecs")
		}
		return nil
	}
	_, _, err := upscaleImageDimensions(plan.Source, plan.Scale)
	return err
}

func upscaleImageDimensions(data []byte, scale uint32) (int, int, error) {
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || (format != "png" && format != "jpeg") || config.Width <= 0 || config.Height <= 0 || scale < 2 || scale > 4 ||
		config.Width > 4096/int(scale) || config.Height > 4096/int(scale) {
		return 0, 0, fmt.Errorf("super-resolution requires a PNG or JPEG whose enlarged axes are at most 4096 pixels")
	}
	if _, _, err := image.Decode(bytes.NewReader(data)); err != nil {
		return 0, 0, fmt.Errorf("decode complete super-resolution source: %w", err)
	}
	return config.Width * int(scale), config.Height * int(scale), nil
}

func (host *UpscaleExecutionHost) ExecuteUpscale(ctx context.Context, plan *capabilitydriver.UpscaleInvocationPlan, onStart func() error) (*localexecution.UpscaleArtifact, error) {
	if err := host.AdmitUpscale(plan); err != nil {
		return nil, executionFailure(localexecution.FailureLoad, err)
	}
	release, err := host.lease.acquire(ctx)
	if err != nil {
		return nil, err
	}
	defer release()
	if onStart != nil {
		if err := onStart(); err != nil {
			return nil, err
		}
	}
	if _, err := sealInvocationModelContentContext(ctx, plan.Bindings); err != nil {
		return nil, err
	}
	host.manager.mu.RLock()
	backendRoot := host.manager.managedImageBackendsPath
	acceleratorRoot := host.manager.sharedAcceleratorDependenciesPath
	workRoot := host.manager.runtimeWorkRoot
	host.manager.mu.RUnlock()
	spec, ok := resolveManagedImageBackendPackageSpecForCurrentHost("stablediffusion-ggml")
	if !ok || !filepath.IsAbs(workRoot) {
		return nil, fmt.Errorf("super-resolution Runtime package or work root is unavailable")
	}
	native, nativeDir, err := verifyManagedImageBackendPackage(backendRoot, "stablediffusion-ggml", spec)
	if err != nil {
		return nil, err
	}
	env, err := managedImageBackendRuntimeWrapperEnv(acceleratorRoot, spec)
	if err != nil {
		return nil, err
	}
	root := filepath.Join(workRoot, "upscale")
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
	args := []string{"-M", "vid_upscale", "--diffusion-model", plan.Bindings[0].AbsolutePath, "--vae", plan.Bindings[1].AbsolutePath,
		"--upscale-factor", strconv.Itoa(int(plan.Scale)), "--seed", strconv.FormatInt(plan.Seed, 10), "--offload-to-cpu"}
	if plan.Family == "seedvr2" {
		args = append(args, "--vsr-temporal-chunk-size", "1")
	}
	host.manager.logger.Info("native super-resolution starting", "recipe", plan.RecipeID, "video", plan.Video, "scale", plan.Scale, "executable", native)
	var result *localexecution.UpscaleArtifact
	if plan.Video {
		result, err = host.upscaleVideo(ctx, plan, work, nativeDir, native, env, args)
	} else {
		result, err = upscaleStill(ctx, plan, work, nativeDir, native, env, args)
	}
	if err != nil {
		return nil, err
	}
	if err := ctx.Err(); err != nil {
		_ = result.Body.Close()
		return nil, err
	}
	retained = true
	host.manager.logger.Info("native super-resolution completed", "recipe", plan.RecipeID, "width", result.Width, "height", result.Height, "size_bytes", result.SizeBytes)
	return result, nil
}

// Inference uses the enclosing ScenarioJob execution lifetime. The installer
// command helper has a separate two-minute default and is inappropriate here.
func runUpscaleCommand(ctx context.Context, directory string, env map[string]string, executable string, args ...string) (string, error) {
	command := exec.CommandContext(ctx, managedCommandExecutablePath(executable), managedCommandArguments(args)...)
	configureManagedCommand(command)
	command.Dir = directory
	command.Env = managedCommandProcessEnvironment(os.Environ(), env)
	output := &upscaleCommandBuffer{}
	command.Stdout, command.Stderr = output, output
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", fmt.Errorf("super-resolution command %s failed: %w (%s)", filepath.Base(executable), err, output.buffer.String())
	}
	return output.buffer.String(), nil
}

type upscaleCommandBuffer struct {
	buffer bytes.Buffer
}

func (b *upscaleCommandBuffer) Write(data []byte) (int, error) {
	count := len(data)
	const limit = 256 << 10
	if count >= limit {
		b.buffer.Reset()
		data = data[count-limit:]
	} else if overflow := b.buffer.Len() + count - limit; overflow > 0 {
		b.buffer.Next(overflow)
	}
	_, _ = b.buffer.Write(data)
	return count, nil
}

func upscaleStill(ctx context.Context, plan *capabilitydriver.UpscaleInvocationPlan, work, nativeDir, native string, env map[string]string, args []string) (*localexecution.UpscaleArtifact, error) {
	width, height, err := upscaleImageDimensions(plan.Source, plan.Scale)
	if err != nil {
		return nil, err
	}
	extension := ".png"
	if plan.MIMEType == "image/jpeg" {
		extension = ".jpg"
	}
	input, output := filepath.Join(work, "source"+extension), filepath.Join(work, "result.png")
	if err := os.WriteFile(input, plan.Source, 0o600); err != nil {
		return nil, err
	}
	args = append(args, "-i", input, "-o", output)
	if _, err := runUpscaleCommand(ctx, nativeDir, env, native, args...); err != nil {
		return nil, fmt.Errorf("native image super-resolution: %w", err)
	}
	if err := validateUpscaledPNG(output, width, height); err != nil {
		return nil, err
	}
	return openUpscaleArtifact(work, output, "image/png", width, height, 0, 0)
}

func validateUpscaledPNG(path string, width, height int) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil || info.Size() <= 0 || info.Size() > 128<<20 {
		return fmt.Errorf("super-resolution image output exceeds its byte bound")
	}
	config, format, err := image.DecodeConfig(file)
	if err != nil || format != "png" || config.Width != width || config.Height != height {
		return fmt.Errorf("super-resolution image dimensions or encoding are invalid")
	}
	if _, err := file.Seek(0, 0); err != nil {
		return err
	}
	if _, _, err := image.Decode(file); err != nil {
		return fmt.Errorf("decode super-resolution output: %w", err)
	}
	return nil
}

func openUpscaleArtifact(work, path, mime string, width, height, fps int, durationMS int64) (*localexecution.UpscaleArtifact, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > localexecution.MaxUpscaleOutputBytes {
		_ = file.Close()
		return nil, fmt.Errorf("super-resolution result is missing or exceeds its byte bound")
	}
	return &localexecution.UpscaleArtifact{Body: &faceSwapVideoBody{File: file, work: work}, SizeBytes: info.Size(), MIMEType: mime,
		Width: uint32(width), Height: uint32(height), FPS: uint32(fps), DurationMS: durationMS}, nil
}

type upscaleVideoFacts struct {
	Width, Height, FPS, Frames int
	Audio                      bool
	Duration                   float64
	AudioDuration              float64
	Timestamps                 []float64
	Durations                  []float64
}

func inspectUpscaleVideo(ctx context.Context, ffprobe, path string, scale uint32) (upscaleVideoFacts, error) {
	output, err := runUpscaleCommand(ctx, "", nil, ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,duration", "-of", "json", path)
	if err != nil {
		return upscaleVideoFacts{}, err
	}
	var metadata struct {
		Streams []struct {
			CodecType     string `json:"codec_type"`
			CodecName     string `json:"codec_name"`
			Width, Height int
			Rate          string `json:"r_frame_rate"`
			Duration      string
		}
	}
	if err := json.Unmarshal([]byte(output), &metadata); err != nil {
		return upscaleVideoFacts{}, err
	}
	facts := upscaleVideoFacts{}
	videoCount, audioCount := 0, 0
	for _, stream := range metadata.Streams {
		switch stream.CodecType {
		case "video":
			videoCount++
			if stream.CodecName != "h264" {
				return facts, fmt.Errorf("video super-resolution requires H264")
			}
			fps, err := strconv.Atoi(strings.TrimSuffix(stream.Rate, "/1"))
			if err != nil || (fps != 24 && fps != 25 && fps != 30) {
				return facts, fmt.Errorf("video super-resolution supports 24, 25 or 30 FPS")
			}
			facts.Width, facts.Height, facts.FPS = stream.Width, stream.Height, fps
			facts.Duration, err = strconv.ParseFloat(stream.Duration, 64)
			if err != nil || math.IsNaN(facts.Duration) || math.IsInf(facts.Duration, 0) || facts.Duration <= 0 || facts.Duration > 10 {
				return facts, fmt.Errorf("video super-resolution supports clips of at most ten seconds")
			}
		case "audio":
			audioCount++
			if stream.CodecName != "aac" {
				return facts, fmt.Errorf("video super-resolution preserves an AAC audio stream")
			}
			facts.AudioDuration, err = strconv.ParseFloat(stream.Duration, 64)
			if err != nil || math.IsNaN(facts.AudioDuration) || math.IsInf(facts.AudioDuration, 0) || facts.AudioDuration <= 0 || facts.AudioDuration > 11 {
				return facts, fmt.Errorf("video super-resolution audio duration is invalid")
			}
		default:
			return facts, fmt.Errorf("video super-resolution does not admit additional streams")
		}
	}
	if videoCount != 1 || audioCount > 1 || facts.Width <= 0 || facts.Height <= 0 || scale == 0 || facts.Width > 4096/int(scale) || facts.Height > 4096/int(scale) {
		return facts, fmt.Errorf("video super-resolution source streams or dimensions are invalid")
	}
	facts.Audio = audioCount == 1
	frameJSON, err := runUpscaleCommand(ctx, "", nil, ffprobe, "-v", "error", "-protocol_whitelist", "file,pipe", "-select_streams", "v:0", "-read_intervals", "%+#301", "-show_entries", "frame=best_effort_timestamp_time,duration_time", "-of", "json", path)
	if err != nil {
		return facts, err
	}
	var decoded struct {
		Frames []struct {
			Time     string `json:"best_effort_timestamp_time"`
			Duration string `json:"duration_time"`
		}
	}
	if err := json.Unmarshal([]byte(frameJSON), &decoded); err != nil {
		return facts, err
	}
	facts.Frames = len(decoded.Frames)
	if facts.Frames == 0 || facts.Frames > 300 || uint64(facts.Frames)*uint64(facts.Width)*uint64(facts.Height)*uint64(scale)*uint64(scale)*3 > 512<<20 {
		return facts, fmt.Errorf("video super-resolution exceeds the frame or decoded-output byte bound")
	}
	for index, frame := range decoded.Frames {
		timestamp, err := strconv.ParseFloat(frame.Time, 64)
		if err != nil || math.IsNaN(timestamp) || math.IsInf(timestamp, 0) || timestamp < 0 || timestamp >= 10 ||
			(index == 0 && timestamp != 0) || (index > 0 && timestamp <= facts.Timestamps[index-1]) {
			return facts, fmt.Errorf("video super-resolution requires a bounded, strictly increasing timeline starting at zero")
		}
		facts.Timestamps = append(facts.Timestamps, timestamp)
	}
	for index, timestamp := range facts.Timestamps {
		duration := facts.Duration - timestamp
		if index+1 < facts.Frames {
			duration = facts.Timestamps[index+1] - timestamp
		} else if decoded.Frames[index].Duration != "" {
			duration, err = strconv.ParseFloat(decoded.Frames[index].Duration, 64)
		}
		if err != nil || math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > 10 {
			return facts, fmt.Errorf("video frame duration is invalid")
		}
		facts.Durations = append(facts.Durations, duration)
	}
	if math.Abs(facts.Duration-facts.Timestamps[facts.Frames-1]-facts.Durations[facts.Frames-1]) > 0.001 {
		return facts, fmt.Errorf("video frame timeline and stream duration disagree")
	}
	return facts, nil
}

func (host *UpscaleExecutionHost) upscaleVideo(ctx context.Context, plan *capabilitydriver.UpscaleInvocationPlan, work, nativeDir, native string, env map[string]string, args []string) (*localexecution.UpscaleArtifact, error) {
	ffmpeg, ffprobe, err := host.resolveCodec(ctx)
	if err != nil {
		return nil, err
	}
	codec, ok := exactInvocationDependencySource(plan.Dependencies, "native-tool.media-codec", MediaCodecDependencyID)
	codecSpec, specErr := mediaCodecSpecFor(currentGOOS(), currentGOARCH())
	if !ok || specErr != nil || codec.Version != codecSpec.version || !sameCleanPath(codec.CanonicalRoot, filepath.Dir(filepath.Dir(ffmpeg))) ||
		!sameInvocationArtifactSet(codec.VerifiedArtifacts, []string{ffmpeg, ffprobe}) || !reflect.DeepEqual(codec.Hashes, codecSpec.hashes) {
		return nil, fmt.Errorf("captured super-resolution codec source no longer matches verified installed supply")
	}
	input := filepath.Join(work, "source.mp4")
	if err := os.WriteFile(input, plan.Source, 0o600); err != nil {
		return nil, err
	}
	facts, err := inspectUpscaleVideo(ctx, ffprobe, input, plan.Scale)
	if err != nil {
		return nil, err
	}
	inputFrames, outputFrames := filepath.Join(work, "input"), filepath.Join(work, "output")
	for _, dir := range []string{inputFrames, outputFrames} {
		if err := os.Mkdir(dir, 0o700); err != nil {
			return nil, err
		}
	}
	if _, err := runUpscaleCommand(ctx, work, nil, ffmpeg, "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", input, "-map", "0:v:0", "-frames:v", "301", "-fps_mode", "passthrough", "-start_number", "0", filepath.Join(inputFrames, "frame-%06d.png")); err != nil {
		return nil, err
	}
	if _, err := inspectUpscaleFrames(inputFrames, facts.Frames, facts.Width, facts.Height); err != nil {
		return nil, err
	}
	args = append(args, "--input-frames", inputFrames, "--fps", strconv.Itoa(facts.FPS), "-o", filepath.Join(outputFrames, "frame-%06d.png"))
	if _, err := runUpscaleCommand(ctx, nativeDir, env, native, args...); err != nil {
		return nil, fmt.Errorf("native video super-resolution: %w", err)
	}
	width, height := facts.Width*int(plan.Scale), facts.Height*int(plan.Scale)
	first, err := inspectUpscaleFrames(outputFrames, facts.Frames, width, height)
	if err != nil {
		return nil, err
	}
	output := filepath.Join(work, "result.mp4")
	timeline := filepath.Join(work, "timeline.ffconcat")
	if err := writeUpscaleTimeline(timeline, first, facts); err != nil {
		return nil, err
	}
	// Preserve the original PTS even when AAC priming extends the first frame.
	// Disabling B-frames lets the last packet duration describe the exact tail.
	lastDurationUS := int64(math.Round(facts.Durations[len(facts.Durations)-1] * 1e6))
	bitstreamTiming := fmt.Sprintf("h264_metadata=tick_rate=%d/1:fixed_frame_rate_flag=0,setts=duration=%d", facts.FPS*2, lastDurationUS)
	encodeArgs := []string{"-nostdin", "-v", "error", "-f", "concat", "-safe", "0", "-i", timeline,
		"-protocol_whitelist", "file,pipe", "-i", input, "-map", "0:v:0", "-map", "1:a:0?",
		"-c:v", "libx264", "-bf", "0", "-pix_fmt", "yuv420p", "-crf", "18", "-fps_mode", "passthrough",
		"-enc_time_base", "1:1000000", "-video_track_timescale", "1000000", "-bsf:v", bitstreamTiming,
		"-c:a", "copy", "-map_metadata", "-1", "-movflags", "+faststart", output}
	if _, err := runUpscaleCommand(ctx, work, nil, ffmpeg, encodeArgs...); err != nil {
		return nil, err
	}
	actual, err := inspectUpscaleVideo(ctx, ffprobe, output, 1)
	if err != nil {
		return nil, fmt.Errorf("inspect super-resolution video output: %w", err)
	}
	if actual.Width != width || actual.Height != height || actual.Frames != facts.Frames || actual.FPS != facts.FPS || actual.Audio != facts.Audio || math.Abs(actual.AudioDuration-facts.AudioDuration) > 0.001 {
		return nil, fmt.Errorf("super-resolution video output did not preserve the complete source timeline and audio")
	}
	for index := range facts.Timestamps {
		if math.Abs(actual.Timestamps[index]-facts.Timestamps[index]) > 0.00001 || math.Abs(actual.Durations[index]-facts.Durations[index]) > 0.00001 {
			return nil, fmt.Errorf("super-resolution video changed a frame timestamp or duration")
		}
	}
	return openUpscaleArtifact(work, output, "video/mp4", width, height, facts.FPS, int64(math.Round(facts.Duration*1000)))
}

func writeUpscaleTimeline(path string, first int, facts upscaleVideoFacts) error {
	var text strings.Builder
	text.WriteString("ffconcat version 1.0\n")
	for index, duration := range facts.Durations {
		fmt.Fprintf(&text, "file 'output/frame-%06d.png'\noption framerate 1000000\nduration %.6f\n", first+index, duration)
	}
	return os.WriteFile(path, []byte(text.String()), 0o600)
}

func inspectUpscaleFrames(directory string, expected, width, height int) (int, error) {
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != expected {
		return 0, fmt.Errorf("super-resolution frame count is incomplete")
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })
	first := -1
	for index, entry := range entries {
		name := entry.Name()
		number, err := strconv.Atoi(strings.TrimSuffix(strings.TrimPrefix(name, "frame-"), ".png"))
		if index == 0 {
			first = number
		}
		if err != nil || entry.IsDir() || name != fmt.Sprintf("frame-%06d.png", number) || (first != 0 && first != 1) || number != first+index {
			return 0, fmt.Errorf("super-resolution frame sequence is invalid")
		}
		if err := validateUpscaledPNG(filepath.Join(directory, name), width, height); err != nil {
			return 0, err
		}
	}
	return first, nil
}
