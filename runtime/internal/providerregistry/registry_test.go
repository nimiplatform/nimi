package providerregistry

import "testing"

func TestRemoteProviderSetReturnsCopy(t *testing.T) {
	set := RemoteProviderSet()
	set["mutated"] = struct{}{}

	refreshed := RemoteProviderSet()
	if _, ok := refreshed["mutated"]; ok {
		t.Fatal("expected RemoteProviderSet to return a defensive copy")
	}
}

func TestSortedProviderIDsReturnsSortedCopy(t *testing.T) {
	ids := SortedProviderIDs()
	if len(ids) == 0 {
		t.Fatal("expected provider ids")
	}
	if ids[0] > ids[len(ids)-1] {
		t.Fatalf("expected sorted provider ids, got=%v", ids)
	}

	originalFirst := ids[0]
	ids[0] = "zzzz"
	refreshed := SortedProviderIDs()
	if refreshed[0] != originalFirst {
		t.Fatal("expected SortedProviderIDs to return a defensive copy")
	}
}
