package localservice

import (
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const immutableHFRevisionForTest = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

func catalogItemOfferRefForTest(t *testing.T, item *runtimev1.LocalCatalogModelDescriptor) string {
	t.Helper()
	offer, err := catalogOfferFromCatalogItem(item)
	if err != nil {
		t.Fatalf("project catalog offer: %v", err)
	}
	return offer.offerRef
}

func installableCatalogItemForTest(itemID string, repo string, entry string, hashByte string) *runtimev1.LocalCatalogModelDescriptor {
	return &runtimev1.LocalCatalogModelDescriptor{
		ItemId:         itemID,
		Source:         "verified",
		Title:          itemID,
		ModelId:        itemID,
		Repo:           repo,
		Revision:       "main",
		Capabilities:   []string{"text.generate"},
		InstallKind:    "download",
		Entry:          entry,
		Files:          []string{entry},
		Hashes:         map[string]string{entry: strings.Repeat(hashByte, 64)},
		TotalSizeBytes: 1,
	}
}
