package localservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"sort"
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
	hfCatalogMaxBodyBytes = 4 << 20
)

var hfCommitRevisionPattern = regexp.MustCompile(`^[0-9a-f]{40}$`)

type hfCatalogSearchRequest struct {
	Query          string
	Capability     string
	CategoryFilter string
	EngineFilter   string
	Limit          int32
}

type hfCatalogSearchFunc func(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error)
type hfCatalogVariantsFunc func(ctx context.Context, repo string, revision string) ([]hfCatalogVariant, error)

type hfCatalogVariant struct {
	Filename     string
	Entry        string
	Files        []string
	Hashes       map[string]string
	Format       string
	SizeBytes    int64
	SHA256       string
	Revision     string
	Title        string
	Description  string
	Categories   []string
	Capabilities []string
	ModelType    string
	License      string
	Tags         []string
	Downloads    int64
	Likes        int64
	LastModified string
}

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

type hfModelDetails struct {
	ID           string           `json:"id"`
	ModelID      string           `json:"modelId"`
	Sha          string           `json:"sha"`
	PipelineTag  string           `json:"pipeline_tag"`
	Tags         []string         `json:"tags"`
	Downloads    int64            `json:"downloads"`
	Likes        int64            `json:"likes"`
	LastModified string           `json:"lastModified"`
	CardData     map[string]any   `json:"cardData"`
	Siblings     []hfModelSibling `json:"siblings"`
}

type hfModelSibling struct {
	Rfilename string             `json:"rfilename"`
	Lfs       *hfModelSiblingLFS `json:"lfs"`
}

