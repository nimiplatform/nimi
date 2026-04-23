/**
 * sqlite-bridge.ts — Typed Tauri IPC bridge for ParentOS SQLite operations.
 * Split by data domain so callers can keep a stable import path while AI and
 * humans can retrieve narrower bridge surfaces.
 */

export * from './sqlite-bridge-ai.js';
export * from './sqlite-bridge-family.js';
export * from './sqlite-bridge-growth.js';
export * from './sqlite-bridge-journal.js';
export * from './sqlite-bridge-orthodontic.js';
export * from './sqlite-bridge-records.js';
export * from './sqlite-bridge-reminders.js';
export * from './sqlite-bridge-system.js';
