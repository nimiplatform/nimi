package app

import (
	"context"
	"errors"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/appinstallgateway"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appstorage"
)

// InstallRuntime owns the Runtime-side install/uninstall dependencies for the
// RuntimeAppService lifecycle RPCs. It binds the admitted registry/release
// catalogs to the descriptor-first install gateway and the selected nimi_data
// root. It is constructed by NewInstallRuntime and injected via
// WithInstallRuntime.
type InstallRuntime = installRuntime

type installRuntime struct {
	registry       *appregistrycatalog.Registry
	releaseCatalog *appreleasecatalog.Catalog
	gateway        *appinstallgateway.Gateway
	dataRootRef    string
}

var (
	errInstallRuntimeUnavailable  = errors.New("app install runtime is not configured")
	errInstallAppIDRequired       = errors.New("app install requires app_id")
	errInstallAppNotAdmitted      = errors.New("app is not an admitted Nimi App registry row")
	errInstallDescriptorUnbound   = errors.New("app registry row has no bound release descriptor")
	errInstallDataRootUnavailable = errors.New("app install nimi_data root is not configured")
)

// NewInstallRuntime builds the install runtime. registry/releaseCatalog may be
// nil when no Nimi App registry projection is configured; in that case it
// returns (nil, nil) and the install lifecycle RPCs fail closed with
// errInstallRuntimeUnavailable. The downloader and unpacker are the concrete
// HTTPS downloader and tar.gz/zip unpacker; bundledAppsRoot, when set, enables
// the bundled-with-nimi no-network install path.
func NewInstallRuntime(
	registry *appregistrycatalog.Registry,
	releaseCatalog *appreleasecatalog.Catalog,
	dataRootRef string,
	bundledAppsRoot string,
	downloader appinstallgateway.Downloader,
	unpacker appinstallgateway.Unpacker,
) (*installRuntime, error) {
	if registry == nil || releaseCatalog == nil {
		return nil, nil
	}
	dataRoot := strings.TrimSpace(dataRootRef)
	options := []appinstallgateway.Option{
		appinstallgateway.WithStoragePlanner(appinstallgateway.DataRootPlanner{DataRootRef: dataRoot}),
		appinstallgateway.WithEvidenceWriter(appinstallgateway.FileEvidenceWriter{}),
	}
	if strings.TrimSpace(bundledAppsRoot) != "" {
		bundledSource, err := appinstallgateway.NewBundledArtifactSource(bundledAppsRoot)
		if err != nil {
			return nil, err
		}
		options = append(options, appinstallgateway.WithBundledSource(bundledSource))
	}
	gateway := appinstallgateway.New(downloader, unpacker, options...)
	return &installRuntime{
		registry:       registry,
		releaseCatalog: releaseCatalog,
		gateway:        gateway,
		dataRootRef:    dataRoot,
	}, nil
}

// resolveDescriptor resolves an app_id to its admitted registry row and the
// bound release descriptor. It fails closed when the app is not admitted or
// when no release descriptor is bound.
func (r *installRuntime) resolveDescriptor(appID string) (appregistrycatalog.App, appreleasecatalog.Descriptor, error) {
	if r == nil || r.registry == nil || r.releaseCatalog == nil {
		return appregistrycatalog.App{}, appreleasecatalog.Descriptor{}, errInstallRuntimeUnavailable
	}
	trimmed := strings.TrimSpace(appID)
	if trimmed == "" {
		return appregistrycatalog.App{}, appreleasecatalog.Descriptor{}, errInstallAppIDRequired
	}
	app, err := r.registry.FindByID(trimmed)
	if err != nil {
		return appregistrycatalog.App{}, appreleasecatalog.Descriptor{}, err
	}
	if app.AdmissionStatus != appregistrycatalog.AdmissionStatusAdmitted {
		return appregistrycatalog.App{}, appreleasecatalog.Descriptor{},
			errInstallAppNotAdmitted
	}
	descriptorRef := strings.TrimSpace(app.ReleaseDescriptorRef)
	if descriptorRef == "" {
		return appregistrycatalog.App{}, appreleasecatalog.Descriptor{}, errInstallDescriptorUnbound
	}
	descriptor, err := r.releaseCatalog.FindByID(descriptorRef)
	if err != nil {
		return appregistrycatalog.App{}, appreleasecatalog.Descriptor{}, err
	}
	return *app, *descriptor, nil
}

// plan resolves the P-NAPP-015 storage plan for a descriptor.
func (r *installRuntime) plan(descriptor appreleasecatalog.Descriptor) (appstorage.Plan, error) {
	if r == nil {
		return appstorage.Plan{}, errInstallRuntimeUnavailable
	}
	if strings.TrimSpace(r.dataRootRef) == "" {
		return appstorage.Plan{}, errInstallDataRootUnavailable
	}
	return appstorage.Resolve(r.dataRootRef, descriptor.AppID, descriptor.Version, descriptor.StoragePolicyRef)
}

// install drives the install gateway for a resolved descriptor, reporting
// typed pipeline phases to the observer.
func (r *installRuntime) install(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer appinstallgateway.InstallObserver) (appinstallgateway.InstalledApp, error) {
	if r == nil || r.gateway == nil {
		return appinstallgateway.InstalledApp{}, errInstallRuntimeUnavailable
	}
	return r.gateway.InstallWithObserver(ctx, descriptor, observer)
}

// uninstall drives the install gateway uninstall for a resolved plan.
func (r *installRuntime) uninstall(ctx context.Context, plan appstorage.Plan, options appstorage.UninstallOptions) error {
	if r == nil || r.gateway == nil {
		return errInstallRuntimeUnavailable
	}
	return r.gateway.Uninstall(ctx, plan, options)
}

// update drives the install gateway atomic update for a resolved descriptor:
// the new release is materialized and digest-verified before the active
// release pointer is swapped. Durable data is kept.
func (r *installRuntime) update(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer appinstallgateway.InstallObserver) (appinstallgateway.InstalledApp, error) {
	if r == nil || r.gateway == nil {
		return appinstallgateway.InstalledApp{}, errInstallRuntimeUnavailable
	}
	return r.gateway.UpdateApp(ctx, descriptor, observer)
}

// repair drives the install gateway repair for a resolved descriptor: the
// (damaged) release payload is dropped and re-materialized while durable data
// is preserved.
func (r *installRuntime) repair(ctx context.Context, descriptor appreleasecatalog.Descriptor, observer appinstallgateway.InstallObserver) (appinstallgateway.InstalledApp, error) {
	if r == nil || r.gateway == nil {
		return appinstallgateway.InstalledApp{}, errInstallRuntimeUnavailable
	}
	return r.gateway.RepairApp(ctx, descriptor, observer)
}

// activeRelease reads the app-root active release pointer for a resolved plan.
// It returns appstorage.ErrActiveReleaseNotFound when the app has never had a
// release activated (it is not installed).
func (r *installRuntime) activeRelease(plan appstorage.Plan) (appstorage.ActiveReleasePointer, error) {
	if r == nil {
		return appstorage.ActiveReleasePointer{}, errInstallRuntimeUnavailable
	}
	return appstorage.ReadActiveRelease(plan)
}
