"""One-time offline conversion of a pre-release Runtime AIConfig table.

Run with its Runtime stopped. The separate backup contains only the original
AIConfig rows. No other account tables or credentials are read or copied.
"""
import argparse
import os
from pathlib import Path
import sqlite3

OLD_COLUMNS = ["account_namespace", "owner_kind", "owner_id", "config_blob", "revision"]
COLUMNS = ", ".join(OLD_COLUMNS)

def migrate(source, backup):
    if not source.is_file() or source.is_symlink() or source.resolve() == backup.resolve():
        raise ValueError("Select the exact existing Runtime database and a separate new backup path")
    with sqlite3.connect(source.as_uri() + "?mode=rw", uri=True, isolation_level=None) as db:
        db.execute("BEGIN EXCLUSIVE")
        columns = [row[1] for row in db.execute("pragma table_info(runtime_ai_config)")]
        if columns == ["account_namespace", "owner_kind", "owner_id", "config_ref", "display_name", "is_default", "config_blob", "revision"]:
            db.rollback()
            return "already current"
        if columns != OLD_COLUMNS:
            raise ValueError("Unexpected AIConfig table; nothing changed")
        original = db.execute("SELECT " + COLUMNS + " FROM runtime_ai_config ORDER BY 1,2,3").fetchall()
        fd = os.open(backup, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        with sqlite3.connect(backup) as copy:
            schema = db.execute("SELECT sql FROM sqlite_schema WHERE type='table' AND name='runtime_ai_config'").fetchone()[0]
            copy.execute(schema)
            copy.executemany("INSERT INTO runtime_ai_config VALUES (?,?,?,?,?)", original)
        db.execute("ALTER TABLE runtime_ai_config RENAME TO old_runtime_ai_config")
        db.execute("""CREATE TABLE runtime_ai_config (
            account_namespace TEXT NOT NULL, owner_kind INTEGER NOT NULL, owner_id TEXT NOT NULL,
            config_ref TEXT NOT NULL DEFAULT 'main', display_name TEXT NOT NULL DEFAULT 'Default',
            is_default INTEGER NOT NULL DEFAULT 1 CHECK (is_default IN (0,1)), config_blob BLOB NOT NULL,
            revision INTEGER NOT NULL, PRIMARY KEY(account_namespace,owner_kind,owner_id,config_ref))""")
        db.execute("INSERT INTO runtime_ai_config ("+COLUMNS+") SELECT "+COLUMNS+" FROM old_runtime_ai_config")
        if db.execute("SELECT "+COLUMNS+" FROM runtime_ai_config ORDER BY 1,2,3").fetchall() != original:
            raise RuntimeError("AIConfig contents differ; reverting transaction")
        db.execute("CREATE UNIQUE INDEX runtime_ai_config_default ON runtime_ai_config(account_namespace,owner_kind,owner_id) WHERE is_default=1")
        db.execute("CREATE UNIQUE INDEX runtime_ai_config_name ON runtime_ai_config(account_namespace,owner_kind,owner_id,display_name)")
        db.execute("DROP TABLE old_runtime_ai_config")
        db.commit()
        return f"preserved {len(original)} owner records and their revisions"

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("backup", type=Path)
    args = parser.parse_args()
    print(migrate(args.source.absolute(), args.backup.absolute()))
