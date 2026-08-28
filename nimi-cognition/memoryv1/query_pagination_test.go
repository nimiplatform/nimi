package memoryv1

import (
	"context"
	"testing"
)

func TestListMemoriesPageUsesStableSeekAcrossEqualTimestamps(t *testing.T) {
	core := openTestCore(t, t.TempDir())
	ctx := context.Background()
	bank := ensureTestBank(t, core, "binding-page")
	for index, content := range []string{"I prefer cedar forests", "I prefer jasmine tea", "I prefer quiet mornings"} {
		rememberText(t, core, bank, uint64(index+1), content)
	}
	first, err := core.ListMemoriesPage(ctx, MemoryPageRequest{BankRef: bank.BankRef, Limit: 2})
	if err != nil || len(first.Items) != 2 || !first.HasMore {
		t.Fatalf("first page: page=%+v err=%v", first, err)
	}
	cursor := first.Items[len(first.Items)-1]
	second, err := core.ListMemoriesPage(ctx, MemoryPageRequest{
		BankRef: bank.BankRef, Limit: 2, AfterUpdatedAt: formatTime(cursor.UpdatedAt), AfterMemoryRef: cursor.MemoryRef,
	})
	if err != nil || len(second.Items) != 1 || second.HasMore {
		t.Fatalf("second page: page=%+v err=%v", second, err)
	}
	seen := map[string]struct{}{}
	for _, item := range append(first.Items, second.Items...) {
		if _, duplicate := seen[item.MemoryRef]; duplicate {
			t.Fatalf("seek pagination duplicated %q", item.MemoryRef)
		}
		seen[item.MemoryRef] = struct{}{}
	}
	if len(seen) != 3 {
		t.Fatalf("seek pagination returned %d unique memories, want 3", len(seen))
	}
}
