package engine

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// CheckSyncManagedEnvironment performs owner-specific manifest and promoted
// generation verification for the current managed roots. It never downloads
// or starts an ExecutionHost; execution admission retains fresh verification.
// @nimi-authority: rule.nimi.runtime.local-compute.r077
func (m *Manager) CheckSyncManagedEnvironment(ctx context.Context, dataRoot string) []ManagedEnvironmentCheckResult {
	return m.checkSyncManagedEnvironment(ctx, dataRoot, currentGOOS()+"/"+currentGOARCH())
}

func (m *Manager) checkSyncManagedEnvironment(ctx context.Context, dataRoot string, platform string) []ManagedEnvironmentCheckResult {
	if m == nil {
		return []ManagedEnvironmentCheckResult{{Kind: "environment_owner", Status: "failed", Reason: "ENVIRONMENT_MANAGER_UNAVAILABLE"}}
	}
	expectedEnvironments := filepath.Join(filepath.Clean(strings.TrimSpace(dataRoot)), "environments")
	expectedDependencies := filepath.Join(filepath.Clean(strings.TrimSpace(dataRoot)), "dependencies")
	if !sameManagedPath(m.baseDir, expectedEnvironments) || !sameManagedPath(m.depsDir, expectedDependencies) {
		return []ManagedEnvironmentCheckResult{{Kind: "environment_owner", Status: "failed", Reason: "ENVIRONMENT_MANAGER_ROOT_MISMATCH"}}
	}
	if ctx.Err() != nil {
		return []ManagedEnvironmentCheckResult{{Kind: "environment_owner", Status: "failed", Reason: "RUN_INTERRUPTED"}}
	}
	rebasedEntries, rebaseErr := m.registry.commitPendingRebases()
	results := make([]ManagedEnvironmentCheckResult, 0)
	for _, conflict := range m.registry.Conflicts() {
		results = append(results, ManagedEnvironmentCheckResult{
			Kind: "engine_registry", Reference: conflict.Reference, Status: "conflict", Reason: conflict.Reason,
		})
	}
	platform = strings.ToLower(strings.TrimSpace(platform))
	claimedEnvironmentEntries := map[string]struct{}{"registry.json": {}, "python-profiles": {}, "python": {}}
	for _, entry := range m.registry.List() {
		if ctx.Err() != nil {
			return append(results, ManagedEnvironmentCheckResult{Kind: "engine_registry", Status: "failed", Reason: "RUN_INTERRUPTED"})
		}
		result := ManagedEnvironmentCheckResult{
			Kind: "engine_package", Reference: string(entry.Engine) + "/" + entry.Version,
			Status: "unavailable", Reason: "ENGINE_REGISTRY_EVIDENCE_INCOMPLETE",
		}
		if entry.Engine == EngineLlama || entry.Engine == EngineAudioCPP {
			claimedEnvironmentEntries[string(entry.Engine)] = struct{}{}
		}
		if _, rebased := rebasedEntries[registryKey(entry.Engine, entry.Version)]; rebased {
			result.Change = "rebased"
			result.Reason = "ENGINE_REGISTRY_ENTRY_REBASED"
			if rebaseErr != nil {
				result.Status = "failed"
				result.Reason = "ENGINE_REGISTRY_REBASE_FAILED"
			}
		}
		if relative, err := filepath.Rel(dataRoot, entry.BinaryPath); err == nil && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			result.Locator = filepath.ToSlash(relative)
		}
		if result.Status != "failed" && !strings.EqualFold(strings.TrimSpace(entry.Platform), platform) {
			result.Status = "incompatible"
			result.Reason = "ENGINE_PLATFORM_INCOMPATIBLE"
		} else if result.Status != "failed" {
			var verifyErr error
			switch entry.Engine {
			case EngineLlama:
				preferredAsset, err := preferredLlamaAssetNameForCurrentHost(entry.Version)
				if err != nil {
					verifyErr = err
				} else {
					verifyErr = verifyLlamaRegistryEntryForCurrentHost(entry, preferredAsset)
				}
			case EngineAudioCPP:
				_, verifyErr = m.audioCppStatusFromRegistryEntry(entry)
			default:
				verifyErr = os.ErrNotExist
			}
			if verifyErr == nil {
				result.Status = "available"
				if result.Change == "rebased" {
					result.Reason = "ENGINE_REGISTRY_ENTRY_REBASED_AND_VERIFIED"
				} else {
					result.Reason = "ENGINE_REGISTRY_ENTRY_VERIFIED"
				}
			} else {
				result.Status = "unavailable"
				result.Reason = "ENGINE_REGISTRY_EVIDENCE_INCOMPLETE"
			}
		}
		results = append(results, result)
	}

	uvRoot := filepath.Join(m.depsDir, "uv")
	var uvStatus UVToolDependencyStatus
	uvReady := false
	if spec, ok := managedUVArchiveSpecForCurrentHost(); ok {
		uvStatus, uvReady = verifiedManagedUVToolStatus(uvRoot, spec)
		uvLocator := filepath.ToSlash(filepath.Join("dependencies", "uv", filepath.Base(managedUVPath(uvRoot))))
		result := ManagedEnvironmentCheckResult{Kind: "uv_tool", Reference: ManagedUVVersion, Locator: uvLocator, Status: "unavailable", Reason: "UV_TOOL_UNAVAILABLE"}
		if uvReady {
			result.Reason = "UV_TOOL_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED"
		}
		if _, err := os.Lstat(uvRoot); err == nil || uvReady {
			results = append(results, result)
		}
	}

	pythonRoot := engineVersionDir(m.baseDir, EngineKind("python"), ManagedPythonVersion)
	pythonPath, pythonFound, pythonDiscoverErr := discoverManagedPythonRuntime(pythonRoot, ManagedPythonVersion)
	if _, err := os.Lstat(pythonRoot); err == nil || pythonFound {
		pythonLocator := ""
		if relative, err := filepath.Rel(dataRoot, managedPythonPath(pythonRoot)); err == nil && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			pythonLocator = filepath.ToSlash(relative)
		}
		if pythonFound {
			if relative, err := filepath.Rel(dataRoot, pythonPath); err == nil && !filepath.IsAbs(relative) && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				pythonLocator = filepath.ToSlash(relative)
			}
		}
		pythonResult := ManagedEnvironmentCheckResult{
			Kind: "python_runtime", Reference: ManagedPythonVersion, Locator: pythonLocator,
			Status: "unavailable", Reason: "PYTHON_RUNTIME_OWNER_EVIDENCE_INCOMPLETE",
		}
		if pythonDiscoverErr == nil && pythonFound && verifyManagedPythonRuntimeManifest(pythonRoot, pythonPath) {
			pythonResult.Reason = "PYTHON_RUNTIME_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED"
		}
		results = append(results, pythonResult)
	}

	cacheRoot := filepath.Join(m.depsDir, "python-package-cache")
	profilesRoot := filepath.Join(m.baseDir, "python-profiles")
	rebuiltProfiles := make(map[string]struct{})
	if entries, err := os.ReadDir(profilesRoot); err == nil {
		for _, entry := range entries {
			if ctx.Err() != nil {
				return append(results, ManagedEnvironmentCheckResult{Kind: "python_profile", Status: "failed", Reason: "RUN_INTERRUPTED"})
			}
			locator := filepath.ToSlash(filepath.Join("environments", "python-profiles", entry.Name()))
			if !entry.IsDir() {
				results = append(results, ManagedEnvironmentCheckResult{Kind: "python_profile", Locator: locator, Status: "unknown", Reason: "PYTHON_PROFILE_ENTRY_UNCLAIMED"})
				continue
			}
			profileRoot := filepath.Join(profilesRoot, entry.Name())
			manifest, err := ReadPythonDependencyProfileManifest(profileRoot)
			if err != nil {
				results = append(results, ManagedEnvironmentCheckResult{Kind: "python_profile", Locator: locator, Status: "unknown", Reason: "PYTHON_PROFILE_MANIFEST_UNAVAILABLE"})
				continue
			}
			result := ManagedEnvironmentCheckResult{
				Kind: "python_profile", Reference: manifest.Identity.ProfileDigest, Locator: locator,
				Status: "unavailable", Reason: "PYTHON_PROFILE_PROMOTION_EVIDENCE_INCOMPLETE",
			}
			if !strings.EqualFold(manifest.Identity.PlatformTuple, platform) {
				result.Status = "incompatible"
				result.Reason = "PYTHON_PROFILE_PLATFORM_INCOMPATIBLE"
				result.NextAction = "rerun_check_sync"
				if rebuilt, ok := m.rebuildPythonDependencyProfileFromLocal(ctx, manifest); ok {
					if _, duplicate := rebuiltProfiles[rebuilt.Identity.ProfileDigest]; !duplicate {
						rebuiltProfiles[rebuilt.Identity.ProfileDigest] = struct{}{}
						results = append(results, ManagedEnvironmentCheckResult{
							Kind: "python_profile", Reference: rebuilt.Identity.ProfileDigest,
							Locator: filepath.ToSlash(filepath.Join("environments", "python-profiles", rebuilt.Identity.ProfileDigest)),
							Status:  "unavailable", Change: "rebuilt", Reason: "PYTHON_PROFILE_REBUILT_SELECTION_REQUIRED",
						})
					}
				}
			} else if err := VerifyPythonDependencyProfileStaticContent(profileRoot, manifest.ValidationConsumer, manifest.Identity); err != nil {
				result.Status, result.Reason = "conflict", "PYTHON_PROFILE_STATIC_CONTENT_MISMATCH"
			} else if info, err := os.Lstat(managedPythonPath(profileRoot)); err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 {
				result.Status, result.Reason = "unavailable", "PYTHON_PROFILE_PROMOTED_INTERPRETER_UNAVAILABLE"
			} else if !uvReady {
				result.Status, result.Reason = "unavailable", "PYTHON_PROFILE_VERIFICATION_TOOL_UNAVAILABLE"
			} else if _, err := m.verifyExistingPythonDependencyProfileForCheckSync(ctx, profileRoot, cacheRoot, uvStatus.ExecutablePath, manifest); err != nil {
				result.Status, result.Reason = "conflict", "PYTHON_PROFILE_FULL_VERIFICATION_FAILED"
			} else {
				result.Status = "unavailable"
				result.Reason = "PYTHON_PROFILE_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED"
			}
			results = append(results, result)
		}
	}

	if info, err := os.Lstat(cacheRoot); err == nil {
		status := "unknown"
		reason := "PYTHON_PACKAGE_CACHE_PRESERVED_UNCLAIMED"
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			status = "conflict"
			reason = "PYTHON_PACKAGE_CACHE_INVALID"
		}
		results = append(results, ManagedEnvironmentCheckResult{Kind: "python_package_cache", Locator: "dependencies/python-package-cache", Status: status, Reason: reason})
	}
	results = append(results, unclaimedManagedRootEntries(m.baseDir, "environments", claimedEnvironmentEntries)...)
	results = append(results, unclaimedManagedRootEntries(m.depsDir, "dependencies", map[string]struct{}{
		"uv": {}, "python-package-cache": {},
	})...)
	sort.Slice(results, func(i, j int) bool {
		return results[i].Kind+"|"+results[i].Reference+"|"+results[i].Locator < results[j].Kind+"|"+results[j].Reference+"|"+results[j].Locator
	})
	return results
}

