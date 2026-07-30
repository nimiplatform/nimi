package localservice

import (
	"fmt"
	"path/filepath"
	"strings"
)

// ProductControlDataRootBinding is the read-only startup view of the fixed
// Product Control record. ProgramData state may prove and consume this
// selection, but it cannot supply a different data root.
type ProductControlDataRootBinding struct {
	RecordExists bool
	DataRoot     string
}

// ProductControlDataRootSecurityBinding carries the already-verified
// principal identities needed for independent platform access validation. An
// empty binding is admitted only on non-protected/unit surfaces.
type ProductControlDataRootSecurityBinding struct {
	InteractiveUserSID string
	RuntimeServiceSID  string
	InteractiveUserUID uint32
	RuntimeServiceUID  uint32
}

type productControlUsability struct {
	Selected       bool
	RepairRequired bool
}

func evaluateProductControlUsability(record *productControlRecord) productControlUsability {
	if record == nil {
		return productControlUsability{}
	}
	dataRootPath := selectedProductDataRootPath(record)
	selected := dataRootPath != "" &&
		record.DataRoot != nil &&
		(record.DataRoot.Status == productDataRootStatusSelected ||
			record.DataRoot.Status == productDataRootStatusReady)
	repairRequired := record.Repair.Required ||
		record.State == productControlStateRepairRequired ||
		record.State == productControlStateBlocked ||
		(record.DataRoot != nil &&
			record.DataRoot.Status == productDataRootStatusRepairRequired)
	return productControlUsability{
		Selected:       selected,
		RepairRequired: repairRequired,
	}
}

// LoadProductControlDataRootBinding reads and independently verifies the
// fixed <interactive-profile>/.nimi/nimi.json authority without creating,
// repairing, or selecting a path.
func LoadProductControlDataRootBinding(productControlRoot string, security ProductControlDataRootSecurityBinding) (ProductControlDataRootBinding, error) {
	root := filepath.Clean(strings.TrimSpace(productControlRoot))
	if root == "." || !filepath.IsAbs(root) ||
		root == filepath.VolumeName(root)+string(filepath.Separator) ||
		filepath.Base(root) != ".nimi" {
		return ProductControlDataRootBinding{}, fmt.Errorf("fixed Product Control root must be the absolute .nimi directory")
	}
	if err := validateProductControlRootPlatform(root, security); err != nil {
		return ProductControlDataRootBinding{}, fmt.Errorf("fixed Product Control root security validation failed: %w", err)
	}
	record, err := readProductControlRecord(filepath.Join(root, "nimi.json"))
	if err != nil {
		return ProductControlDataRootBinding{}, err
	}
	if record == nil {
		return ProductControlDataRootBinding{}, nil
	}
	if err := validateProductControlDataRootBindingRecord(record); err != nil {
		return ProductControlDataRootBinding{}, err
	}
	selectedRoot := selectedProductDataRootPath(record)
	if selectedRoot != "" {
		if err := validateProductControlDataRootBoundary(selectedRoot, root); err != nil {
			return ProductControlDataRootBinding{}, err
		}
	}
	if state, failure := verifyProductControlSelectedDataRoot(record, security); failure != "" {
		return ProductControlDataRootBinding{}, fmt.Errorf("Product Control data-root verification failed (%s): %s", state, failure)
	}
	return ProductControlDataRootBinding{
		RecordExists: true,
		DataRoot:     selectedRoot,
	}, nil
}

func validateProductControlDataRootBoundary(dataRoot string, productControlRoot string) error {
	selected := filepath.Clean(strings.TrimSpace(dataRoot))
	control := filepath.Clean(strings.TrimSpace(productControlRoot))
	home := filepath.Dir(control)
	if productControlPathsEqual(selected, home) ||
		productControlPathsEqual(selected, control) ||
		productControlPathIsWithin(selected, control) {
		return fmt.Errorf("Product Control data root must not overlap the interactive-user home or fixed .nimi boundary")
	}
	return nil
}

func productControlPathsEqual(left string, right string) bool {
	if filepath.Separator == '\\' {
		return strings.EqualFold(left, right)
	}
	return left == right
}

func productControlPathIsWithin(candidate string, root string) bool {
	relative, err := filepath.Rel(root, candidate)
	if err != nil || filepath.IsAbs(relative) {
		return false
	}
	return relative != "." &&
		relative != ".." &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func validateProductControlDataRootBindingRecord(record *productControlRecord) error {
	switch record.State {
	case productControlStateRepairRequired, productControlStateBlocked:
		return fmt.Errorf("Product Control state %q forbids data-root binding", record.State)
	case productControlStateConfigMissing, productControlStateDataRootMissing:
		if selectedProductDataRootPath(record) != "" {
			return fmt.Errorf("Product Control state %q cannot carry a usable dataRoot.path", record.State)
		}
	}
	if record.Repair.Required {
		return fmt.Errorf("Product Control requires repair; data-root binding is unavailable")
	}
	if record.DataRoot != nil && record.DataRoot.Status == productDataRootStatusRepairRequired {
		return fmt.Errorf("Product Control dataRoot.status %q forbids data-root binding", record.DataRoot.Status)
	}
	return nil
}
