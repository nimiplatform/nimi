package modelregistry

import (
	"sort"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// ProviderHint indicates preferred cloud adapter for a model entry.
type ProviderHint string

const (
	ProviderHintUnknown    ProviderHint = "unknown"
	ProviderHintLocal      ProviderHint = "local"
	ProviderHintNimiLLM    ProviderHint = "nimillm"
	ProviderHintDashScope  ProviderHint = "dashscope"
	ProviderHintVolcengine ProviderHint = "volcengine"
	ProviderHintGemini     ProviderHint = "gemini"
	ProviderHintMiniMax    ProviderHint = "minimax"
	ProviderHintKimi       ProviderHint = "kimi"
	ProviderHintGLM        ProviderHint = "glm"
)

// Entry is a model registry record used by runtime services.
type Entry struct {
	ModelID      string
	Version      string
	Status       runtimev1.ModelStatus
	Capabilities []string
	Files        []string
	LastHealthAt time.Time
	Source       string
	ProviderHint ProviderHint
}

// Registry provides concurrent-safe model metadata storage.
type Registry struct {
	mu     sync.RWMutex
	models map[string]Entry
}

func New() *Registry {
	return &Registry{
		models: make(map[string]Entry),
	}
}

func (r *Registry) Upsert(entry Entry) {
	modelID := strings.TrimSpace(entry.ModelID)
	if modelID == "" {
		return
	}
	if entry.Version == "" {
		entry.Version = "latest"
	}
	if entry.ProviderHint == "" {
		entry.ProviderHint = inferProviderHint(modelID, entry.Source)
	}
	entry.ModelID = modelID
	entry.Source = strings.TrimSpace(entry.Source)

	r.mu.Lock()
	r.models[modelID] = entry
	r.mu.Unlock()
}

func (r *Registry) Remove(modelID string) bool {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return false
	}
	r.mu.Lock()
	_, exists := r.models[key]
	if exists {
		delete(r.models, key)
	}
	r.mu.Unlock()
	return exists
}

func (r *Registry) Get(modelID string) (Entry, bool) {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return Entry{}, false
	}
	r.mu.RLock()
	item, exists := r.models[key]
	r.mu.RUnlock()
	if !exists {
		return Entry{}, false
	}
	return cloneEntry(item), true
}

func (r *Registry) List() []Entry {
	r.mu.RLock()
	items := make([]Entry, 0, len(r.models))
	for _, item := range r.models {
		items = append(items, cloneEntry(item))
	}
	r.mu.RUnlock()

	sort.Slice(items, func(i, j int) bool {
		return items[i].ModelID < items[j].ModelID
	})
	return items
}

func (r *Registry) ListDescriptors() ([]*runtimev1.ModelDescriptor, error) {
	entries := r.List()
	out := make([]*runtimev1.ModelDescriptor, 0, len(entries))
	for _, item := range entries {
		projection, err := InferNativeProjection(item.ModelID, item.Capabilities, item.Files, item.Status)
		if err != nil {
			return nil, err
		}
		desc := &runtimev1.ModelDescriptor{
			ModelId:           item.ModelID,
			Version:           item.Version,
			Status:            item.Status,
			Capabilities:      append([]string(nil), item.Capabilities...),
			CapabilityProfile: capabilityProfileFor(item.Capabilities),
			LogicalModelId:    projection.LogicalModelID,
			Family:            projection.Family,
			ArtifactRoles:     append([]string(nil), projection.ArtifactRoles...),
			PreferredEngine:   projection.PreferredEngine,
			FallbackEngines:   append([]string(nil), projection.FallbackEngines...),
			BundleState:       projection.BundleState,
			WarmState:         projection.WarmState,
			HostRequirements:  protoCloneHostRequirements(projection.HostRequirements),
		}
		if !item.LastHealthAt.IsZero() {
			desc.LastHealthAt = timestamppb.New(item.LastHealthAt)
		}
		out = append(out, desc)
	}
	return out, nil
}