func (m *Manager) verifyExistingPythonDependencyProfileForCheckSync(ctx context.Context, profileRoot, cacheRoot, uvPath string, manifest PythonDependencyProfileManifest) (PythonDependencyProfileStatus, error) {
	generationDigest, err := pythonDependencyProfileGenerationDigest(profileRoot)
	if err != nil {
		return PythonDependencyProfileStatus{}, err
	}
	if cached, ok := m.cachedPythonDependencyProfileVerification(manifest.Identity.ProfileDigest, profileRoot, generationDigest); ok {
		if cached.Failure != nil {
			return PythonDependencyProfileStatus{}, clonePythonDependencyProfileVerificationError(cached.Failure)
		}
		status := clonePythonDependencyProfileStatus(cached.Status)
		status.Reused = true
		return status, nil
	}
	status, err := verifyPythonDependencyProfile(ctx, runCommandOutput, profileRoot, cacheRoot, uvPath, manifest.ValidationConsumer, manifest.Identity, true)
	if err != nil {
		failure := newPythonDependencyProfileVerificationError(manifest.Identity, profileRoot, err)
		m.cachePythonDependencyProfileVerification(manifest.Identity.ProfileDigest, pythonDependencyProfileVerificationCacheEntry{
			ProfileRoot: profileRoot, GenerationDigest: generationDigest, Failure: failure,
		})
		return PythonDependencyProfileStatus{}, failure
	}
	m.cachePythonDependencyProfileVerification(manifest.Identity.ProfileDigest, pythonDependencyProfileVerificationCacheEntry{
		ProfileRoot: profileRoot, GenerationDigest: generationDigest, Status: status,
	})
	return status, nil
}

