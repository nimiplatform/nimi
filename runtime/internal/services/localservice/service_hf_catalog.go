package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	hfCatalogEndpoint     = "https://huggingface.co/api/models"
	hfCatalogTimeout      = 20 * time.Second
	hfCatalogDefaultLimit = 50
	hfCatalogMinLimit     = 1
	hfCatalogMaxLimit     = 80
)

type hfCatalogSearchRequest struct {
	Query          string
	Capability     string
	CategoryFilter string
	EngineFilter   string
	Limit          int32
}

type hfCatalogSearchFunc func(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error)

type hfModelSearchEntry struct {
	ID           string         `json:"id"`
	ModelID      string         `json:"modelId"`
	PipelineTag  string         `json:"pipeline_tag"`
	Tags         []string       `json:"tags"`
	Likes        int64          `json:"likes"`
	Downloads    int64          `json:"downloads"`
	LastModified string         `json:"lastModified"`
	Sha          string         `json:"sha"`
	CardData     map[string]any `json:"cardData"`
}

func (s *Service) searchHFCatalog(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
	s.mu.RLock()
	searchFn := s.hfCatalogSearch
	s.mu.RUnlock()
	if searchFn == nil {
		searchFn = defaultHFCatalogSearch
	}
	return searchFn(ctx, req)
}

func defaultHFCatalogSearch(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
	query, err := normalizeHFSearchQuery(req.Query)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errHfRepoInvalid, err)
	}

	limit := req.Limit
	if limit <= 0 {
		limit = hfCatalogDefaultLimit
	}
	if limit < hfCatalogMinLimit {
		limit = hfCatalogMinLimit
	}
	if limit > hfCatalogMaxLimit {
		limit = hfCatalogMaxLimit
	}

	params := url.Values{}
	if strings.TrimSpace(query) != "" {
		params.Set("search", strings.TrimSpace(query))
	}
	if pipelineTag := pipelineTagFromCapability(req.Capability); pipelineTag != "" {
		params.Set("pipeline_tag", pipelineTag)
	}
	params.Set("library", "gguf")
	params.Set("limit", fmt.Sprintf("%d", limit))

	u, _ := url.Parse(hfCatalogEndpoint)
	u.RawQuery = params.Encode()

	requestCtx, cancel := context.WithTimeout(ctx, hfCatalogTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(requestCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build hf request: %w", err)
	}
	resp, err := (&http.Client{Timeout: hfCatalogTimeout}).Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("hf request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf request status=%d", resp.StatusCode)
	}

	var rows []hfModelSearchEntry
	if err := json.NewDecoder(resp.Body).Decode(&rows); err != nil {
		return nil, fmt.Errorf("decode hf response: %w", err)
	}

	items := make([]*runtimev1.LocalCatalogModelDescriptor, 0, len(rows))
	for _, row := range rows {
		item, ok := mapHFRowToCatalogItem(row, req.EngineFilter)
		if !ok {
			continue
		}
		items = append(items, item)
	}
	return items, nil
}

var errHfRepoInvalid = fmt.Errorf("hf repo invalid")

func normalizeHFSearchQuery(query string) (string, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return "", nil
	}
	if strings.HasPrefix(strings.ToLower(q), "hf://") {
		repo, err := normalizeHFRepo(q)
		if err != nil {
			return "", err
		}
		return repo, nil
	}
	if strings.HasPrefix(strings.ToLower(q), "https://huggingface.co/") || strings.HasPrefix(strings.ToLower(q), "http://huggingface.co/") {
		repo, err := normalizeHFRepo(q)
		if err != nil {
			return "", err
		}
		return repo, nil
	}
	return q, nil
}

