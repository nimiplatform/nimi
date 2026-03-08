package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"gopkg.in/yaml.v3"
)

var aiGoldFixtureEnvPattern = regexp.MustCompile(`\$\{([A-Z0-9_]+)\}`)

type aiGoldFixture struct {
	FixtureID          string                `yaml:"fixture_id"`
	Capability         string                `yaml:"capability"`
	Provider           string                `yaml:"provider"`
	ModelID            string                `yaml:"model_id"`
	TargetModelID      string                `yaml:"target_model_id,omitempty"`
	VoiceRef           *aiGoldVoiceReference `yaml:"voice_ref,omitempty"`
	Request            aiGoldFixtureRequest  `yaml:"request"`
	ExpectedAssertions map[string]any        `yaml:"expected_assertions"`
	EnvRequirements    []string              `yaml:"env_requirements"`
	Path               string                `yaml:"-"`
}

type aiGoldVoiceReference struct {
	Kind string `yaml:"kind"`
	ID   string `yaml:"id"`
}

type aiGoldFixtureRequest struct {
	Prompt          string   `yaml:"prompt,omitempty"`
	SystemPrompt    string   `yaml:"system_prompt,omitempty"`
	Inputs          []string `yaml:"inputs,omitempty"`
	NegativePrompt  string   `yaml:"negative_prompt,omitempty"`
	Text            string   `yaml:"text,omitempty"`
	Language        string   `yaml:"language,omitempty"`
	AudioFormat     string   `yaml:"audio_format,omitempty"`
	AudioURI        string   `yaml:"audio_uri,omitempty"`
	AudioPath       string   `yaml:"audio_path,omitempty"`
	MimeType        string   `yaml:"mime_type,omitempty"`
	InstructionText string   `yaml:"instruction_text,omitempty"`
}

func loadAIGoldFixture(path string) (*aiGoldFixture, error) {
	normalizedPath := strings.TrimSpace(path)
	if normalizedPath == "" {
		return nil, fmt.Errorf("fixture path is required")
	}
	raw, err := os.ReadFile(normalizedPath)
	if err != nil {
		return nil, fmt.Errorf("read fixture %s: %w", normalizedPath, err)
	}
	expanded := aiGoldFixtureEnvPattern.ReplaceAllStringFunc(string(raw), func(match string) string {
		submatches := aiGoldFixtureEnvPattern.FindStringSubmatch(match)
		if len(submatches) != 2 {
			return match
		}
		return os.Getenv(submatches[1])
	})

	var fixture aiGoldFixture
	if err := yaml.Unmarshal([]byte(expanded), &fixture); err != nil {
		return nil, fmt.Errorf("parse fixture %s: %w", normalizedPath, err)
	}
	fixture.Path = normalizedPath
	if err := fixture.validate(); err != nil {
		return nil, fmt.Errorf("validate fixture %s: %w", normalizedPath, err)
	}
	return &fixture, nil
}