func (m *Manager) rebuildPythonDependencyProfileFromLocal(ctx context.Context, manifest PythonDependencyProfileManifest) (PythonDependencyProfileStatus, bool) {
	spec, ok := managedUVArchiveSpecForCurrentHost()
	if !ok {
		return PythonDependencyProfileStatus{}, false
	}
	uvRoot := filepath.Join(m.depsDir, "uv")
	uvStatus, ok := verifiedManagedUVToolStatus(uvRoot, spec)
	if !ok {
		return PythonDependencyProfileStatus{}, false
	}
	pythonRoot := engineVersionDir(m.baseDir, EngineKind("python"), ManagedPythonVersion)
	pythonPath, found, err := discoverManagedPythonRuntime(pythonRoot, ManagedPythonVersion)
	if err != nil || !found || !verifyManagedPythonRuntimeManifest(pythonRoot, pythonPath) {
		return PythonDependencyProfileStatus{}, false
	}
	cacheInfo, err := os.Lstat(filepath.Join(m.depsDir, "python-package-cache"))
	if err != nil || !cacheInfo.IsDir() || cacheInfo.Mode()&os.ModeSymlink != 0 {
		return PythonDependencyProfileStatus{}, false
	}
	offlineRunner := func(ctx context.Context, dir string, env map[string]string, bin string, args ...string) (string, error) {
		if len(args) > 0 && args[0] == "sync" {
			hasOffline := false
			for _, arg := range args {
				hasOffline = hasOffline || arg == "--offline"
			}
			if !hasOffline {
				args = append(args, "--offline")
			}
		}
		return runCommandOutput(ctx, dir, env, bin, args...)
	}
	status, err := m.ensurePythonDependencyProfile(
		ctx,
		uvStatus.ExecutablePath,
		pythonPath,
		manifest.ValidationConsumer,
		currentGOOS()+"/"+currentGOARCH(),
		manifest.Identity.AcceleratorPlane,
		offlineRunner,
	)
	return status, err == nil
}

func unclaimedManagedRootEntries(root string, prefix string, known map[string]struct{}) []ManagedEnvironmentCheckResult {
	entries, err := os.ReadDir(root)
	if err != nil {
		return []ManagedEnvironmentCheckResult{}
	}
	results := make([]ManagedEnvironmentCheckResult, 0)
	for _, entry := range entries {
		if _, ok := known[entry.Name()]; ok {
			continue
		}
		results = append(results, ManagedEnvironmentCheckResult{
			Kind: prefix, Locator: filepath.ToSlash(filepath.Join(prefix, entry.Name())),
			Status: "unknown", Reason: "OWNER_MATERIAL_UNRECOGNIZED",
		})
	}
	return results
}