func cloneEntry(input Entry) Entry {
	return Entry{
		ModelID:      input.ModelID,
		Version:      input.Version,
		Status:       input.Status,
		Capabilities: append([]string(nil), input.Capabilities...),
		Files:        append([]string(nil), input.Files...),
		LastHealthAt: input.LastHealthAt,
		Source:       input.Source,
		ProviderHint: input.ProviderHint,
	}
}

func protoCloneHostRequirements(input *runtimev1.LocalHostRequirements) *runtimev1.LocalHostRequirements {
	if input == nil {
		return nil
	}
	return &runtimev1.LocalHostRequirements{
		GpuRequired:           input.GetGpuRequired(),
		PythonRuntimeRequired: input.GetPythonRuntimeRequired(),
		SupportedPlatforms:    append([]string(nil), input.GetSupportedPlatforms()...),
		RequiredBackends:      append([]string(nil), input.GetRequiredBackends()...),
	}
}

func capabilityProfileFor(capabilities []string) *runtimev1.ModelCapabilityProfile {
	profile := &runtimev1.ModelCapabilityProfile{}
	for _, capability := range capabilities {
		switch strings.ToLower(strings.TrimSpace(capability)) {
		case "chat", "text.generate":
			profile.SupportsTextGenerate = true
		case "text.embed", "embed", "embedding":
			profile.SupportsEmbedding = true
		case "image.generate", "image.edit":
			profile.SupportsImageGeneration = true
			profile.SupportsAsyncMediaJob = true
		case "video.generate", "i2v":
			profile.SupportsVideoGeneration = true
			profile.SupportsAsyncMediaJob = true
		case "audio.synthesize", "tts", "speech":
			profile.SupportsSpeechSynthesis = true
		case "audio.transcribe", "stt", "transcription":
			profile.SupportsSpeechTranscription = true
		}
		if strings.Contains(strings.ToLower(strings.TrimSpace(capability)), "stream") {
			profile.SupportsStreaming = true
			profile.SupportsTextStream = true
		}
	}
	return profile
}

// InferCapabilities returns heuristic capability strings for a model ID.
// Exported so that both model and connector services can reuse it.
func InferCapabilities(modelID string) []string {
	seen := map[string]struct{}{}
	add := func(values ...string) {
		for _, value := range values {
			if _, ok := seen[value]; ok {
				continue
			}
			seen[value] = struct{}{}
		}
	}
	add("text.generate")
	lower := strings.ToLower(modelID)

	if strings.Contains(lower, "embed") {
		add("text.embed")
	}
	if strings.Contains(lower, "stt") || strings.Contains(lower, "whisper") {
		add("audio.transcribe")
	}
	if strings.Contains(lower, "tts") {
		add("audio.synthesize")
	}
	if strings.Contains(lower, "vision") || strings.Contains(lower, "vl") {
		add("text.generate.vision")
	}
	if strings.Contains(lower, "omni") {
		add("text.generate.vision", "text.generate.audio", "text.generate.video")
	}
	caps := make([]string, 0, len(seen))
	for capability := range seen {
		caps = append(caps, capability)
	}
	sort.Strings(caps)
	return caps
}

func inferProviderHint(modelID string, source string) ProviderHint {
	id := strings.ToLower(strings.TrimSpace(modelID))
	src := strings.ToLower(strings.TrimSpace(source))

	switch {
	case strings.HasPrefix(id, "local/"), src == "local":
		return ProviderHintLocal
	case strings.HasPrefix(id, "nimillm/"), src == "nimillm":
		return ProviderHintNimiLLM
	case strings.HasPrefix(id, "dashscope/"), src == "dashscope":
		return ProviderHintDashScope
	case strings.HasPrefix(id, "volcengine/"), strings.HasPrefix(id, "volcengine_openspeech/"), src == "volcengine", src == "volcengine_openspeech":
		return ProviderHintVolcengine
	case strings.HasPrefix(id, "gemini/"), src == "gemini":
		return ProviderHintGemini
	case strings.HasPrefix(id, "minimax/"), src == "minimax":
		return ProviderHintMiniMax
	case strings.HasPrefix(id, "kimi/"), src == "kimi":
		return ProviderHintKimi
	case strings.HasPrefix(id, "glm/"), src == "glm":
		return ProviderHintGLM
	default:
		return ProviderHintUnknown
	}
}