func (f *aiGoldFixture) validate() error {
	if f == nil {
		return fmt.Errorf("fixture is required")
	}
	if strings.TrimSpace(f.FixtureID) == "" {
		return fmt.Errorf("fixture_id is required")
	}
	if strings.TrimSpace(f.Capability) == "" {
		return fmt.Errorf("capability is required")
	}
	if strings.TrimSpace(f.Provider) == "" {
		return fmt.Errorf("provider is required")
	}
	if strings.TrimSpace(f.ModelID) == "" {
		return fmt.Errorf("model_id is required")
	}
	for _, envName := range f.EnvRequirements {
		trimmed := strings.TrimSpace(envName)
		if trimmed == "" {
			continue
		}
		if strings.TrimSpace(os.Getenv(trimmed)) == "" {
			return fmt.Errorf("required env %s is empty", trimmed)
		}
	}
	if strings.Contains(strings.ToLower(f.FixtureID), "connectorid") {
		return fmt.Errorf("legacy connectorId is forbidden in fixture_id")
	}
	switch strings.TrimSpace(strings.ToLower(f.Capability)) {
	case "text.generate":
		if strings.TrimSpace(f.Request.Prompt) == "" {
			return fmt.Errorf("text.generate requires request.prompt")
		}
	case "text.embed":
		if len(f.Request.Inputs) == 0 {
			return fmt.Errorf("text.embed requires request.inputs")
		}
	case "image.generate":
		if strings.TrimSpace(f.Request.Prompt) == "" {
			return fmt.Errorf("image.generate requires request.prompt")
		}
	case "audio.synthesize":
		if strings.TrimSpace(f.Request.Text) == "" {
			return fmt.Errorf("audio.synthesize requires request.text")
		}
	case "audio.transcribe":
		if err := f.validateAudioRequest("audio.transcribe"); err != nil {
			return err
		}
	case "voice.clone":
		if strings.TrimSpace(f.TargetModelID) == "" {
			return fmt.Errorf("voice.clone requires target_model_id")
		}
		if err := f.validateAudioRequest("voice.clone"); err != nil {
			return err
		}
	case "voice.design":
		if strings.TrimSpace(f.TargetModelID) == "" {
			return fmt.Errorf("voice.design requires target_model_id")
		}
		if strings.TrimSpace(f.Request.InstructionText) == "" {
			return fmt.Errorf("voice.design requires request.instruction_text")
		}
	case "video.generate":
		return nil
	default:
		return fmt.Errorf("unsupported capability %q", f.Capability)
	}
	return nil
}

func (f *aiGoldFixture) validateAudioRequest(capability string) error {
	audioURI := strings.TrimSpace(f.Request.AudioURI)
	audioPath := strings.TrimSpace(f.Request.AudioPath)
	if audioURI != "" && audioPath != "" {
		return fmt.Errorf("%s request.audio_uri and request.audio_path are mutually exclusive", capability)
	}
	if audioURI == "" && audioPath == "" {
		return fmt.Errorf("%s requires request.audio_uri or request.audio_path", capability)
	}
	return nil
}

func (f *aiGoldFixture) routePolicy() runtimev1.RoutePolicy {
	if strings.EqualFold(strings.TrimSpace(f.Provider), "local") {
		return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
	}
	return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
}

func (f *aiGoldFixture) fallbackPolicy() runtimev1.FallbackPolicy {
	return runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY
}

func (f *aiGoldFixture) runtimeModelID() string {
	if f == nil {
		return ""
	}
	modelID := strings.TrimSpace(f.ModelID)
	if modelID == "" {
		return ""
	}
	if f.routePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD {
		return modelID
	}
	lower := strings.ToLower(modelID)
	if strings.HasPrefix(lower, "cloud/") || strings.Contains(modelID, "/") {
		return modelID
	}
	return "cloud/" + modelID
}

