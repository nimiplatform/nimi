import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

export function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

export function exists(filePath) {
  return fs.existsSync(filePath);
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function loadYamlFile(filePath) {
  return YAML.parse(readText(filePath));
}

export function writeYamlFile(filePath, value) {
  fs.writeFileSync(filePath, `${YAML.stringify(value)}`, 'utf8');
}

export function timestampNow() {
  return new Date().toISOString();
}

export function normalizeRel(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

export function resolveTopicPath(topicDir, relPath) {
  return path.join(topicDir, normalizeRel(relPath));
}

export function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/u);
  if (!match) {
    return {
      frontmatter: null,
      body: text,
    };
  }
  return {
    frontmatter: YAML.parse(match[1]) || {},
    body: text.slice(match[0].length),
  };
}

export function loadMarkdownDoc(filePath) {
  const raw = readText(filePath);
  const { frontmatter, body } = parseFrontmatter(raw);
  return {
    path: filePath,
    raw,
    frontmatter,
    body,
  };
}

export function listMarkdownHeadings(body) {
  const headings = [];
  for (const line of body.split(/\r?\n/u)) {
    const match = line.match(/^##\s+(.+?)\s*$/u);
    if (match) {
      headings.push(match[1]);
    }
  }
  return headings;
}

export function fail(message, errors) {
  errors.push(message);
}
