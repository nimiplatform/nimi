#!/usr/bin/env node
// One-time repair for cf90c8d9e data roots after the b1cae3a source-class cutover.
// Explicit tooling only: never invoked by Runtime startup or installation.
import { closeSync, existsSync, openSync } from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const tables = ['canonical_registration', 'app_package_job', 'committed_app_release'];
const compact = (sql) => sql.toLowerCase().replace(/\s+/g, '');

function widenConstraint(sql, before, after, table) {
  if (compact(sql).includes(compact(after))) return sql;
  const pattern = before.split(/\s+/).map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  const replacement = sql.replace(new RegExp(pattern, 'i'), after);
  if (replacement === sql) throw new Error(`Unsupported ${table} constraint; expected the cf90c8d9e or current source schema`);
  return replacement;
}

function repairPlan(db) {
  return tables.flatMap((table) => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!row) throw new Error(`Missing ${table}; this tool only repairs an existing App kernel`);
    let sql = widenConstraint(row.sql,
      table === 'canonical_registration' ? "source_class IN ('verified','local_development')" : "source_class IN ('verified')",
      table === 'canonical_registration' ? "source_class IN ('verified','user_imported','local_development')" : "source_class IN ('verified','user_imported')", table);
    if (table === 'canonical_registration') {
      sql = widenConstraint(sql, "source_class = 'verified' AND shell_kind = 0", "source_class IN ('verified','user_imported') AND shell_kind = 0", table);
    }
    if (table === 'app_package_job') {
      sql = widenConstraint(sql, "'queued','downloading','verifying'", "'queued','downloading','reading-local','verifying'", table);
    }
    return sql === row.sql ? [] : [{ table, sql }];
  });
}

// Table rebuild follows https://www.sqlite.org/lang_altertable.html#otheralter
// Existing rows, indexes, triggers and foreign-key references are preserved.
export async function repairAppSourceSchema(dbPath, { apply = false, backupPath = `${dbPath}.before-app-source-cutover.sqlite` } = {}) {
  if (!path.isAbsolute(dbPath) || !existsSync(dbPath)) throw new Error('An explicit existing absolute --db path is required');
  const db = new DatabaseSync(dbPath, { readOnly: !apply });
  let transaction = false;
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (apply) {
      db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE');
      transaction = true;
    }
    const plan = repairPlan(db);
    if (apply && plan.length > 0) {
      if (!path.isAbsolute(backupPath)) throw new Error('--backup must be an absolute path');
      // Keep the write reservation while another read-only connection takes a
      // consistent SQLite backup. Concurrent Runtime writes wait for commit.
      closeSync(openSync(backupPath, 'wx', 0o600));
      const source = new DatabaseSync(dbPath, { readOnly: true });
      try { await backup(source, backupPath); } finally { source.close(); }
      for (const { table, sql } of plan) {
        const temporary = `${table}_source_cutover`;
        const schema = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table);
        const create = sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|\w+)/i, `CREATE TABLE "${temporary}"`);
        db.exec(create);
        db.exec(`INSERT INTO "${temporary}" SELECT * FROM "${table}"`);
        db.exec(`DROP TABLE "${table}"`);
        db.exec(`ALTER TABLE "${temporary}" RENAME TO "${table}"`);
        for (const item of schema) db.exec(item.sql);
      }
      if (db.prepare('PRAGMA foreign_key_check').all().length > 0) throw new Error('App source repair failed foreign-key validation');
      const integrity = db.prepare('PRAGMA quick_check').all();
      if (integrity.length !== 1 || integrity[0].quick_check !== 'ok') throw new Error('App source repair failed SQLite integrity validation');
    }
    if (transaction) {
      db.exec('COMMIT');
      transaction = false;
    }
    return { tables: plan.map(({ table }) => table), applied: apply && plan.length > 0, backupPath: apply && plan.length > 0 ? backupPath : null };
  } finally {
    if (transaction) db.exec('ROLLBACK');
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { values } = parseArgs({ options: { db: { type: 'string' }, backup: { type: 'string' }, apply: { type: 'boolean', default: false } } });
    if (!values.db) throw new Error('Usage: pnpm runtime:repair-app-source-schema --db <absolute database path> [--apply] [--backup <absolute new backup path>]');
    const result = await repairAppSourceSchema(values.db, { apply: values.apply, ...(values.backup ? { backupPath: values.backup } : {}) });
    console.log(`${result.applied ? 'Repaired' : result.tables.length ? 'Repair required' : 'Already current'}: ${result.tables.join(', ') || 'App source schema'}`);
    if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
