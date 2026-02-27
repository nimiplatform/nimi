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
	ProviderHintUnknown   ProviderHint = "unknown"
	ProviderHintLocal     ProviderHint = "local"
	ProviderHintNimiLLM   ProviderHint = "nimillm"
	ProviderHintAlibaba   ProviderHint = "alibaba"
	ProviderHintBytedance ProviderHint = "bytedance"
	ProviderHintGemini    ProviderHint = "gemini"
	ProviderHintMiniMax   ProviderHint = "minimax"
	ProviderHintKimi      ProviderHint = "kimi"
	ProviderHintGLM       ProviderHint = "glm"
)

// Entry is a model registry record used by runtime services.
type Entry struct {
	ModelID      string
	Version      string
	Status       runtimev1.ModelStatus
	Capabilities []string
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

func (r *Registry) ListDescriptors() []*runtimev1.ModelDescriptor {
	entries := r.List()
	out := make([]*runtimev1.ModelDescriptor, 0, len(entries))
	for _, item := range entries {
		desc := &runtimev1.ModelDescriptor{
			ModelId:      item.ModelID,
			Version:      item.Version,
			Status:       item.Status,
			Capabilities: append([]string(nil), item.Capabilities...),
		}
		if !item.LastHealthAt.IsZero() {
			desc.LastHealthAt = timestamppb.New(item.LastHealthAt)
		}
		out = append(out, desc)
	}
	return out
}

func cloneEntry(input Entry) Entry {
	return Entry{
		ModelID:      input.ModelID,
		Version:      input.Version,
		Status:       input.Status,
		Capabilities: append([]string(nil), input.Capabilities...),
		LastHealthAt: input.LastHealthAt,
		Source:       input.Source,
		ProviderHint: input.ProviderHint,
	}
}

func inferProviderHint(modelID string, source string) ProviderHint {
	id := strings.ToLower(strings.TrimSpace(modelID))
	src := strings.ToLower(strings.TrimSpace(source))

	switch {
	case strings.HasPrefix(id, "local/"), src == "local":
		return ProviderHintLocal
	case strings.HasPrefix(id, "nimillm/"), src == "nimillm":
		return ProviderHintNimiLLM
	case strings.HasPrefix(id, "aliyun/"), strings.HasPrefix(id, "alibaba/"), src == "aliyun", src == "alibaba":
		return ProviderHintAlibaba
	case strings.HasPrefix(id, "bytedance/"), strings.HasPrefix(id, "byte/"), src == "bytedance", src == "byte":
		return ProviderHintBytedance
	case strings.HasPrefix(id, "gemini/"), src == "gemini":
		return ProviderHintGemini
	case strings.HasPrefix(id, "minimax/"), src == "minimax":
		return ProviderHintMiniMax
	case strings.HasPrefix(id, "kimi/"), strings.HasPrefix(id, "moonshot/"), src == "kimi", src == "moonshot":
		return ProviderHintKimi
	case strings.HasPrefix(id, "glm/"), strings.HasPrefix(id, "zhipu/"), strings.HasPrefix(id, "bigmodel/"), src == "glm", src == "zhipu", src == "bigmodel":
		return ProviderHintGLM
	default:
		return ProviderHintUnknown
	}
}
