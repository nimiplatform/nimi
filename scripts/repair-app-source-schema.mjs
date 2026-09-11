#!/usr/bin/env node
// One-time repair for pre-cutover App source and installed-shell data roots.
// Explicit tooling only: never invoked by Runtime startup or installation.
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const tables = ['canonical_registration', 'app_package_job', 'committed_app_release'];
const compact = (sql) => sql.toLowerCase().replace(/\s+/g, '');
const downloadQueueValues = {
  queue_order: '0', display_name: "''", target_version: "''", target_os: "''", target_arch: "''",
  previous_release_json: "''", updated_unix_nano: 'started_unix_nano',
};

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
    let repairInstalledShellKind = false;
    let sql = widenConstraint(row.sql,
      table === 'canonical_registration' ? "source_class IN ('verified','local_development')" : "source_class IN ('verified')",
      table === 'canonical_registration' ? "source_class IN ('verified','user_imported','local_development')" : "source_class IN ('verified','user_imported')", table);
    if (table === 'canonical_registration') {
      const legacyShell = /shell_kind\s+INTEGER\s+NOT\s+NULL\s+CHECK\s*\(\s*shell_kind\s*>\s*0\s*\)/i;
      if (legacyShell.test(sql)) {
        sql = sql.replace(legacyShell, 'shell_kind INTEGER NOT NULL')
          .replace(/\)\s*$/, ", CHECK((source_class IN ('verified','user_imported') AND shell_kind = 0) OR (source_class = 'local_development' AND shell_kind > 0)))");
        repairInstalledShellKind = true;
      } else {
        sql = widenConstraint(sql, "source_class = 'verified' AND shell_kind = 0", "source_class IN ('verified','user_imported') AND shell_kind = 0", table);
      }
    }
    if (table === 'app_package_job') {
      if (!sql.includes("'reading-local'")) {
        sql = widenConstraint(sql, "'queued','downloading','verifying'", "'queued','downloading','reading-local','verifying'", table);
      }
      const columns = new Set(db.prepare('PRAGMA table_info(app_package_job)').all().map(({ name }) => name));
      const present = Object.keys(downloadQueueValues).filter((name) => columns.has(name));
      if (present.length !== 0 && present.length !== Object.keys(downloadQueueValues).length) {
        throw new Error('Unsupported partial App download queue schema');
      }
      if (present.length === 0) {
        const active = db.prepare("SELECT COUNT(*) AS count FROM app_package_job WHERE phase NOT IN ('completed','failed','canceled')").get();
        if (active.count !== 0) {
          throw new Error('Finish or cancel active App package jobs in the current Runtime before this one-time schema repair');
        }
        // The tool uses the current owner DDL instead of maintaining another
        // schema. Historical terminal jobs keep their facts; missing display
        // metadata and an old update baseline are never invented.
        const source = readFileSync(new URL('../runtime/internal/localappkernel/package_lifecycle.go', import.meta.url), 'utf8');
        const current = source.match(/`(CREATE TABLE IF NOT EXISTS app_package_job \([\s\S]*?)`/);
        if (!current) throw new Error('Current App package owner DDL is unavailable');
        sql = current[1];
      }
    }
    return sql === row.sql ? [] : [{ table, sql, repairInstalledShellKind }];
  });
}

// Table rebuild follows https://www.sqlite.org/lang_altertable.html#otheralter
// Preserve identities, bindings, indexes, triggers and foreign-key references;
// only legacy installed shell kinds are normalized to the current owner value.
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
      for (const { table, sql, repairInstalledShellKind } of plan) {
        const temporary = `${table}_source_cutover`;
        const schema = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name = ? AND type IN ('index','trigger') AND sql IS NOT NULL").all(table);
        const create = sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"[^"]+"|\w+)/i, `CREATE TABLE "${temporary}"`);
        db.exec(create);
        const columns = db.prepare(`PRAGMA table_info("${table}")`).all();
        const oldNames = new Set(columns.map(({ name }) => name));
        const newColumns = db.prepare(`PRAGMA table_info("${temporary}")`).all();
        const newNames = new Set(newColumns.map(({ name }) => name));
        if (columns.some(({ name }) => !newNames.has(name))) throw new Error(`Unsupported ${table} columns would be lost`);
        const values = newColumns.map(({ name }) => {
          if (repairInstalledShellKind && name === 'shell_kind') return "CASE WHEN source_class IN ('verified','user_imported') THEN 0 ELSE shell_kind END";
          if (oldNames.has(name)) return `"${name.replaceAll('"', '""')}"`;
          if (table === 'app_package_job' && Object.hasOwn(downloadQueueValues, name)) return downloadQueueValues[name];
          throw new Error(`No explicit value for new ${table}.${name}`);
        }).join(', ');
        db.exec(`INSERT INTO "${temporary}" SELECT ${values} FROM "${table}"`);
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
