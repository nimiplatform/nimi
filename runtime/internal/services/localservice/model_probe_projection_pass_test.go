package localservice

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type countedEmbeddingProbeDriver struct {
	capabilitydriver.LlamaEmbedDriver
	probes, projections, combinations int
	bytes                             int64
	afterProjection                   func(capabilitydriver.ModelAssetBindingInput)
}

type countedProjectionProbeReader struct {
	io.ReaderAt
	bytes *int64
}

func (r countedProjectionProbeReader) ContextErr() error {
	if checker, ok := r.ReaderAt.(interface{ ContextErr() error }); ok {
		return checker.ContextErr()
	}
	return nil
}

func (r countedProjectionProbeReader) ReadAt(p []byte, off int64) (int, error) {
	n, err := r.ReaderAt.ReadAt(p, off)
	*r.bytes += int64(n)
	return n, err
}

func (d *countedEmbeddingProbeDriver) ProbeModelAsset(input capabilitydriver.ModelAssetFormatProbeInput, reader io.ReaderAt, size int64) ([]byte, error) {
	d.probes++
	return d.LlamaEmbedDriver.ProbeModelAsset(input, countedProjectionProbeReader{ReaderAt: reader, bytes: &d.bytes}, size)
}

func (d *countedEmbeddingProbeDriver) ProjectModelAssetBinding(input capabilitydriver.ModelAssetBindingInput) (capabilitydriver.ModelAssetBindingProjection, runtimev1.LocalCapabilityReason) {
	d.projections++
	projection, reason := d.LlamaEmbedDriver.ProjectModelAssetBinding(input)
	if d.afterProjection != nil {
		d.afterProjection(input)
	}
	return projection, reason
}

func (d *countedEmbeddingProbeDriver) ValidateCombination(requirements []*runtimev1.LocalCapabilityRequirement, bindings []*runtimev1.ModelAssetExactBinding, assets []capabilitydriver.ModelAssetDescriptor) runtimev1.LocalCapabilityReason {
	d.combinations++
	return d.LlamaEmbedDriver.ValidateCombination(requirements, bindings, assets)
}

func repeatedProjectionFixture(t *testing.T, count int) (*Service, *countedEmbeddingProbeDriver, []*runtimev1.Loadout) {
	t.Helper()
	svc, asset := loadoutEmbeddingFixture(t)
	rows := make([]*runtimev1.Loadout, 0, count)
	for range count {
		prepared := prepareEmbeddingLoadoutForTest(t, svc, context.Background(), "", "Shared metadata", asset)
		rows = append(rows, commitLoadoutForTest(t, svc, context.Background(), prepared.GetPrepareId(), false))
	}
	driver := &countedEmbeddingProbeDriver{}
	registry, err := capabilitydriver.NewRegistry(map[capabilitydriver.RegistrationKey]capabilitydriver.Driver{
		{CapabilityContract: rows[0].GetCapabilityContract(), Identity: capabilitydriver.IdentityFromProto(rows[0].GetImplementation())}: driver,
	})
	if err != nil {
		t.Fatal(err)
	}
	svc.capabilityDrivers = registry
	return svc, driver, rows
}

func TestMachineLoadoutsSharesOnlySameReadMetadata(t *testing.T) {
	svc, driver, rows := repeatedProjectionFixture(t, 11)
	ctx := context.Background()
	for round := 1; round <= 2; round++ {
		response, err := svc.GetMachineLoadouts(ctx, &runtimev1.GetMachineLoadoutsRequest{})
		if err != nil {
			t.Fatal(err)
		}
		if len(response.GetAggregate().GetLoadouts()) != len(rows) {
			t.Fatal("loadouts lost")
		}
		for _, row := range response.GetAggregate().GetLoadouts() {
			if row.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
				t.Fatalf("lost validation: %+v", row)
			}
		}
		if driver.probes != round {
			t.Fatalf("round %d: parsed identical metadata %d times, bytes=%d", round, driver.probes, driver.bytes)
		}
		if driver.projections != round*len(rows) || driver.combinations != round*len(rows) {
			t.Fatal("per-loadout binding or combination validation was skipped")
		}
	}
	for _, row := range rows[:2] {
		if _, err := svc.GetLoadout(ctx, &runtimev1.GetLoadoutRequest{LoadoutId: row.GetLoadoutId()}); err != nil {
			t.Fatal(err)
		}
	}
	if driver.probes != 4 {
		t.Fatalf("separate reads reused old metadata: %d", driver.probes)
	}
}

func projectionFixturePath(t *testing.T, svc *Service, row *runtimev1.Loadout) string {
	t.Helper()
	assetID := row.GetModelAxes()[0].GetModelAssetId()
	asset := svc.modelAssets[assetID]
	return filepath.Join(svc.modelAssetDirectories[assetID], filepath.FromSlash(asset.GetEntry()))
}

