package engine

import (
	"context"
	"log/slog"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

type managedResidentHost interface {
	residency() *residentModelAssets
	releaseResident(string, time.Time) (bool, error)
}

func (r *residentModelAssets) residency() *residentModelAssets { return r }

// ConfigureResidentRelease shares only the ability to relinquish an idle
// worker. Each host retains ownership of its queue, leases and output bodies.
func ConfigureResidentRelease(ctx context.Context, logger *slog.Logger, hosts []localexecution.ModelAssetHostRetirer) {
	var residents []managedResidentHost
	for _, host := range hosts {
		if resident, ok := host.(managedResidentHost); ok {
			residents = append(residents, resident)
		}
	}
	release := func(host managedResidentHost, before time.Time) {
		if ctx.Err() == nil {
			if _, err := host.releaseResident("", before); err != nil {
				logger.Warn("idle worker release failed", "error", err)
			}
		}
	}
	for _, host := range residents {
		r := host.residency()
		r.mu.Lock()
		// The text host already has a lease-aware idle timer.
		if _, llama := host.(*ExecutionHost); !llama {
			r.onIdleTimeout = func(before time.Time) { release(host, before) }
		}
		r.beforeMediaLoad = func() {
			before := time.Now()
			for _, peer := range residents {
				if peer != host {
					release(peer, before)
				}
			}
		}
		r.mu.Unlock()
	}
}

func (r *residentModelAssets) releaseIdlePeersForCUDA(sources []capabilitydriver.InvocationExactDependencySource) {
	if _, cuda := exactInvocationDependencySource(sources, "accelerator.cuda.runtime", NVIDIACUDAUserSpaceRuntimeDependencyID); !cuda {
		return
	}
	r.mu.Lock()
	release := r.beforeMediaLoad
	r.mu.Unlock()
	if release != nil {
		release()
	}
}
