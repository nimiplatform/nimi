//go:build windows

package main

import (
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"unsafe"

	"github.com/nimiplatform/nimi/runtime/internal/productrelease"
	"golang.org/x/sys/windows"
)

func preflightCandidateExtraction(root string, expected productrelease.Identity, key string, use productrelease.CandidateUse, payload, entries uint64) error {
	if _, err := os.Lstat(root); err == nil {
		existing, err := productrelease.InspectPreparedCandidate(root, expected, key, use)
		if err != nil {
			return err
		}
		if existing == productrelease.CandidateCompleteOwner {
			return nil
		}
	} else if !os.IsNotExist(err) {
		return err
	}
	return checkExtractionSpace(filepath.Dir(root), payload, entries)
}

func prepareWithBudget(version, rawBytes, rawEntries string) error {
	bytes, byteErr := strconv.ParseUint(rawBytes, 10, 64)
	entries, entryErr := strconv.ParseUint(rawEntries, 10, 64)
	if byteErr != nil || entryErr != nil || bytes == 0 || entries == 0 {
		return fmt.Errorf("UPDATE_EXTRACTION_BUDGET_INVALID")
	}
	return prepare(version, bytes, entries)
}

func extractionRequiredBytes(payload, entries, allocationUnit uint64) (uint64, error) {
	if payload == 0 || entries == 0 || allocationUnit == 0 || entries > math.MaxUint64/allocationUnit || payload > math.MaxUint64-entries*allocationUnit {
		return 0, fmt.Errorf("UPDATE_EXTRACTION_BUDGET_INVALID")
	}
	// One allocation unit per entry bounds file padding and directory blocks.
	// Existing bytes are already excluded from available space and are not
	// credited as reusable; same-version restaging uses this conservative bound.
	return payload + entries*allocationUnit, nil
}

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-013
func checkExtractionSpace(destination string, payload, entries uint64) error {
	existing := destination
	for {
		if _, err := os.Stat(existing); err == nil {
			break
		} else if !os.IsNotExist(err) {
			return err
		}
		parent := filepath.Dir(existing)
		if parent == existing {
			return fmt.Errorf("UPDATE_EXTRACTION_VOLUME_UNAVAILABLE")
		}
		existing = parent
	}
	encoded, err := windows.UTF16PtrFromString(existing)
	if err != nil {
		return err
	}
	volume := make([]uint16, 32768)
	if err := windows.GetVolumePathName(encoded, &volume[0], uint32(len(volume))); err != nil {
		return err
	}
	var sectors, bytesPerSector, freeClusters, totalClusters uint32
	ok, _, callErr := windows.NewLazySystemDLL("kernel32.dll").NewProc("GetDiskFreeSpaceW").Call(uintptr(unsafe.Pointer(&volume[0])), uintptr(unsafe.Pointer(&sectors)), uintptr(unsafe.Pointer(&bytesPerSector)), uintptr(unsafe.Pointer(&freeClusters)), uintptr(unsafe.Pointer(&totalClusters)))
	if ok == 0 {
		return callErr
	}
	required, err := extractionRequiredBytes(payload, entries, uint64(sectors)*uint64(bytesPerSector))
	if err != nil {
		return err
	}
	var available uint64
	if err := windows.GetDiskFreeSpaceEx(&volume[0], &available, nil, nil); err != nil {
		return err
	}
	if available < required {
		return fmt.Errorf("UPDATE_DISK_SPACE_INSUFFICIENT: required=%d available=%d", required, available)
	}
	return nil
}
