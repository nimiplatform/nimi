package localservice

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const (
	modelAssetOfferRefPrefix     = "offer_"
	modelAssetModelLocatorPrefix = "model_"
)

type modelAssetOfferIdentity struct {
	sourceKind string
	locator    string
	revision   string
	entryID    string
}

type catalogOffer struct {
	identity         modelAssetOfferIdentity
	entryPath        string
	offerRef         string
	itemID           string
	templateID       string
	modelID          string
	title            string
	description      string
	categories       []string
	capabilities     []string
	modelType        string
	architecture     string
	format           string
	author           string
	files            []string
	hashes           map[string]string
	totalSizeBytes   int64
	license          string
	tags             []string
	downloads        int64
	likes            int64
	lastModified     string
	verified         bool
	sourceProvenance string
	hostRequirements *runtimev1.LocalHostRequirements
	featuredOrdinal  *int32
	editorialReason  string
}

func newModelAssetOfferRef(identity modelAssetOfferIdentity) (string, error) {
	normalized, err := normalizeModelAssetOfferIdentity(identity)
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal([]string{
		normalized.sourceKind,
		normalized.locator,
		normalized.revision,
		normalized.entryID,
	})
	if err != nil {
		return "", fmt.Errorf("encode ModelAsset offer identity: %w", err)
	}
	return modelAssetOfferRefPrefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func parseModelAssetOfferRef(value string) (modelAssetOfferIdentity, error) {
	rawValue := strings.TrimSpace(value)
	if !strings.HasPrefix(rawValue, modelAssetOfferRefPrefix) {
		return modelAssetOfferIdentity{}, fmt.Errorf("ModelAsset offer_ref is invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(rawValue, modelAssetOfferRefPrefix))
	if err != nil {
		return modelAssetOfferIdentity{}, fmt.Errorf("decode ModelAsset offer_ref: %w", err)
	}
	var parts []string
	if err := json.Unmarshal(raw, &parts); err != nil || len(parts) != 4 {
		return modelAssetOfferIdentity{}, fmt.Errorf("decode ModelAsset offer_ref tuple")
	}
	return normalizeModelAssetOfferIdentity(modelAssetOfferIdentity{
		sourceKind: parts[0],
		locator:    parts[1],
		revision:   parts[2],
		entryID:    parts[3],
	})
}

func newModelAssetModelLocator(sourceKind string, locator string, revision string) (string, error) {
	identity, err := normalizeModelAssetOfferIdentity(modelAssetOfferIdentity{
		sourceKind: sourceKind,
		locator:    locator,
		revision:   revision,
		entryID:    "_browse_only_",
	})
	if err != nil {
		return "", err
	}
	raw, err := json.Marshal([]string{identity.sourceKind, identity.locator, identity.revision})
	if err != nil {
		return "", fmt.Errorf("encode ModelAsset model locator: %w", err)
	}
	return modelAssetModelLocatorPrefix + base64.RawURLEncoding.EncodeToString(raw), nil
}

func parseModelAssetModelLocator(value string) (sourceKind string, locator string, revision string, err error) {
	rawValue := strings.TrimSpace(value)
	if !strings.HasPrefix(rawValue, modelAssetModelLocatorPrefix) {
		return "", "", "", fmt.Errorf("ModelAsset model_locator is invalid")
	}
	raw, err := base64.RawURLEncoding.DecodeString(strings.TrimPrefix(rawValue, modelAssetModelLocatorPrefix))
	if err != nil {
		return "", "", "", fmt.Errorf("decode ModelAsset model_locator: %w", err)
	}
	var parts []string
	if err := json.Unmarshal(raw, &parts); err != nil || len(parts) != 3 {
		return "", "", "", fmt.Errorf("decode ModelAsset model_locator tuple")
	}
	identity, err := normalizeModelAssetOfferIdentity(modelAssetOfferIdentity{
		sourceKind: parts[0],
		locator:    parts[1],
		revision:   parts[2],
		entryID:    "_browse_only_",
	})
	if err != nil {
		return "", "", "", err
	}
	return identity.sourceKind, identity.locator, identity.revision, nil
}

func normalizeModelAssetOfferIdentity(identity modelAssetOfferIdentity) (modelAssetOfferIdentity, error) {
	identity.sourceKind = strings.ToLower(strings.TrimSpace(identity.sourceKind))
	identity.locator = strings.TrimSpace(identity.locator)
	identity.revision = strings.TrimSpace(identity.revision)
	identity.entryID = strings.TrimSpace(identity.entryID)
	if identity.sourceKind == "" || identity.locator == "" || identity.revision == "" || identity.entryID == "" {
		return modelAssetOfferIdentity{}, fmt.Errorf("ModelAsset offer identity is incomplete")
	}
	if identity.sourceKind == "huggingface" {
		identity.revision = strings.ToLower(identity.revision)
		if !hfCommitRevisionPattern.MatchString(identity.revision) {
			return modelAssetOfferIdentity{}, fmt.Errorf("Hugging Face offer identity requires an immutable revision")
		}
	}
	return identity, nil
}

func (offer catalogOffer) clone() catalogOffer {
	offer.categories = append([]string(nil), offer.categories...)
	offer.capabilities = append([]string(nil), offer.capabilities...)
	offer.files = append([]string(nil), offer.files...)
	offer.hashes = cloneStringMap(offer.hashes)
	offer.tags = append([]string(nil), offer.tags...)
	offer.hostRequirements = cloneHostRequirements(offer.hostRequirements)
	if offer.featuredOrdinal != nil {
		ordinal := *offer.featuredOrdinal
		offer.featuredOrdinal = &ordinal
	}
	return offer
}

func (s *Service) projectMarketCandidate(offer catalogOffer) *runtimev1.ModelAssetMarketCandidate {
	installedModelAssetID := s.catalogOfferInstalledAssetID(offer)
	result := &runtimev1.ModelAssetMarketCandidate{
		OfferRef:        offer.offerRef,
		SourceLabel:     offer.identity.sourceKind,
		Title:           defaultString(offer.title, offer.identity.locator),
		Description:     strings.TrimSpace(offer.description),
		Categories:      normalizeStringSlice(offer.categories),
		ModelType:       strings.TrimSpace(offer.modelType),
		VariantLabel:    offer.entryPath,
		Format:          strings.TrimSpace(offer.format),
		Author:          defaultString(strings.TrimSpace(offer.author), catalogLocatorOwner(offer.identity.locator)),
		TotalSizeBytes:  offer.totalSizeBytes,
		License:         strings.TrimSpace(offer.license),
		Tags:            normalizeStringSlice(offer.tags),
		Downloads:       offer.downloads,
		Likes:           offer.likes,
		LastModified:    strings.TrimSpace(offer.lastModified),
		Verified:        offer.verified,
		Installed:       installedModelAssetID != "",
		Installable:     catalogOfferInstallable(offer),
		EditorialReason: strings.TrimSpace(offer.editorialReason),
	}
	if offer.featuredOrdinal != nil {
		ordinal := *offer.featuredOrdinal
		result.FeaturedOrdinal = &ordinal
	}
	return result
}

func (s *Service) catalogOfferInstalled(offer catalogOffer) bool {
	return s.catalogOfferInstalledAssetID(offer) != ""
}

func (s *Service) catalogOfferInstalledAssetID(offer catalogOffer) string {
	files := make([]*runtimev1.ModelAssetFile, 0, len(offer.files))
	for _, path := range offer.files {
		hash := normalizeExactSHA256Hex(offer.hashes[path])
		if hash == "" {
			return ""
		}
		files = append(files, &runtimev1.ModelAssetFile{RelativePath: path, Sha256: hash})
	}
	if len(files) == 0 {
		return ""
	}
	contentID := modelAssetContentID(files)
	if contentID == "" {
		return ""
	}
	matches := make([]string, 0)
	for _, asset := range s.installedModelAssetsSnapshot() {
		if asset != nil && strings.EqualFold(strings.TrimSpace(asset.GetContentId()), contentID) {
			matches = append(matches, strings.TrimSpace(asset.GetModelAssetId()))
		}
	}
	sort.Strings(matches)
	if len(matches) == 0 {
		return ""
	}
	return matches[0]
}

func (s *Service) installedModelAssetsSnapshot() []*runtimev1.ModelAssetRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items := make([]*runtimev1.ModelAssetRecord, 0, len(s.modelAssets))
	for _, asset := range s.modelAssets {
		if asset != nil {
			items = append(items, cloneModelAsset(asset))
		}
	}
	return items
}

func catalogOfferInstallable(offer catalogOffer) bool {
	if strings.TrimSpace(offer.offerRef) == "" || strings.TrimSpace(offer.entryPath) == "" || len(offer.files) == 0 ||
		marketOfferAssetKind(offer) == runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return false
	}
	for _, file := range offer.files {
		if normalizeExactSHA256Hex(offer.hashes[file]) == "" {
			return false
		}
	}
	return true
}

func marketOfferAssetKind(offer catalogOffer) runtimev1.LocalAssetKind {
	if kind := inferAssetKindFromCapabilities(offer.capabilities); kind != runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED {
		return kind
	}
	if kind, err := verifiedAssetKindForPassiveModel(offer.modelType); err == nil {
		return kind
	}
	switch strings.ToLower(strings.TrimSpace(offer.modelType)) {
	case "image":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_IMAGE
	case "video":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO
	case "chat", "llm":
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_CHAT
	default:
		return runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_UNSPECIFIED
	}
}

func catalogLocatorOwner(locator string) string {
	owner, _, found := strings.Cut(strings.TrimSpace(locator), "/")
	if !found {
		return ""
	}
	return strings.TrimSpace(owner)
}

func catalogOfferFormat(entry string) string {
	lower := strings.ToLower(strings.TrimSpace(entry))
	switch {
	case strings.HasSuffix(lower, ".gguf"):
		return "gguf"
	case strings.HasSuffix(lower, ".safetensors"):
		return "safetensors"
	default:
		return ""
	}
}

func canonicalOfferFacts(offer catalogOffer) []string {
	files := append([]string(nil), offer.files...)
	sort.Strings(files)
	facts := []string{
		offer.identity.sourceKind,
		offer.identity.locator,
		offer.identity.revision,
		offer.identity.entryID,
		offer.entryPath,
		fmt.Sprintf("%d", offer.totalSizeBytes),
	}
	for _, file := range files {
		facts = append(facts, file, normalizeExactSHA256Hex(offer.hashes[file]))
	}
	return facts
}
