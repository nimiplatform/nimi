package config

import (
	"encoding/json"
	"fmt"
	"os"
	"sort"
)

type fileConfigMigration struct {
	fromVersion int
	toVersion   int
	apply       func(FileConfig) (FileConfig, error)
}

var fileConfigMigrations = []fileConfigMigration{
	{
		fromVersion: 0,
		toVersion:   1,
		apply: func(cfg FileConfig) (FileConfig, error) {
			cfg.SchemaVersion = 1
			return cfg, nil
		},
	},
}

func migrateFileConfig(path string, content []byte, parsed FileConfig) (FileConfig, error) {
	version := parsed.SchemaVersion
	if version == 0 {
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(content, &raw); err == nil {
			if _, hasSchema := raw["schemaVersion"]; hasSchema {
				return FileConfig{}, fmt.Errorf("schemaVersion must be %d", DefaultSchemaVersion)
			}
		}
	}
	if version == DefaultSchemaVersion {
		return parsed, nil
	}
	if version > DefaultSchemaVersion {
		return FileConfig{}, fmt.Errorf("schemaVersion must be %d", DefaultSchemaVersion)
	}

	migrated := parsed
	current := version
	registry := make(map[int]fileConfigMigration, len(fileConfigMigrations))
	for _, migration := range fileConfigMigrations {
		registry[migration.fromVersion] = migration
	}

	for current < DefaultSchemaVersion {
		migration, ok := registry[current]
		if !ok {
			known := make([]int, 0, len(registry))
			for fromVersion := range registry {
				known = append(known, fromVersion)
			}
			sort.Ints(known)
			return FileConfig{}, fmt.Errorf("no config migration registered from schemaVersion %d (known starts: %v)", current, known)
		}
		next, err := migration.apply(migrated)
		if err != nil {
			return FileConfig{}, fmt.Errorf("migrate runtime config schemaVersion %d->%d: %w", migration.fromVersion, migration.toVersion, err)
		}
		migrated = next
		current = migration.toVersion
	}

	if err := ValidateFileConfig(migrated); err != nil {
		return FileConfig{}, err
	}
	if path == "" {
		return migrated, nil
	}
	if err := backupAndRewriteMigratedConfig(path, content, migrated); err != nil {
		return FileConfig{}, err
	}
	return migrated, nil
}

func backupAndRewriteMigratedConfig(path string, previous []byte, migrated FileConfig) error {
	backupPath := path + ".bak"
	if err := writeBytesAtomic(backupPath, previous, 0o600); err != nil {
		return fmt.Errorf("backup runtime config before migration: %w", err)
	}
	if err := WriteFileConfig(path, migrated); err != nil {
		_ = os.Remove(backupPath)
		return fmt.Errorf("write migrated runtime config: %w", err)
	}
	return nil
}
