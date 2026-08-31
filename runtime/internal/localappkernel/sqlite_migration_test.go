package localappkernel

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"testing"
)

func TestOpenSQLiteMigratesLegacyCanonicalRegistration(t *testing.T) {
	dataRoot := t.TempDir()
	databasePath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-1000-1001-1002-1003")
	anchor, err := identity.LocalOSUserAnchor()
	if err != nil {
		t.Fatal(err)
	}
	legacy, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath)+"?_pragma=foreign_keys(ON)")
	if err != nil {
		t.Fatal(err)
	}
	createLegacyRegistrationSchema(t, legacy)
	type legacyRow struct {
		handle, subject, appID, sourceClass, sourceDigest string
	}
	rows := []legacyRow{
		{"lar_v1_installed", "las_v1_installed", "example.installed", "installed", "legacy-installed-lineage"},
		{"lar_v1_imported", "las_v1_imported", "example.imported", "local_import", "legacy-imported-lineage"},
		{"lar_v1_development", "las_v1_development", "example.development", "development", ""},
	}
	for _, row := range rows {
		if _, err := legacy.Exec(`INSERT INTO canonical_registration(
			registration_handle, registered_app_subject, app_id, display_name, source_class, source_ref,
			shell_kind, raw_declaration_json, activated_domains_json, source_generation, declaration_generation,
			source_digest, declaration_digest, state, created_unix_nano, updated_unix_nano, tombstoned_unix_nano
		) VALUES (?, ?, ?, ?, ?, ?, 1, '[]', '[]', 2, 3, ?, 'legacy-declaration', 'active', 1, 2, NULL)`,
			row.handle, row.subject, row.appID, row.appID, row.sourceClass, "legacy:"+row.appID, row.sourceDigest); err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
		if _, err := legacy.Exec(`INSERT INTO current_host_binding(
			host_install_id, local_os_user_scope, registration_handle, binding_slot, project_root,
			manifest_path, host_executable_digest, payload_root_digest, created_unix_nano, updated_unix_nano
		) VALUES ('host-install-migration', ?, ?, ?, ?, 'nimi.app.yaml', 'host-digest', 'payload-digest', 1, 2)`,
			anchor, row.handle, "slot-"+row.handle, filepath.Join(dataRoot, "projects", row.appID)); err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	kernel := openTestKernelAtDataRoot(t, dataRoot, identity, "host-install-migration", 0x71)
	t.Cleanup(func() { _ = kernel.Close() })
	wantSource := map[string]SourceClass{
		"lar_v1_installed":   SourceClassVerified,
		"lar_v1_imported":    SourceClassUserImported,
		"lar_v1_development": SourceClassLocalDevelopment,
	}
	for _, row := range rows {
		registration, err := kernel.Registrations().GetByHandle(context.Background(), row.handle)
		if err != nil {
			t.Fatalf("read migrated registration %s: %v", row.handle, err)
		}
		if registration.RegistrationHandle != row.handle || registration.RegisteredAppSubject != row.subject ||
			registration.SourceClass != wantSource[row.handle] || registration.ImmutableLineageID != "" ||
			len(registration.ProvenanceAttestationRefs) != 0 || registration.ProvenanceRevision != 0 ||
			registration.ExecutionProfileRef != "" || registration.SourceGeneration != 2 || registration.DeclarationGeneration != 3 {
			t.Fatalf("migrated registration = %+v", registration)
		}
		status, err := kernel.Registrations().Status(context.Background(), row.handle)
		if err != nil {
			t.Fatalf("read migrated status %s: %v", row.handle, err)
		}
		wantAvailable := row.sourceClass == "development"
		if !status.CurrentHostBound || status.Available != wantAvailable {
			t.Fatalf("migrated status = %+v, want available=%v", status, wantAvailable)
		}
	}
	columns, err := sqliteTableColumns(context.Background(), kernel.db, "canonical_registration")
	if err != nil {
		t.Fatal(err)
	}
	if columns["source_digest"] || !columns["immutable_lineage_id"] || !columns["provenance_attestation_refs_json"] {
		t.Fatalf("migration left a legacy or incomplete schema: %#v", columns)
	}
}

