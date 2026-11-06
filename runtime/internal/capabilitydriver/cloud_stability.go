package capabilitydriver

import (
	"crypto/rand"
	"encoding/binary"
	"math"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func StabilityImageEngine(model string) (string, string) {
	switch model {
	case "stable-image-core":
		return "core", ""
	case "stable-image-ultra":
		return "ultra", ""
	case "stable-diffusion-3.5-large", "stable-diffusion-3.5-large-turbo", "stable-diffusion-3.5-medium":
		return "sd3", strings.Replace(model, "stable-diffusion-", "sd", 1)
	default:
		return "", ""
	}
}

func StabilityImageReferenceSupported(model string) bool {
	engine, _ := StabilityImageEngine(model)
	return engine == "ultra" || engine == "sd3"
}

func stabilityOptionUnsupported() error {
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
}

func validateStabilityImageRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := req.GetSpec().GetImageGenerate()
	engine, _ := StabilityImageEngine(model)
	if s == nil || engine == "" || len(req.GetExtensions()) != 0 || strings.TrimSpace(s.GetPrompt()) == "" || utf8.RuneCountInString(s.GetPrompt()) > 10000 || utf8.RuneCountInString(s.GetNegativePrompt()) > 10000 || s.GetN() > 1 || s.GetSize() != "" || s.GetQuality() != "" || len(s.GetReferenceImages()) != 0 || s.GetMask() != "" || s.GetMaskArtifactId() != "" || s.GetComplexity() != "" || s.GetMarkup() != "" || s.GetMarkupArtifactId() != "" || s.FrameCount != nil || s.FrameDurationMs != nil || s.Seed != nil && (s.GetSeed() < 1 || s.GetSeed() > math.MaxInt32) {
		return stabilityOptionUnsupported()
	}
	switch s.GetResponseFormat() {
	case "", "b64_json":
	default:
		return stabilityOptionUnsupported()
	}
	switch s.GetOutputFormat() {
	case "":
		s.OutputFormat = "png"
	case "png", "jpeg", "webp":
	default:
		return stabilityOptionUnsupported()
	}
	switch s.GetStyle() {
	case "", "enhance", "anime", "photographic", "digital-art", "comic-book", "fantasy-art", "line-art", "analog-film", "neon-punk", "isometric", "low-poly", "origami", "modeling-compound", "cinematic", "3d-model", "pixel-art", "tile-texture":
	default:
		return stabilityOptionUnsupported()
	}
	switch s.GetAspectRatio() {
	case "", "21:9", "16:9", "3:2", "5:4", "1:1", "4:5", "2:3", "9:16", "9:21":
	default:
		return stabilityOptionUnsupported()
	}
	if s.GetReferenceImageArtifactId() != "" {
		if !StabilityImageReferenceSupported(model) || s.GetAspectRatio() != "" || math.IsNaN(float64(s.GetStrength())) || s.GetStrength() < 0 || s.GetStrength() > 1 {
			return stabilityOptionUnsupported()
		}
		if s.Strength == nil {
			strength := float32(0.5)
			s.Strength = &strength
		}
	} else if s.Strength != nil {
		return stabilityOptionUnsupported()
	}
	// Native zero means random, not fixed seed zero. Capture a nonzero seed
	// within the canonical image result range before Job publication.
	if s.Seed == nil {
		var raw [4]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return err
		}
		seed := int64(binary.BigEndian.Uint32(raw[:])%math.MaxInt32 + 1)
		s.Seed = &seed
	}
	return nil
}

func StabilityMusicMaxDuration(model string) int32 {
	switch model {
	case "stable-audio-3":
		return 380
	case "stable-audio-2", "stable-audio-2.5":
		return 190
	default:
		return 0
	}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-generation
func validateStabilityMusicRequest(req *runtimev1.SubmitScenarioJobRequest, model string) error {
	s := req.GetSpec().GetMusicGenerate()
	maximum := StabilityMusicMaxDuration(model)
	if s == nil || maximum == 0 || len(req.GetExtensions()) != 0 || strings.TrimSpace(s.GetPrompt()) == "" || utf8.RuneCountInString(s.GetPrompt()) > 10000 || s.GetLyrics() != "" || s.GetNegativePrompt() != "" || s.GetStyle() != "" || s.GetTitle() != "" || s.GetInstrumental() || s.GetScore() != nil || s.GetScoreConditioning() != runtimev1.MusicScoreConditioning_MUSIC_SCORE_CONDITIONING_UNSPECIFIED || s.GetReturnGeneratedScore() || s.GetVideoReference() != nil || s.GetDurationSeconds() < 0 || s.GetDurationSeconds() > maximum || s.GetSeed() > 4294967294 {
		return stabilityOptionUnsupported()
	}
	if s.GetDurationSeconds() == 0 {
		s.DurationSeconds = 190
	}
	if s.Seed == nil {
		var raw [4]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return err
		}
		seed := binary.BigEndian.Uint32(raw[:])%4294967294 + 1
		s.Seed = &seed
	}
	return nil
}

func stabilityMusicInputCapabilities(model string) *runtimev1.MusicInputCapabilities {
	maximum := StabilityMusicMaxDuration(model)
	if maximum == 0 {
		return nil
	}
	return &runtimev1.MusicInputCapabilities{Generation: []*runtimev1.MusicGenerationInputProfile{{
		LyricsMode: "unsupported", ScoreMode: "unsupported", VideoReferenceMode: "unsupported",
		SupportsSeed: true, SupportsAudioReference: true, MaxAudioReferenceBytes: 32 << 20,
		MaxDurationSeconds: uint32(maximum), DefaultDurationSeconds: 190, MaxPromptBytes: 32768,
	}}}
}
