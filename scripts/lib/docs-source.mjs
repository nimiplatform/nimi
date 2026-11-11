import fs from 'node:fs';
import path from 'node:path';

const marker = /^<!-- nimi-docs: (.+) -->$/gmu;
const ownSource = /^https:\/\/github\.com\/nimiplatform\/nimi\/blob\/main\/([^?#]+)(?:[?#].*)?$/u;

function filesUnder(root, accept) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    if (['node_modules', '.vitepress', 'superpowers'].includes(entry.name)) return [];
    const file = path.join(root, entry.name);
    return entry.isDirectory() ? filesUnder(file, accept) : entry.isFile() && accept(file) ? [file] : [];
  });
}

function inside(root, value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || path.isAbsolute(value)) throw new Error(`invalid repository path: ${value}`);
  const resolved = path.resolve(root, value);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error(`path leaves repository: ${value}`);
  return resolved;
}

function stringList(value, field) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error(`${field} must be a string array`);
  return [...new Set(value)];
}

// This is a link index over formatter-owned IDs, not a replacement AuthorityIR
// or semantic validator. nimicoding authority check retains canonical validation.
export function authorityLinkIndex(repoRoot) {
  const index = new Map();
  for (const file of filesUnder(path.join(repoRoot, '.nimi/spec'), name => /\.authority\.(yaml|md)$/u.test(name))) {
    const text = fs.readFileSync(file, 'utf8');
    const markdown = file.endsWith('.md');
    const ids = [...text.matchAll(markdown ? /^id: ([a-z0-9.-]+)$/gmu : /^  - id: ([a-z0-9.-]+)$/gmu)];
    for (const [position, match] of ids.entries()) {
      if (index.has(match[1])) throw new Error(`duplicate authority link target: ${match[1]}`);
      const block = text.slice(match.index, ids[position + 1]?.index ?? text.length);
      index.set(match[1], { file: path.relative(repoRoot, file).replaceAll('\\', '/'), removed: /^\s*lifecycle: removed\s*$/mu.test(block) });
    }
  }
  return index;
}

export function readDocsSources(repoRoot) {
  const authority = authorityLinkIndex(repoRoot);
  const pages = filesUnder(path.join(repoRoot, 'docs'), file => file.endsWith('.md') && path.basename(file) !== 'AGENTS.md');
  return pages.map(file => {
    const relative = path.relative(repoRoot, file).replaceAll('\\', '/');
    const text = fs.readFileSync(file, 'utf8');
    const matches = [...text.matchAll(marker)];
    if (matches.length > 1) throw new Error(`${relative}: duplicate nimi-docs metadata`);
    const metadata = matches.length ? JSON.parse(matches[0][1]) : null;
    if (metadata !== null && (!metadata || Array.isArray(metadata) || typeof metadata !== 'object'
      || Object.keys(metadata).some(key => !['authority', 'sources'].includes(key)))) throw new Error(`${relative}: invalid nimi-docs metadata`);
    const ids = metadata ? stringList(metadata.authority, `${relative}: authority`) : [];
    const sources = metadata ? stringList(metadata.sources, `${relative}: sources`) : [];
    const authorityFiles = ids.map(id => {
      const target = authority.get(id);
      if (!target || target.removed) throw new Error(`${relative}: ${target ? 'removed' : 'missing'} authority ${id}`);
      return target.file;
    });
    sources.forEach(source => inside(repoRoot, source));
    return { file: relative, text, ids, sources, authorityFiles, mapped: metadata !== null };
  });
}

export function checkDocsSources(repoRoot) {
  const records = readDocsSources(repoRoot);
  const errors = [];
  const exists = (record, target, line) => {
    try {
      if (!fs.existsSync(inside(repoRoot, target))) errors.push(`${record.file}:${line}: missing source ${target}`);
    } catch (error) { errors.push(`${record.file}:${line}: ${error.message}`); }
  };
  for (const record of records) {
    const basis = /^## Source Basis\s*$/mu.exec(record.text);
    if (!basis) { errors.push(`${record.file}: missing Source Basis`); continue; }
    const tail = record.text.slice(basis.index);
    for (const link of tail.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)) {
      const match = ownSource.exec(link[1]);
      if (!match) continue; // Other repositories and release URLs have external owners.
      const line = record.text.slice(0, basis.index + link.index).split('\n').length;
      exists(record, decodeURIComponent(match[1]), line);
    }
    for (const source of record.sources) exists(record, source, 1);
    for (const include of record.text.matchAll(/^<<<\s+([^\s#{]+)(?:.*)$/gmu)) {
      const target = path.relative(repoRoot, path.resolve(repoRoot, path.dirname(record.file), include[1])).replaceAll('\\', '/');
      exists(record, target, record.text.slice(0, include.index).split('\n').length);
    }
    if (record.mapped && !record.file.startsWith('docs/zh/')) {
      const counterpart = records.find(row => row.file === record.file.replace('docs/', 'docs/zh/'));
      const bindings = row => JSON.stringify({ ids: [...row.ids].sort(), sources: [...row.sources].sort() });
      if (!counterpart?.mapped || bindings(record) !== bindings(counterpart)) errors.push(`${record.file}: Chinese counterpart must reference the same authority and sources`);
    }
  }
  return { pages: records.length, mappedPages: records.filter(row => row.mapped).length, errors };
}

// File-level selection is deliberately conservative: candidates need semantic
// review; a matching reference or a passing build is not conformance evidence.
export function selectDocsReview(repoRoot, changedFiles) {
  const records = readDocsSources(repoRoot);
  const changed = changedFiles.map(file => file.replaceAll('\\', '/'));
  const selected = records.filter(record => changed.includes(record.file) || record.mapped && changed.some(file =>
    record.authorityFiles.includes(file) || record.sources.some(source => file === source || file.startsWith(source.replace(/\/$/u, '') + '/'))));
  const result = new Set(selected.map(row => row.file));
  for (const file of [...result]) {
    const peer = file.startsWith('docs/zh/') ? file.replace('docs/zh/', 'docs/') : file.replace('docs/', 'docs/zh/');
    if (records.some(row => row.file === peer)) result.add(peer);
  }
  return [...result].sort();
}