func (f *aiGoldFixture) requestDigest() string {
	if f == nil {
		return ""
	}
	payload, err := json.Marshal(map[string]any{
		"fixture_id":       strings.TrimSpace(f.FixtureID),
		"capability":       strings.TrimSpace(f.Capability),
		"provider":         strings.TrimSpace(f.Provider),
		"model_id":         strings.TrimSpace(f.ModelID),
		"target_model_id":  strings.TrimSpace(f.TargetModelID),
		"voice_ref":        f.VoiceRef,
		"request":          f.Request,
		"expected_asserts": f.ExpectedAssertions,
	})
	if err != nil {
		return ""
	}
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func (f *aiGoldFixture) resolveAudioInput() (string, []byte, string, error) {
	if f == nil {
		return "", nil, "", fmt.Errorf("fixture is required")
	}
	audioURI := strings.TrimSpace(f.Request.AudioURI)
	audioPath := strings.TrimSpace(f.Request.AudioPath)
	if audioURI != "" && audioPath != "" {
		return "", nil, "", fmt.Errorf("request.audio_uri and request.audio_path are mutually exclusive")
	}
	if audioPath != "" {
		resolvedPath := audioPath
		if !filepath.IsAbs(resolvedPath) {
			resolvedPath = filepath.Join(filepath.Dir(strings.TrimSpace(f.Path)), resolvedPath)
		}
		audioBytes, err := os.ReadFile(resolvedPath)
		if err != nil {
			return "", nil, "", fmt.Errorf("read audio fixture %s: %w", resolvedPath, err)
		}
		if len(audioBytes) == 0 {
			return "", nil, "", fmt.Errorf("audio fixture %s is empty", resolvedPath)
		}
		return "", audioBytes, inferFixtureAudioMimeType(resolvedPath, f.Request.MimeType), nil
	}
	if audioURI != "" {
		return audioURI, nil, strings.TrimSpace(f.Request.MimeType), nil
	}
	return "", nil, strings.TrimSpace(f.Request.MimeType), nil
}

func inferFixtureAudioMimeType(audioPath string, explicitMimeType string) string {
	if trimmed := strings.TrimSpace(explicitMimeType); trimmed != "" {
		return trimmed
	}
	switch strings.ToLower(filepath.Ext(strings.TrimSpace(audioPath))) {
	case ".mp3":
		return "audio/mpeg"
	case ".m4a":
		return "audio/mp4"
	case ".ogg":
		return "audio/ogg"
	case ".wav":
		fallthrough
	default:
		return "audio/wav"
	}
}

func (f *aiGoldFixture) voiceReferenceProto() *runtimev1.VoiceReference {
	if f == nil || f.VoiceRef == nil {
		return nil
	}
	kind := strings.TrimSpace(strings.ToLower(f.VoiceRef.Kind))
	id := strings.TrimSpace(f.VoiceRef.ID)
	if id == "" {
		return nil
	}
	switch kind {
	case "", "preset_voice_id", "preset":
		return &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET,
			Reference: &runtimev1.VoiceReference_PresetVoiceId{
				PresetVoiceId: id,
			},
		}
	case "provider_voice_ref", "provider":
		return &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PROVIDER_VOICE_REF,
			Reference: &runtimev1.VoiceReference_ProviderVoiceRef{
				ProviderVoiceRef: id,
			},
		}
	case "voice_asset_id", "voice_asset", "asset":
		return &runtimev1.VoiceReference{
			Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_VOICE_ASSET,
			Reference: &runtimev1.VoiceReference_VoiceAssetId{
				VoiceAssetId: id,
			},
		}
	default:
		return nil
	}
}

func (f *aiGoldFixture) buildExecuteScenarioRequest(appID string, subjectUserID string) (*runtimev1.ExecuteScenarioRequest, error) {
	if f == nil {
		return nil, fmt.Errorf("fixture is required")
	}
	head := &runtimev1.ScenarioRequestHead{
		AppId:         strings.TrimSpace(appID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		ModelId:       f.runtimeModelID(),
		RoutePolicy:   f.routePolicy(),
		Fallback:      f.fallbackPolicy(),
		TimeoutMs:     120_000,
	}
	switch strings.TrimSpace(strings.ToLower(f.Capability)) {
	case "text.generate":
		return &runtimev1.ExecuteScenarioRequest{
			Head:          head,
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateScenarioSpec{
						Input: []*runtimev1.ChatMessage{{
							Role:    "user",
							Content: strings.TrimSpace(f.Request.Prompt),
						}},
						SystemPrompt: strings.TrimSpace(f.Request.SystemPrompt),
					},
				},
			},
		}, nil
	case "text.embed":
		inputs := make([]string, 0, len(f.Request.Inputs))
		for _, item := range f.Request.Inputs {
			trimmed := strings.TrimSpace(item)
			if trimmed != "" {
				inputs = append(inputs, trimmed)
			}
		}
		return &runtimev1.ExecuteScenarioRequest{
			Head:          head,
			ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
			ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_TextEmbed{
					TextEmbed: &runtimev1.TextEmbedScenarioSpec{
						Inputs: inputs,
					},
				},
			},
		}, nil
	default:
		return nil, fmt.Errorf("capability %s is not sync replay", f.Capability)
	}
}