type hfModelSiblingLFS struct {
	Size   int64  `json:"size"`
	Sha256 string `json:"sha256"`
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

func (s *Service) listHFCatalogVariants(ctx context.Context, repo string, revision string) ([]hfCatalogVariant, error) {
	s.mu.RLock()
	variantsFn := s.hfCatalogVariants
	s.mu.RUnlock()
	if variantsFn == nil {
		variantsFn = defaultHFCatalogVariants
	}
	return variantsFn(ctx, repo, revision)
}

func defaultHFCatalogSearch(ctx context.Context, req hfCatalogSearchRequest) ([]*runtimev1.LocalCatalogModelDescriptor, error) {
	u, err := hfCatalogSearchURL(req)
	if err != nil {
		return nil, err
	}
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
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf request status=%d", resp.StatusCode)
	}

	var rows []hfModelSearchEntry
	if err := json.NewDecoder(io.LimitReader(resp.Body, hfCatalogMaxBodyBytes)).Decode(&rows); err != nil {
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

func hfCatalogSearchURL(req hfCatalogSearchRequest) (*url.URL, error) {
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
	capability := req.Capability
	if capability == "" {
		capability = capabilityForMarketCategory(req.CategoryFilter)
	}
	if pipelineTag := pipelineTagFromCapability(capability); pipelineTag != "" {
		params.Set("pipeline_tag", pipelineTag)
	}
	for _, field := range []string{"sha", "pipeline_tag", "tags", "downloads", "likes", "lastModified", "cardData"} {
		params.Add("expand[]", field)
	}
	params.Set("limit", fmt.Sprintf("%d", limit))

	u, _ := url.Parse(hfCatalogEndpoint)
	u.RawQuery = params.Encode()
	return u, nil
}

func capabilityForMarketCategory(category string) string {
	switch strings.ToLower(strings.TrimSpace(category)) {
	case "image":
		return "image.generate"
	case "video":
		return "video.generate"
	case "chat":
		return "text.generate"
	default:
		return ""
	}
}

func defaultHFCatalogVariants(ctx context.Context, repoRaw string, revisionRaw string) ([]hfCatalogVariant, error) {
	return fetchHFCatalogVariants(ctx, hfCatalogEndpoint, repoRaw, revisionRaw)
}

func fetchHFCatalogVariants(ctx context.Context, endpoint string, repoRaw string, revisionRaw string) ([]hfCatalogVariant, error) {
	u, _, revision, err := hfCatalogVariantsURLAt(endpoint, repoRaw, revisionRaw)
	if err != nil {
		return nil, err
	}

	requestCtx, cancel := context.WithTimeout(ctx, hfCatalogTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(requestCtx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("build hf variants request: %w", err)
	}
	resp, err := (&http.Client{Timeout: hfCatalogTimeout}).Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("hf variants request failed: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("hf variants request status=%d", resp.StatusCode)
	}

	var details hfModelDetails
	if err := json.NewDecoder(io.LimitReader(resp.Body, hfCatalogMaxBodyBytes)).Decode(&details); err != nil {
		return nil, fmt.Errorf("decode hf variants response: %w", err)
	}
	resolvedRevision := strings.TrimSpace(details.Sha)
	if resolvedRevision == "" {
		return nil, fmt.Errorf("hf variants response is missing source revision")
	}
	if revision != "main" && resolvedRevision != revision {
		return nil, fmt.Errorf("hf variants source revision changed")
	}
	variants := listHFCatalogVariantsFromDetails(&details)
	capabilities := inferCapabilitiesFromHF(details.PipelineTag, details.Tags)
	categories := capabilityCategories(capabilities)
	modelType := catalogModelTypeForAssetKind(inferAssetKindFromCapabilities(capabilities))
	license := "unknown"
	if raw, ok := details.CardData["license"].(string); ok && strings.TrimSpace(raw) != "" {
		license = strings.TrimSpace(raw)
	}
	for index := range variants {
		variants[index].Revision = resolvedRevision
		variants[index].Title = defaultString(strings.TrimSpace(details.ModelID), strings.TrimSpace(details.ID))
		variants[index].Description = "Hugging Face model"
		variants[index].Categories = append([]string(nil), categories...)
		variants[index].Capabilities = append([]string(nil), capabilities...)
		variants[index].ModelType = modelType
		variants[index].License = license
		variants[index].Tags = normalizeStringSlice(details.Tags)
		variants[index].Downloads = details.Downloads
		variants[index].Likes = details.Likes
		variants[index].LastModified = strings.TrimSpace(details.LastModified)
	}
	return variants, nil
}

func hfCatalogVariantsURL(repoRaw string, revisionRaw string) (*url.URL, string, string, error) {
	return hfCatalogVariantsURLAt(hfCatalogEndpoint, repoRaw, revisionRaw)
}

func hfCatalogVariantsURLAt(endpoint string, repoRaw string, revisionRaw string) (*url.URL, string, string, error) {
	repo, err := normalizeHFRepo(repoRaw)
	if err != nil {
		return nil, "", "", fmt.Errorf("%w: %v", errHfRepoInvalid, err)
	}
	revision := strings.ToLower(strings.TrimSpace(revisionRaw))
	if !hfCommitRevisionPattern.MatchString(revision) {
		return nil, "", "", fmt.Errorf("%w: immutable revision is required", errHfRepoInvalid)
	}
	base, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || base.Scheme == "" || base.Host == "" {
		return nil, "", "", fmt.Errorf("%w: endpoint is invalid", errHfRepoInvalid)
	}
	base.Path = strings.TrimSuffix(base.Path, "/") + "/" + repo + "/revision/" + revision
	params := base.Query()
	params.Set("blobs", "true")
	base.RawQuery = params.Encode()
	return base, repo, revision, nil
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
	switch normalizeLocalCapabilityToken(capability) {
	case "chat", "text.generate":
		return "text-generation"
	case "image", "image.generate":
		return "text-to-image"
	case "video", "video.generate":
		return "text-to-video"
	case "tts", "audio.synthesize":
		return "text-to-speech"
	case "stt", "audio.transcribe":
		return "automatic-speech-recognition"
	case "embedding", "text.embed":
		return "feature-extraction"
	default:
		return ""
	}
}

func inferCapabilitiesFromHF(pipelineTag string, tags []string) []string {
	caps := make([]string, 0, 2)
	appendCap := func(pipeline string) {
		switch strings.ToLower(strings.TrimSpace(pipeline)) {
		case "text-generation", "text2text-generation", "image-text-to-text", "visual-question-answering":
			caps = append(caps, "text.generate")
		case "text-to-image", "image-to-image":
			caps = append(caps, "image.generate")
		case "text-to-video", "image-to-video":
			caps = append(caps, "video.generate")
		case "text-to-speech", "text-to-audio":
			caps = append(caps, "audio.synthesize")
		case "automatic-speech-recognition":
			caps = append(caps, "audio.transcribe")
		case "feature-extraction", "sentence-similarity":
			caps = append(caps, "text.embed")
		}
	}

	appendCap(pipelineTag)
	for _, tag := range tags {
		appendCap(tag)
	}
	caps = normalizeAssetCapabilities(caps)
	if len(caps) == 0 {
		return nil
	}
	return caps
}

func mapHFRowToCatalogItem(row hfModelSearchEntry, _ string) (*runtimev1.LocalCatalogModelDescriptor, bool) {
	repoRaw := defaultString(strings.TrimSpace(row.ID), strings.TrimSpace(row.ModelID))
	repo, err := normalizeHFRepo(repoRaw)
	if err != nil {
		return nil, false
	}
	revision := strings.ToLower(strings.TrimSpace(row.Sha))
	if !hfCommitRevisionPattern.MatchString(revision) {
		return nil, false
	}
	capabilities := inferCapabilitiesFromHF(row.PipelineTag, row.Tags)
	kind := inferAssetKindFromCapabilities(capabilities)
	if len(capabilities) == 0 || kind == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return nil, false
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
		Revision:          revision,
		TemplateId:        "",
		Capabilities:      capabilities,
		Engine:            "",
		EngineRuntimeMode: runtimev1.LocalEngineRuntimeMode_LOCAL_ENGINE_RUNTIME_MODE_UNSPECIFIED,
		InstallKind:       "download",
		InstallAvailable:  false,
		Endpoint:          "",
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
		ModelType:         catalogModelTypeForAssetKind(kind),
	}, true
}

func listHFCatalogVariantsFromDetails(details *hfModelDetails) []hfCatalogVariant {
	if details == nil {
		return nil
	}
	capabilities := inferCapabilitiesFromHF(details.PipelineTag, details.Tags)
	if len(capabilities) == 0 {
		return nil
	}
	variants := make([]hfCatalogVariant, 0, len(details.Siblings))
	for _, sibling := range details.Siblings {
		entry, ok := normalizeHFFilePath(sibling.Rfilename)
		if !ok {
			continue
		}
		lower := strings.ToLower(entry)
		if !strings.HasSuffix(lower, ".gguf") && !strings.HasSuffix(lower, ".safetensors") {
			continue
		}
		format := variantFormatForEntry(entry)
		files := []string(nil)
		hashes := map[string]string(nil)
		var sizeBytes int64
		sha256 := ""
		if sibling.Lfs != nil {
			sizeBytes = sibling.Lfs.Size
			sha256 = strings.TrimSpace(sibling.Lfs.Sha256)
		}
		if format == "gguf" && sibling.Lfs != nil {
			files = []string{entry}
			hashes = hfCatalogFileHashes(details.Siblings)
		}
		variants = append(variants, hfCatalogVariant{
			Filename:  entry,
			Entry:     entry,
			Files:     files,
			Hashes:    hashes,
			Format:    format,
			SizeBytes: sizeBytes,
			SHA256:    sha256,
		})
	}
	sort.Slice(variants, func(i, j int) bool {
		if (variants[i].SizeBytes == 0) != (variants[j].SizeBytes == 0) {
			return variants[i].SizeBytes != 0
		}
		if variants[i].SizeBytes != variants[j].SizeBytes {
			return variants[i].SizeBytes < variants[j].SizeBytes
		}
		return variants[i].Filename < variants[j].Filename
	})
	return variants
}

func hfCatalogFileHashes(siblings []hfModelSibling) map[string]string {
	hashes := make(map[string]string)
	for _, sibling := range siblings {
		path, ok := normalizeHFFilePath(sibling.Rfilename)
		if !ok || sibling.Lfs == nil {
			continue
		}
		if hash := normalizeExactSHA256Hex(sibling.Lfs.Sha256); hash != "" {
			hashes[path] = hash
		}
	}
	return hashes
}

func variantFormatForEntry(entry string) string {
	lower := strings.ToLower(strings.TrimSpace(entry))
	switch {
	case strings.HasSuffix(lower, ".gguf"):
		return "gguf"
	case strings.HasSuffix(lower, ".safetensors"):
		return "safetensors"
	default:
		return "unknown"
	}
}

func normalizeHFFilePath(value string) (string, bool) {
	normalized := strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if normalized == "" || strings.HasPrefix(normalized, "/") {
		return "", false
	}
	for _, segment := range strings.Split(normalized, "/") {
		if segment == ".." {
			return "", false
		}
	}
	return normalized, true
}
