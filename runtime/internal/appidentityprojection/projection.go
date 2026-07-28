// Package appidentityprojection consumes the Platform-owned app identity
// projection used by Runtime to recognize bundled local first-party callers.
package appidentityprojection

import (
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"

	"gopkg.in/yaml.v3"
)

const (
	localFirstPartyCallerMode = "local-first-party"
	expectedTableFamily       = "product_catalog"
	expectedOwner             = "platform"
	expectedCatalogID         = "platform_nimi_app_identity_surfaces"
)

var canonicalAppIDPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$`)

type rawProjection struct {
	Version     int      `yaml:"version"`
	TableFamily string   `yaml:"table_family"`
	Owner       string   `yaml:"owner"`
	CatalogID   string   `yaml:"catalog_id"`
	Apps        []rawApp `yaml:"apps"`
}

type rawApp struct {
	CanonicalAppID    string `yaml:"canonical_app_id"`
	RuntimeAppID      string `yaml:"runtime_app_id"`
	RuntimeCallerMode string `yaml:"runtime_caller_mode"`
}

// Projection contains only identities explicitly marked local-first-party.
// Other catalog rows are intentionally not projected into Runtime admission.
type Projection struct {
	localFirstPartyAppIDs map[string]struct{}
}

// NewLocalFirstParty builds an immutable projection for owner tests.
func NewLocalFirstParty(appIDs ...string) (*Projection, error) {
	projection := &Projection{localFirstPartyAppIDs: make(map[string]struct{}, len(appIDs))}
	for _, appID := range appIDs {
		if err := projection.addLocalFirstParty(appID, appID); err != nil {
			return nil, err
		}
	}
	return projection, nil
}

// Load parses the Platform app identity projection. It ignores all caller
// modes except local-first-party and fails closed on malformed admitted rows.
func Load(reader io.Reader) (*Projection, error) {
	if reader == nil {
		return nil, fmt.Errorf("app identity projection reader is nil")
	}
	data, err := io.ReadAll(reader)
	if err != nil {
		return nil, fmt.Errorf("read app identity projection: %w", err)
	}
	var raw rawProjection
	if err := yaml.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("decode app identity projection: %w", err)
	}
	if raw.Version != 1 ||
		strings.TrimSpace(raw.TableFamily) != expectedTableFamily ||
		strings.TrimSpace(raw.Owner) != expectedOwner ||
		strings.TrimSpace(raw.CatalogID) != expectedCatalogID {
		return nil, fmt.Errorf("app identity projection metadata is not canonical")
	}

	projection := &Projection{localFirstPartyAppIDs: make(map[string]struct{})}
	for index, app := range raw.Apps {
		if strings.TrimSpace(app.RuntimeCallerMode) != localFirstPartyCallerMode {
			continue
		}
		if err := projection.addLocalFirstParty(app.CanonicalAppID, app.RuntimeAppID); err != nil {
			return nil, fmt.Errorf("app identity projection apps[%d]: %w", index, err)
		}
	}
	return projection, nil
}

// LoadFromFile loads the identity projection from an explicit path.
func LoadFromFile(path string) (*Projection, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		return nil, fmt.Errorf("app identity projection path is empty")
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open app identity projection: %w", err)
	}
	projection, loadErr := Load(file)
	if closeErr := file.Close(); closeErr != nil && loadErr == nil {
		return nil, fmt.Errorf("close app identity projection: %w", closeErr)
	}
	return projection, loadErr
}

// IsLocalFirstParty reports whether appID is explicitly admitted by the
// identity projection.
func (p *Projection) IsLocalFirstParty(appID string) bool {
	if p == nil {
		return false
	}
	_, ok := p.localFirstPartyAppIDs[strings.TrimSpace(appID)]
	return ok
}

func (p *Projection) addLocalFirstParty(canonicalAppID, runtimeAppID string) error {
	canonical := strings.TrimSpace(canonicalAppID)
	runtimeID := strings.TrimSpace(runtimeAppID)
	if canonical == "" ||
		canonical != canonicalAppID ||
		runtimeID != runtimeAppID ||
		canonical != runtimeID {
		return fmt.Errorf("canonical_app_id and runtime_app_id must be identical")
	}
	if !strings.HasPrefix(canonical, "nimi.") || !canonicalAppIDPattern.MatchString(canonical) {
		return fmt.Errorf("local-first-party app id %q is not canonical", canonical)
	}
	if _, duplicate := p.localFirstPartyAppIDs[canonical]; duplicate {
		return fmt.Errorf("duplicate local-first-party app id %q", canonical)
	}
	p.localFirstPartyAppIDs[canonical] = struct{}{}
	return nil
}