func TestOpenSQLiteRollsBackLegacyMigrationOnForeignKeyFailure(t *testing.T) {
	dataRoot := t.TempDir()
	databasePath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatal(err)
	}
	legacy, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath))
	if err != nil {
		t.Fatal(err)
	}
	createLegacyRegistrationSchema(t, legacy)
	if _, err := legacy.Exec(`INSERT INTO current_host_binding(
		host_install_id, local_os_user_scope, registration_handle, binding_slot, project_root,
		manifest_path, host_executable_digest, payload_root_digest, created_unix_nano, updated_unix_nano
	) VALUES ('host-install-migration', 'owner', 'missing-handle', 'orphan', 'project', 'nimi.app.yaml', 'host', 'payload', 1, 1)`); err != nil {
		_ = legacy.Close()
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-2000-2001-2002-2003")
	if _, err := OpenSQLite(context.Background(), databasePath, identity, Options{
		HostInstallID: "host-install-migration",
		DataRoot:      dataRoot,
	}); err == nil {
		t.Fatal("legacy migration accepted an orphaned current-host binding")
	}
	inspected, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath))
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = inspected.Close() }()
	columns, err := sqliteTableColumns(context.Background(), inspected, "canonical_registration")
	if err != nil {
		t.Fatal(err)
	}
	if !columns["source_digest"] || columns["immutable_lineage_id"] {
		t.Fatalf("failed migration did not roll back the legacy schema: %#v", columns)
	}
}

func createLegacyRegistrationSchema(t *testing.T, database *sql.DB) {
	t.Helper()
	for _, statement := range []string{
		`CREATE TABLE canonical_registration (
			registration_handle TEXT PRIMARY KEY,
			registered_app_subject TEXT NOT NULL UNIQUE,
			app_id TEXT NOT NULL,
			display_name TEXT NOT NULL,
			source_class TEXT NOT NULL CHECK(source_class IN ('installed','local_import','development')),
			source_ref TEXT NOT NULL,
			shell_kind INTEGER NOT NULL CHECK(shell_kind > 0),
			raw_declaration_json TEXT NOT NULL,
			activated_domains_json TEXT NOT NULL,
			source_generation INTEGER NOT NULL CHECK(source_generation > 0),
			declaration_generation INTEGER NOT NULL CHECK(declaration_generation > 0),
			source_digest TEXT NOT NULL,
			declaration_digest TEXT NOT NULL,
			state TEXT NOT NULL CHECK(state IN ('active','tombstoned')),
			created_unix_nano INTEGER NOT NULL,
			updated_unix_nano INTEGER NOT NULL,
			tombstoned_unix_nano INTEGER,
			CHECK((state = 'active' AND tombstoned_unix_nano IS NULL) OR (state = 'tombstoned' AND tombstoned_unix_nano IS NOT NULL))
		)`,
		`CREATE TABLE current_host_binding (
			host_install_id TEXT NOT NULL,
			local_os_user_scope TEXT NOT NULL,
			registration_handle TEXT NOT NULL,
			binding_slot TEXT NOT NULL DEFAULT '',
			project_root TEXT NOT NULL,
			manifest_path TEXT NOT NULL,
			host_executable_digest TEXT NOT NULL,
			payload_root_digest TEXT NOT NULL,
			created_unix_nano INTEGER NOT NULL,
			updated_unix_nano INTEGER NOT NULL,
			PRIMARY KEY(host_install_id, local_os_user_scope, registration_handle),
			FOREIGN KEY(registration_handle) REFERENCES canonical_registration(registration_handle)
		)`,
		`CREATE TRIGGER canonical_registration_no_delete BEFORE DELETE ON canonical_registration
			BEGIN SELECT RAISE(ABORT, 'registered App subjects are permanently retained'); END`,
	} {
		if _, err := database.Exec(statement); err != nil {
			t.Fatal(err)
		}
	}
}
