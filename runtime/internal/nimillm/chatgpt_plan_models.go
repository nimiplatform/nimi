package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const (
	chatGPTPlanEndpoint       = "https://api.openai.com/v1"
	chatGPTPlanModelListLimit = 4 << 20
	// chatGPTPlanInventoryTTL bounds how long one credential's account model
	// list is reused before inference reads it again.
	chatGPTPlanInventoryTTL        = 2 * time.Minute
	chatGPTPlanInventoryMaxEntries = 32
)

// ChatGPTPlanModel is a safe, account-scoped model-list projection. It does not
// establish Nimi behavior support; callers still intersect it with exact
// reviewed Runtime targets and modes.
type ChatGPTPlanModel struct {
	ID          string
	DisplayName string
}

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-connector-route
// DiscoverChatGPTPlanModels reads the selected account's official SIWC model
// list with the same request-scoped bearer token that inference will consume.
func (p *CloudProvider) DiscoverChatGPTPlanModels(ctx context.Context, target *RemoteTarget) ([]ChatGPTPlanModel, error) {
	if target == nil || target.ProviderType != "openai_chatgpt_plan" || !chatGPTPlanTargetEndpointAllowed(target, p.allowLoopbackEndpoint) {
		return nil, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	if strings.TrimSpace(target.APIKey) == "" {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_CREDENTIAL_MISSING)
	}
	backend := p.backendFromTarget(target)
	if backend == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	request, err := backend.newRequest(ctx, http.MethodGet, backend.baseURL+"/v1/models", nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	response, err := backend.do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(response.Body, chatGPTPlanErrorBodyLimit))
		return nil, chatGPTPlanHTTPError(response.StatusCode, body)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, chatGPTPlanModelListLimit+1))
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	if len(body) > chatGPTPlanModelListLimit {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	var inventory struct {
		Models []struct {
			Slug        string `json:"slug"`
			DisplayName string `json:"display_name"`
			Visibility  string `json:"visibility"`
		} `json:"models"`
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	if decoder.Decode(&inventory) != nil || decoder.Decode(new(any)) != io.EOF || inventory.Models == nil {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	models := make([]ChatGPTPlanModel, 0, len(inventory.Models))
	seen := make(map[string]struct{}, len(inventory.Models))
	for _, item := range inventory.Models {
		if item.Visibility != "list" {
			continue
		}
		id := strings.TrimSpace(item.Slug)
		if id == "" || id != item.Slug || len(id) > 160 || !validChatGPTPlanModelID(id) {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		if _, duplicate := seen[id]; duplicate {
			return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		seen[id] = struct{}{}
		label := strings.TrimSpace(item.DisplayName)
		if label == "" || len(label) > 240 {
			label = id
		}
		models = append(models, ChatGPTPlanModel{ID: id, DisplayName: label})
	}
	return models, nil
}

// chatGPTPlanInventoryCache reuses one credential's list-visible model slugs
// for a short time. Entries are keyed by a digest of the request token, so the
// token itself is never retained.
type chatGPTPlanInventoryCache struct {
	mu      sync.Mutex
	entries map[[sha256.Size]byte]chatGPTPlanInventoryEntry
	now     func() time.Time
}

type chatGPTPlanInventoryEntry struct {
	models  map[string]struct{}
	expires time.Time
}

func newChatGPTPlanInventoryCache() *chatGPTPlanInventoryCache {
	return &chatGPTPlanInventoryCache{entries: map[[sha256.Size]byte]chatGPTPlanInventoryEntry{}, now: time.Now}
}

func (cache *chatGPTPlanInventoryCache) lookup(key [sha256.Size]byte) (map[string]struct{}, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	entry, ok := cache.entries[key]
	if !ok || !cache.now().Before(entry.expires) {
		delete(cache.entries, key)
		return nil, false
	}
	return entry.models, true
}

func (cache *chatGPTPlanInventoryCache) store(key [sha256.Size]byte, models map[string]struct{}) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	now := cache.now()
	for existing, entry := range cache.entries {
		if !now.Before(entry.expires) || len(cache.entries) >= chatGPTPlanInventoryMaxEntries {
			delete(cache.entries, existing)
		}
	}
	cache.entries[key] = chatGPTPlanInventoryEntry{models: models, expires: now.Add(chatGPTPlanInventoryTTL)}
}

// @nimi-authority: rule.nimi.runtime.ai-provider.chatgpt-plan-connector-route
// ChatGPTPlanAccountModels returns the current account's list-visible model
// slugs for one request credential, reusing a recent inventory read with the
// same credential. The same fact admits dispatch and projects configuration
// availability; callers must treat the returned set as read-only.
func (p *CloudProvider) ChatGPTPlanAccountModels(ctx context.Context, target *RemoteTarget) (map[string]struct{}, error) {
	key := sha256.Sum256([]byte(target.APIKey))
	cache := p.chatGPTPlanInventory
	if cache != nil {
		if models, cached := cache.lookup(key); cached {
			return models, nil
		}
	}
	listed, err := p.DiscoverChatGPTPlanModels(ctx, target)
	if err != nil {
		return nil, err
	}
	models := make(map[string]struct{}, len(listed))
	for _, model := range listed {
		models[model.ID] = struct{}{}
	}
	if cache != nil {
		cache.store(key, models)
	}
	return models, nil
}

// requireChatGPTPlanAccountModel admits an exact reviewed target only while
// the current account's list-visible inventory offers it. A missing model
// fails typed before any Responses dispatch and is never replaced.
func (p *CloudProvider) requireChatGPTPlanAccountModel(ctx context.Context, target *RemoteTarget, modelID string) error {
	models, err := p.ChatGPTPlanAccountModels(ctx, target)
	if err != nil {
		return err
	}
	if _, offered := models[modelID]; offered {
		return nil
	}
	return grpcerr.WithReasonCodeOptions(codes.NotFound, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND, grpcerr.ReasonOptions{
		ActionHint: "select_available_model",
		Message:    "the signed-in ChatGPT plan account does not list this model",
	})
}

func chatGPTPlanTargetEndpointAllowed(target *RemoteTarget, allowLoopback bool) bool {
	if target == nil {
		return false
	}
	if target.Endpoint == chatGPTPlanEndpoint {
		return true
	}
	if !allowLoopback && !target.AllowLoopback {
		return false
	}
	parsed, err := url.Parse(target.Endpoint)
	return err == nil && parsed.Scheme == "http" && parsed.Hostname() == "127.0.0.1" && parsed.User == nil && parsed.RawQuery == "" && parsed.Fragment == "" && parsed.Path == ""
}

func validChatGPTPlanModelID(id string) bool {
	for _, char := range id {
		if char >= 'a' && char <= 'z' || char >= '0' && char <= '9' || char == '-' || char == '_' || char == '.' {
			continue
		}
		return false
	}
	return true
}
