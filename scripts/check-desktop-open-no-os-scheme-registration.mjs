#!/usr/bin/env node
import { collectFiles, failWith, pass, read, rel } from './lib/desktop-open-checks.mjs';

const files = collectFiles([
  'apps/desktop/src-tauri',
  'apps/desktop/src',
  'kit',
], {
  extensions: new Set(['.json', '.rs', '.toml', '.ts', '.tsx', '.mjs', '.js']),
});

const failures = [];
for (const file of files) {
  const relPath = rel(file);
  if (relPath.endsWith('_tests.rs') || relPath.includes('/test/') || relPath.includes('/tests/')) {
    continue;
  }
  const text = read(relPath);
  if (/tauri-plugin-deep-link|deep_link\(\)|\.deep_link\(\)|register\(\s*["']nimi-desktop["']\s*\)/u.test(text)) {
    failures.push(`${relPath} contains Desktop Open forbidden OS scheme/deep-link registration text`);
  }
  if (relPath.endsWith('tauri.conf.json') && /"schemes"\s*:\s*\[[^\]]*"nimi-desktop"/u.test(text)) {
    failures.push(`${relPath} registers the nimi-desktop OS scheme`);
  }
  if (relPath.endsWith('Cargo.toml') && /tauri-plugin-deep-link/u.test(text)) {
    failures.push(`${relPath} depends on tauri-plugin-deep-link`);
  }
  if (relPath.endsWith('capabilities/default.json') && /deep-link:default/u.test(text)) {
    failures.push(`${relPath} admits deep-link permissions`);
  }
}

failWith('Desktop Open no OS scheme registration guard failed.', failures);
pass('desktop open no OS scheme registration guard passed');