func (f *aiGoldFixture) buildSubmitScenarioJobRequest(appID string, subjectUserID string) (*runtimev1.SubmitScenarioJobRequest, error) {
	if f == nil {
		return nil, fmt.Errorf("fixture is required")
	}
	head := &runtimev1.ScenarioRequestHead{
		AppId:         strings.TrimSpace(appID),
		SubjectUserId: strings.TrimSpace(subjectUserID),
		ModelId:       f.runtimeModelID(),
		RoutePolicy:   f.routePolicy(),
		Fallback:      f.fallbackPolicy(),
		TimeoutMs:     180_000,
	}
	request := &runtimev1.SubmitScenarioJobRequest{
		Head:          head,
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_ASYNC_JOB,
	}
	switch strings.TrimSpace(strings.ToLower(f.Capability)) {
	case "image.generate":
		request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE
		request.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_ImageGenerate{
				ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
					Prompt:         strings.TrimSpace(f.Request.Prompt),
					NegativePrompt: strings.TrimSpace(f.Request.NegativePrompt),
				},
			},
		}
	case "audio.synthesize":
		request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE
		request.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
				SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
					Text:        strings.TrimSpace(f.Request.Text),
					Language:    strings.TrimSpace(f.Request.Language),
					AudioFormat: strings.TrimSpace(f.Request.AudioFormat),
					VoiceRef:    f.voiceReferenceProto(),
				},
			},
		}
	case "audio.transcribe":
		audioURI, audioBytes, audioMime, err := f.resolveAudioInput()
		if err != nil {
			return nil, err
		}
		request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_TRANSCRIBE
		request.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_SpeechTranscribe{
				SpeechTranscribe: &runtimev1.SpeechTranscribeScenarioSpec{
					MimeType: strings.TrimSpace(audioMime),
					Language: strings.TrimSpace(f.Request.Language),
					AudioSource: &runtimev1.SpeechTranscriptionAudioSource{
						Source: &runtimev1.SpeechTranscriptionAudioSource_AudioUri{
							AudioUri: strings.TrimSpace(audioURI),
						},
					},
				},
			},
		}
		if len(audioBytes) > 0 {
			request.GetSpec().GetSpeechTranscribe().AudioSource.Source = &runtimev1.SpeechTranscriptionAudioSource_AudioBytes{
				AudioBytes: audioBytes,
			}
		}
	case "voice.clone":
		audioURI, audioBytes, audioMime, err := f.resolveAudioInput()
		if err != nil {
			return nil, err
		}
		request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE
		request.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceClone{
				VoiceClone: &runtimev1.VoiceCloneScenarioSpec{
					TargetModelId: strings.TrimSpace(f.TargetModelID),
					Input: &runtimev1.VoiceV2VInput{
						ReferenceAudioUri:  strings.TrimSpace(audioURI),
						ReferenceAudioMime: strings.TrimSpace(audioMime),
					},
				},
			},
		}
		if len(audioBytes) > 0 {
			request.GetSpec().GetVoiceClone().GetInput().ReferenceAudioBytes = audioBytes
			request.GetSpec().GetVoiceClone().GetInput().ReferenceAudioUri = ""
		}
	case "voice.design":
		request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN
		request.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VoiceDesign{
				VoiceDesign: &runtimev1.VoiceDesignScenarioSpec{
					TargetModelId: strings.TrimSpace(f.TargetModelID),
					Input: &runtimev1.VoiceT2VInput{
						InstructionText: strings.TrimSpace(f.Request.InstructionText),
					},
				},
			},
		}
	case "video.generate":
		request.ScenarioType = runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE
		request.Spec = &runtimev1.ScenarioSpec{
			Spec: &runtimev1.ScenarioSpec_VideoGenerate{
				VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
					Prompt: strings.TrimSpace(f.Request.Prompt),
				},
			},
		}
	default:
		return nil, fmt.Errorf("capability %s is not async replay", f.Capability)
	}
	return request, nil
}
