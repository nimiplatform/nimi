package app

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

var localDevelopmentCanonicalScopes = map[string]struct{}{
	"account.read": {}, "account.session.read": {}, "data.scope.read": {}, "data.scope.write": {},
	"agent.identity.project": {}, "agent.identity.bind": {}, "ai.spend.meter": {}, "ai.spend.delegate": {},
	"memory.read.bounded": {}, "memory.write.admitted": {}, "knowledge.read.bounded": {}, "knowledge.write.admitted": {},
	"notification.send": {}, "notification.subscribe": {}, "file.read.scoped": {}, "file.write.scoped": {},
	"device.use.scoped": {}, "audit.read.scoped": {}, "ai_profile.selection.consume": {},
	"runtime.agent.turn.read": {}, "runtime.agent.turn.write": {},
}

var localDevelopmentQualifierScopeRules = map[string]map[string]struct{}{
	"app-local-drafts":  {"file.read.scoped": {}, "file.write.scoped": {}},
	"runtime.artifacts": {"data.scope.read": {}},
}

func resolveLocalDevelopmentProject(rootPath string, expectedAppID string, shellKind runtimev1.LocalDevelopmentShellKind, accountID string, accountGeneration uint64) (localDevelopmentProjectSnapshot, error) {
	root, manifestPath, manifest, err := loadLocalAppManifest(rootPath)
	if err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	appID := firstNonEmpty(manifest.AppID, manifest.AppIDCamel)
	displayName := firstNonEmpty(manifest.DisplayName, manifest.DisplayNameCamel)
	if appID == "" || !safeLocalAppID(appID) || appID != strings.TrimSpace(appID) || displayName == "" || displayName != strings.TrimSpace(displayName) {
		return localDevelopmentProjectSnapshot{}, errors.New("local-development manifest requires canonical app_id and display_name")
	}
	if expected := strings.TrimSpace(expectedAppID); expected == "" || expected != expectedAppID || expected != appID {
		return localDevelopmentProjectSnapshot{}, fmt.Errorf("local-development manifest app_id %s does not match expected app_id %s", appID, expectedAppID)
	}
	capabilities, err := normalizeLocalDevelopmentCapabilities(manifest.Permissions.DeclaredNimiAPIScopes)
	if err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	project := localDevelopmentProjectSnapshot{
		AppID:                 appID,
		DisplayName:           displayName,
		ProjectRoot:           filepath.Clean(root),
		ManifestPath:          filepath.Clean(manifestPath),
		ShellKind:             shellKind,
		AccountID:             strings.TrimSpace(accountID),
		AccountGeneration:     accountGeneration,
		Capabilities:          capabilities,
		CapabilityFingerprint: localDevelopmentCapabilityFingerprint(capabilities),
	}
	if err := validateLocalDevelopmentProject(project); err != nil {
		return localDevelopmentProjectSnapshot{}, err
	}
	return project, nil
}

func normalizeLocalDevelopmentCapabilities(declarations []localAppManifestCapability) ([]string, error) {
	if len(declarations) == 0 {
		return nil, errors.New("local-development manifest must declare at least one Nimi API capability")
	}
	capabilities := make([]string, 0, len(declarations))
	seen := make(map[string]struct{}, len(declarations))
	for index, declaration := range declarations {
		scope := strings.TrimSpace(declaration.Scope)
		qualifier := strings.TrimSpace(declaration.Qualifier)
		purpose := strings.TrimSpace(declaration.Purpose)
		if scope != declaration.Scope || qualifier != declaration.Qualifier || purpose == "" || purpose != declaration.Purpose {
			return nil, fmt.Errorf("local-development capability %d is not canonical", index)
		}
		if _, admitted := localDevelopmentCanonicalScopes[scope]; !admitted {
			return nil, fmt.Errorf("local-development capability %d uses unknown scope %s", index, scope)
		}
		capability := scope
		if qualifier != "" {
			if !canonicalLocalDevelopmentQualifier(qualifier) {
				return nil, fmt.Errorf("local-development capability %d qualifier is invalid", index)
			}
			if admittedScopes, constrained := localDevelopmentQualifierScopeRules[qualifier]; constrained {
				if _, admitted := admittedScopes[scope]; !admitted {
					return nil, fmt.Errorf("local-development capability %d qualifier %s is not admitted for scope %s", index, qualifier, scope)
				}
			}
			capability += "#" + qualifier
		}
		if _, duplicate := seen[capability]; duplicate {
			return nil, fmt.Errorf("local-development capability %s is duplicated", capability)
		}
		seen[capability] = struct{}{}
		capabilities = append(capabilities, capability)
	}
	sort.Strings(capabilities)
	return capabilities, nil
}

func canonicalLocalDevelopmentQualifier(value string) bool {
	if value == "" || len(value) > 160 {
		return false
	}
	for index, character := range value {
		alphanumeric := character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9'
		if alphanumeric {
			continue
		}
		if index == 0 || index == len(value)-1 || !strings.ContainsRune("._:-", character) {
			return false
		}
	}
	return true
}

func localDevelopmentProjectHasCapability(project localDevelopmentProjectSnapshot, capability string) bool {
	index := sort.SearchStrings(project.Capabilities, capability)
	return index < len(project.Capabilities) && project.Capabilities[index] == capability
}
