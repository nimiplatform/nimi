package appstorage

import (
	"bytes"
	"context"
	"fmt"
	"testing"
)

// A real changed value, not a no-op: each iteration changes and reads back a
// 14-byte document while the unrelated committed partition stays the same.
func BenchmarkLocalAppJSONChangedWrite(b *testing.B) {
	for _, size := range []int{128 << 10, 4 << 20, 12 << 20} {
		b.Run(fmt.Sprintf("partition-%d-KiB", size>>10), func(b *testing.B) {
			root := b.TempDir()
			store, err := NewLocalAppJSONStore(root)
			if err != nil {
				b.Fatal(err)
			}
			defer store.Close()
			ctx := context.Background()
			owner := ManagedOwner{AccountID: "benchmark-account", RegisteredAppSubject: "benchmark-subject"}
			remaining := size
			for i := 0; remaining > 0; i++ {
				n := min(remaining, LocalAppJSONMaxDocumentBytes)
				value := append(append([]byte{'"'}, bytes.Repeat([]byte{'x'}, n-2)...), '"')
				if _, err := store.Write(ctx, owner, fmt.Sprintf("bulk/value-%d.json", i), value, jsonTestCommit); err != nil {
					b.Fatal(err)
				}
				remaining -= n
			}
			values := [][]byte{[]byte(`{"revision":1}`), []byte(`{"revision":2}`)}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := store.Write(ctx, owner, "state/revision.json", values[i%2], jsonTestCommit); err != nil {
					b.Fatal(err)
				}
				got, err := store.Read(ctx, owner, "state/revision.json")
				if err != nil || !bytes.Equal(got.JSONValue, values[i%2]) {
					b.Fatalf("read-back: %s, %v", got.JSONValue, err)
				}
			}
		})
	}
}