func TestMachineProbePassDoesNotAliasDriverInput(t *testing.T) {
	svc, driver, _ := repeatedProjectionFixture(t, 3)
	driver.afterProjection = func(input capabilitydriver.ModelAssetBindingInput) {
		clear(input.Entry.FormatProbe)
		for _, file := range input.Files {
			clear(file.FormatProbe)
		}
	}
	response, err := svc.GetMachineLoadouts(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range response.GetAggregate().GetLoadouts() {
		if row.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
			t.Fatal("consumer mutation corrupted another row")
		}
	}
	if driver.probes != 1 || driver.projections != 3 {
		t.Fatalf("probe/binding counts: %d/%d", driver.probes, driver.projections)
	}
}

func TestMachineProbePassCancellationDiscardsRead(t *testing.T) {
	svc, driver, _ := repeatedProjectionFixture(t, 3)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	driver.afterProjection = func(capabilitydriver.ModelAssetBindingInput) { cancel() }
	if _, err := svc.GetMachineLoadouts(ctx, nil); status.Code(err) != codes.Canceled {
		t.Fatalf("canceled projection returned success: %v", err)
	}
	if driver.probes != 1 || driver.projections != 1 {
		t.Fatal("canceled read continued")
	}
	driver.afterProjection = nil
	if _, err := svc.GetMachineLoadouts(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if driver.probes != 2 {
		t.Fatal("later read reused canceled pass")
	}
}

func TestMachineProbePassRechecksFileReplacementWithinRead(t *testing.T) {
	svc, driver, rows := repeatedProjectionFixture(t, 3)
	path := projectionFixturePath(t, svc, rows[0])
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	changed := bytes.Replace(data, []byte("bert"), []byte("bad!"), 1)
	if bytes.Equal(data, changed) {
		t.Fatal("fixture architecture missing")
	}
	driver.afterProjection = func(capabilitydriver.ModelAssetBindingInput) {
		if driver.projections != 1 {
			return
		}
		// Equal size and mtime, different physical file: identity must miss.
		other := path + ".replacement"
		if err := os.WriteFile(other, changed, info.Mode()); err != nil {
			t.Fatal(err)
		}
		if err := os.Chtimes(other, info.ModTime(), info.ModTime()); err != nil {
			t.Fatal(err)
		}
		if err := os.Rename(other, path); err != nil {
			t.Fatal(err)
		}
	}
	response, err := svc.GetMachineLoadouts(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	configured := 0
	for _, row := range response.GetAggregate().GetLoadouts() {
		if row.GetValidationState() == runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
			configured++
		}
	}
	if configured != 1 || driver.probes != 3 {
		t.Fatalf("replacement or failure was cached: configured=%d probes=%d", configured, driver.probes)
	}
}

func TestMachineProbePassNeverSurvivesNextReadOrAdmission(t *testing.T) {
	for _, target := range []string{"next-read", "admission"} {
		t.Run(target, func(t *testing.T) {
			svc, driver, rows := repeatedProjectionFixture(t, 3)
			if _, err := svc.GetMachineLoadouts(context.Background(), nil); err != nil {
				t.Fatal(err)
			}
			path := projectionFixturePath(t, svc, rows[0])
			info, err := os.Stat(path)
			if err != nil {
				t.Fatal(err)
			}
			data, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			if target == "next-read" {
				data = bytes.Replace(data, []byte("bert"), []byte("bad!"), 1)
			} else {
				data[len(data)-1] ^= 0xff
			}
			if err := os.WriteFile(path, data, info.Mode()); err != nil {
				t.Fatal(err)
			}
			if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
				t.Fatal(err)
			}
			if target == "next-read" {
				response, err := svc.GetMachineLoadouts(context.Background(), nil)
				if err != nil {
					t.Fatal(err)
				}
				for _, row := range response.GetAggregate().GetLoadouts() {
					if row.GetValidationState() == runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_CONFIGURED {
						t.Fatal("next read accepted stale format facts")
					}
				}
				if driver.probes != 4 {
					t.Fatal("failed format was reused")
				}
			} else {
				actual, requirements, err := svc.projectStoredLoadout(rows[0])
				if err != nil {
					t.Fatal(err)
				}
				_, reason, err := svc.resolveLoadoutModelAxisForAdmission(context.Background(), admissionPass{}, rows[0], actual, requirements[0], rows[0].GetModelAxes()[0])
				if err != nil || reason != runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH {
					t.Fatalf("fresh admission ignored payload drift: %v/%v", reason, err)
				}
			}
		})
	}
}

func TestMachineProbePassPreCancelledDoesNoWork(t *testing.T) {
	svc, driver, _ := repeatedProjectionFixture(t, 2)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := svc.GetMachineLoadouts(ctx, nil)
	if status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
	if driver.probes != 0 || driver.projections != 0 {
		t.Fatal("canceled call touched models")
	}
}
