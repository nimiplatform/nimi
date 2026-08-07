package engine

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// SetManagedImageBackend configures the daemon-managed runtime-owned image backend.
func (m *Manager) SetManagedImageBackend(cfg *ManagedImageBackendConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.managedImageBackend = normalizeManagedImageBackendConfig(cfg)
}

// EnsureManagedImageBackend starts the runtime-owned managed image gRPC backend
// without registering it as a llama external backend.
func (m *Manager) EnsureManagedImageBackend(ctx context.Context, cfg *ManagedImageBackendConfig) error {
	normalized := normalizeManagedImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return nil
	}
	m.mu.RLock()
	backendsPath := strings.TrimSpace(m.managedImageBackendsPath)
	sharedDependenciesPath := strings.TrimSpace(m.sharedAcceleratorDependenciesPath)
	m.mu.RUnlock()
	if normalized.Mode == ManagedImageBackendOfficial {
		if spec, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource(normalized.BackendName, normalized.PackageSource); ok {
			attrs := []any{
				"backend", normalized.BackendName,
				"mode", normalized.Mode,
				"package_source", strings.TrimSpace(string(spec.PackageSource)),
				"package_format", spec.PackageFormat,
				"launch_mode", spec.LaunchMode,
				"install_dir", spec.InstallDirName,
				"backends_path", backendsPath,
			}
			if driver := strings.TrimSpace(spec.WrapperDriver); driver != "" {
				attrs = append(attrs, "wrapper_driver", driver)
			}
			if source := managedImageBackendInstallSource(spec); source != "" {
				attrs = append(attrs, "source", source)
			}
			if _, err := discoverInstalledManagedImageBackendLaunchConfig(backendsPath, sharedDependenciesPath, normalized.BackendName, spec, normalized.Address); err == nil {
				m.logger.Info("managed image backend package already installed", attrs...)
			} else {
				attrs = append(attrs, "reason", err)
				m.logger.Info("managed image backend package materialization required", attrs...)
			}
		}
	}
	if normalized.Mode == ManagedImageBackendOfficial && currentGOOS() == "windows" && strings.EqualFold(detectLocalGPUVendor(), "nvidia") {
		status := m.ResolveSharedAcceleratorDependency(NVIDIACUDAUserSpaceRuntimeDependencyID, "stable-diffusion.cpp.cuda")
		if status.State != SharedAcceleratorDependencyReadySystem && status.State != SharedAcceleratorDependencyReadyManaged {
			return fmt.Errorf("managed image backend requires shared accelerator dependency %s to be ready before activation: state=%s detail=%s", status.DependencyID, status.State, status.Detail)
		}
	}
	resolved, err := ensureManagedImageBackendInstalled(ctx, backendsPath, sharedDependenciesPath, normalized)
	if err != nil {
		return err
	}
	auxCfg, err := managedImageBackendEngineConfig(resolved)
	if err != nil {
		return err
	}
	return m.startManagedImageBackend(ctx, auxCfg)
}

func (m *Manager) EnsureManagedImageBackendDependency(ctx context.Context, cfg *ManagedImageBackendConfig) (ManagedImageBackendDependencyStatus, error) {
	normalized := normalizeManagedImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return ManagedImageBackendDependencyStatus{}, nil
	}
	m.mu.RLock()
	backendsPath := strings.TrimSpace(m.managedImageBackendsPath)
	sharedDependenciesPath := strings.TrimSpace(m.sharedAcceleratorDependenciesPath)
	m.mu.RUnlock()
	if normalized.Mode == ManagedImageBackendOfficial && currentGOOS() == "windows" && strings.EqualFold(detectLocalGPUVendor(), "nvidia") {
		status := m.ResolveSharedAcceleratorDependency(NVIDIACUDAUserSpaceRuntimeDependencyID, "stable-diffusion.cpp.cuda")
		if status.State != SharedAcceleratorDependencyReadySystem && status.State != SharedAcceleratorDependencyReadyManaged {
			return ManagedImageBackendDependencyStatus{}, fmt.Errorf("managed image backend requires shared accelerator dependency %s to be ready before activation: state=%s detail=%s", status.DependencyID, status.State, status.Detail)
		}
	}
	materializedStartedAt := time.Now()
	resolved, err := ensureManagedImageBackendMaterializedBeforeInstall(ctx, backendsPath, sharedDependenciesPath, normalized, m.stopManagedImageBackend)
	if err != nil {
		return ManagedImageBackendDependencyStatus{}, err
	}
	spec, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource(resolved.BackendName, resolved.PackageSource)
	if !ok {
		return ManagedImageBackendDependencyStatus{}, fmt.Errorf("managed image backend package source record unavailable for %s", resolved.BackendName)
	}
	status := managedImageBackendDependencyStatusFromConfig(resolved, spec)
	if normalized.Mode == ManagedImageBackendOfficial {
		m.logger.Info(
			"managed image backend package materialized",
			"backend", normalized.BackendName,
			"mode", normalized.Mode,
			"package_source", strings.TrimSpace(string(spec.PackageSource)),
			"package_format", spec.PackageFormat,
			"launch_mode", spec.LaunchMode,
			"install_dir", spec.InstallDirName,
			"backends_path", backendsPath,
			"duration_ms", time.Since(materializedStartedAt).Milliseconds(),
		)
	}
	return status, nil
}

