package aiconfig

import (
	"context"
	"errors"
	"testing"

	v1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func TestNamedAppRecordsKeepOwnerDefaultAndRevisionsIndependent(t *testing.T) {
	db, e := runtimepersistence.Open(nil, t.TempDir()+"/local-state.json")
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { db.Close() })
	sql, e := NewSQLiteStore(db)
	if e != nil {
		t.Fatal(e)
	}
	for name, store := range map[string]RecordStore{"memory": NewMemoryStore(), "sqlite": sql} {
		t.Run(name, func(t *testing.T) {
			ctx := context.Background()
			config := &v1.AIConfig{Owner: appOwner("ai.nimi.harness"), Capabilities: []*v1.AIConfigCapabilityIntent{localIntent(t, "text.generate", nil, nil)}}
			empty := &v1.AIConfig{Owner: config.Owner}
			put := func(expected string, c *v1.AIConfig, edit *v1.AppAIConfigRecordEdit) RecordSnapshot {
				r, ok, e := store.EditRecord(ctx, "account", expected, c, edit)
				if !ok || e != nil {
					t.Fatalf("write: %v %v", ok, e)
				}
				return r
			}
			main := put("0", config, nil)
			alt := put("0", config, &v1.AppAIConfigRecordEdit{Change: &v1.AppAIConfigRecordEdit_CreateName{CreateName: "Work"}})
			if alt.Record.IsDefault || alt.Record.ConfigRef == main.Record.ConfigRef {
				t.Fatal("alternate replaced the default")
			}
			if got, e := store.ReadRecord(ctx, "other", config.Owner, alt.Record.ConfigRef, false); e != nil || got.Record != nil {
				t.Fatal("cross-account reference resolved")
			}
			if got, e := store.ReadRecord(ctx, "account", appOwner("another.app"), alt.Record.ConfigRef, false); e != nil || got.Record != nil {
				t.Fatal("cross-App reference resolved")
			}
			changed := put(alt.Revision(), empty, &v1.AppAIConfigRecordEdit{ConfigRef: alt.Record.ConfigRef, Change: &v1.AppAIConfigRecordEdit_MakeDefault{MakeDefault: true}})
			if !changed.Record.IsDefault {
				t.Fatal("new default unavailable")
			}
			if _, ok, _ := store.EditRecord(ctx, "account", main.Revision(), config, nil); ok {
				t.Fatal("stale implicit default overwrite accepted")
			}
			got, e := store.ReadRecord(ctx, "account", config.Owner, "", true)
			if e != nil || len(got.Records) != 2 || got.Record.ConfigRef != alt.Record.ConfigRef {
				t.Fatal("directory inconsistent", e)
			}
			if _, _, e := store.EditRecord(ctx, "account", changed.Revision(), empty, &v1.AppAIConfigRecordEdit{ConfigRef: alt.Record.ConfigRef, Change: &v1.AppAIConfigRecordEdit_DeleteRecord{DeleteRecord: true}}); !errors.Is(e, ErrRecordInvalid) {
				t.Fatal("deleted current default", e)
			}
			local := &v1.AIConfig{Owner: LocalAgentSubsystemOwner()}
			if _, _, e := store.EditRecord(ctx, "account", "0", local, &v1.AppAIConfigRecordEdit{Change: &v1.AppAIConfigRecordEdit_CreateName{CreateName: "Agent"}}); !errors.Is(e, ErrRecordInvalid) {
				t.Fatal("created named LocalAgent record", e)
			}
		})
	}
}