func normalizeHFRepo(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return "", fmt.Errorf("empty repo")
	}

	lower := strings.ToLower(value)
	switch {
	case strings.HasPrefix(lower, "hf://"):
		value = strings.TrimSpace(value[len("hf://"):])
	case strings.HasPrefix(lower, "https://") || strings.HasPrefix(lower, "http://"):
		u, err := url.Parse(value)
		if err != nil {
			return "", err
		}
		if !strings.EqualFold(strings.TrimSpace(u.Host), "huggingface.co") {
			return "", fmt.Errorf("unsupported host %q", u.Host)
		}
		segments := splitPathSegments(u.Path)
		switch {
		case len(segments) >= 3 && strings.EqualFold(segments[0], "models"):
			value = segments[1] + "/" + segments[2]
		case len(segments) >= 2:
			value = segments[0] + "/" + segments[1]
		default:
			return "", fmt.Errorf("repo path missing")
		}
	default:
		// Keep user-supplied org/model format.
	}

	value = strings.Trim(strings.TrimSpace(value), "/")
	if strings.Count(value, "/") != 1 {
		return "", fmt.Errorf("repo format must be org/model")
	}
	parts := strings.SplitN(value, "/", 2)
	if strings.TrimSpace(parts[0]) == "" || strings.TrimSpace(parts[1]) == "" {
		return "", fmt.Errorf("repo format must be org/model")
	}
	return parts[0] + "/" + parts[1], nil
}

func splitPathSegments(p string) []string {
	raw := strings.Split(strings.TrimSpace(p), "/")
	out := make([]string, 0, len(raw))
	for _, item := range raw {
		segment := strings.TrimSpace(item)
		if segment == "" {
			continue
		}
		out = append(out, segment)
	}
	return out
}

func pipelineTagFromCapability(capability string) string {
	switch strings.ToLower(strings.TrimSpace(capability)) {
	case "chat":
		return "text-generation"
	case "image":
		return "text-to-image"
	case "video":
		return "text-to-video"
	case "tts":
		return "text-to-speech"
	case "stt":
		return "automatic-speech-recognition"
	case "embedding":
		return "feature-extraction"
	default:
		return ""
	}
}

func inferCapabilitiesFromHF(pipelineTag string, tags []string) []string {
	caps := make([]string, 0, 2)
	appendCap := func(pipeline string) {
		switch strings.ToLower(strings.TrimSpace(pipeline)) {
		case "text-generation", "text2text-generation":
			caps = append(caps, "chat")
		case "text-to-image":
			caps = append(caps, "image")
		case "text-to-video":
			caps = append(caps, "video")
		case "text-to-speech", "text-to-audio":
			caps = append(caps, "tts")
		case "automatic-speech-recognition":
			caps = append(caps, "stt")
		case "feature-extraction", "sentence-similarity":
			caps = append(caps, "embedding")
		}
	}

	appendCap(pipelineTag)
	for _, tag := range tags {
		appendCap(tag)
	}
	caps = normalizeStringSlice(caps)
	if len(caps) == 0 {
		return []string{"chat"}
	}
	return caps
}

func mapHFRowToCatalogItem(row hfModelSearchEntry, engineFilter string) (*runtimev1.LocalCatalogModelDescriptor, bool) {
	repoRaw := defaultString(strings.TrimSpace(row.ID), strings.TrimSpace(row.ModelID))
	repo, err := normalizeHFRepo(repoRaw)
	if err != nil {
		return nil, false
	}
	capabilities := inferCapabilitiesFromHF(row.PipelineTag, row.Tags)
	engine := strings.ToLower(defaultLocalEngine(strings.TrimSpace(engineFilter), capabilities))
	endpoint := ""
	if !engineRequiresExplicitEndpoint(engine) {
		endpoint = defaultEndpointForEngine(engine)
	}
	tags := normalizeStringSlice(append(append([]string(nil), row.Tags...), capabilities...))
	license := ""
	if row.CardData != nil {
		if raw, ok := row.CardData["license"].(string); ok {
			license = strings.TrimSpace(raw)
		}
	}
	if license == "" {
		license = "unknown"
	}
	return &runtimev1.LocalCatalogModelDescriptor{
		ItemId:            "hf_" + slug(repo),
		Source:            "huggingface",
		Title:             repo,
		Description:       "HuggingFace model",
		ModelId:           repo,
		Repo:              repo,
		Revision:          defaultString(strings.TrimSpace(row.Sha), "main"),
		TemplateId:        "",
		Capabilities:      capabilities,
		Engine:            engine,
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_ATTACHED_ENDPOINT,
		InstallKind:       "download",
		InstallAvailable:  true,
		Endpoint:          endpoint,
		ProviderHints:     nil,
		Entry:             "./dist/index.js",
		Files:             []string{},
		License:           license,
		Hashes:            map[string]string{},
		Tags:              tags,
		Downloads:         row.Downloads,
		Likes:             row.Likes,
		LastModified:      strings.TrimSpace(row.LastModified),
		Verified:          false,
	}, true
}