// ResolveInstalledManagedImageBackendDependency returns the exact installed
// package facts without downloading, installing, or starting a process.
func (m *Manager) ResolveInstalledManagedImageBackendDependency(cfg *ManagedImageBackendConfig) (ManagedImageBackendDependencyStatus, error) {
	normalized := normalizeManagedImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return ManagedImageBackendDependencyStatus{}, nil
	}
	m.mu.RLock()
	backendsPath := strings.TrimSpace(m.managedImageBackendsPath)
	sharedDependenciesPath := strings.TrimSpace(m.sharedAcceleratorDependenciesPath)
	m.mu.RUnlock()
	resolved, err := resolveInstalledManagedImageBackendConfig(backendsPath, sharedDependenciesPath, normalized)
	if err != nil {
		return ManagedImageBackendDependencyStatus{}, err
	}
	spec, ok := resolveManagedImageBackendPackageSpecForCurrentHostWithSource(resolved.BackendName, resolved.PackageSource)
	if !ok {
		return ManagedImageBackendDependencyStatus{}, fmt.Errorf("managed image backend package source record unavailable for %s", resolved.BackendName)
	}
	return managedImageBackendDependencyStatusFromConfig(resolved, spec), nil
}

// StartInstalledManagedImageBackend starts a previously materialized runtime-owned
// image backend. It never downloads or installs packages; missing packages must
// be handled through local environment dependency jobs.
func (m *Manager) StartInstalledManagedImageBackend(ctx context.Context, cfg *ManagedImageBackendConfig) error {
	normalized := normalizeManagedImageBackendConfig(cfg)
	if !normalized.Enabled() {
		return nil
	}
	m.mu.RLock()
	backendsPath := strings.TrimSpace(m.managedImageBackendsPath)
	sharedDependenciesPath := strings.TrimSpace(m.sharedAcceleratorDependenciesPath)
	m.mu.RUnlock()
	if normalized.Mode == ManagedImageBackendOfficial && currentGOOS() == "windows" && strings.EqualFold(detectLocalGPUVendor(), "nvidia") {
		status := m.ResolveSharedAcceleratorDependency(NVIDIACUDAUserSpaceRuntimeDependencyID, "stable-diffusion.cpp.cuda")
		if status.State != SharedAcceleratorDependencyReadySystem && status.State != SharedAcceleratorDependencyReadyManaged {
			return fmt.Errorf("managed image backend requires shared accelerator dependency %s to be ready before activation: state=%s detail=%s", status.DependencyID, status.State, status.Detail)
		}
	}
	resolved, err := resolveInstalledManagedImageBackendConfig(backendsPath, sharedDependenciesPath, normalized)
	if err != nil {
		return err
	}
	auxCfg, err := managedImageBackendEngineConfig(resolved)
	if err != nil {
		return err
	}
	return m.startManagedImageBackend(ctx, auxCfg)
}

func managedImageBackendInstallSource(spec managedImageBackendPackageSpec) string {
	switch spec.PackageFormat {
	case managedImageBackendPackageFormatDirectArchive:
		return strings.TrimSpace(spec.ArchiveURL)
	case managedImageBackendPackageFormatOCIPayload:
		return strings.TrimSpace(spec.ImageRef)
	default:
		return ""
	}
}

func (m *Manager) startManagedImageBackend(ctx context.Context, cfg EngineConfig) error {
	cfg.SupervisedRoot = m.baseDir
	m.mu.Lock()
	existing, ok := m.supervisors[engineManagedImageBackend]
	if m.starting[engineManagedImageBackend] {
		m.mu.Unlock()
		return nil
	}
	if ok && (existing.Status() == StatusHealthy || existing.Status() == StatusStarting) {
		m.mu.Unlock()
		return nil
	}
	m.starting[engineManagedImageBackend] = true
	if ok {
		delete(m.supervisors, engineManagedImageBackend)
	}
	sup := NewSupervisor(cfg, m.logger, m.onState)
	m.supervisors[engineManagedImageBackend] = sup
	m.mu.Unlock()
	defer m.finishEngineStart(engineManagedImageBackend)
	if ok {
		_ = existing.Stop()
	}
	if err := sup.Start(ctx); err != nil {
		m.removeSupervisorIfCurrent(engineManagedImageBackend, sup)
		return err
	}
	return nil
}

func (m *Manager) stopManagedImageBackend() error {
	m.mu.RLock()
	sup, ok := m.supervisors[engineManagedImageBackend]
	m.mu.RUnlock()
	if !ok {
		return nil
	}
	if err := sup.Stop(); err != nil {
		return err
	}
	m.removeSupervisorIfCurrent(engineManagedImageBackend, sup)
	return nil
}
