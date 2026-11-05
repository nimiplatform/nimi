import ts from 'typescript';

const displayAttributes = new Set(['aria-label', 'placeholder', 'title', 'label', 'description']);

export function extractI18nCandidates(source, filename) {
  // The HTML entrypoint keeps its existing quoted-attribute audit scope.
  if (filename.endsWith('.html')) {
    return [...source.matchAll(/\b(?:aria-label|placeholder|title|label|description)\s*=\s*["'`]([^"'`]+)["'`]/g)]
      .map(match => ({
        text: match[1].trim(),
        line: source.slice(0, match.index).split('\n').length,
      }))
      .filter(candidate => candidate.text);
  }

  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const diagnostic = file.parseDiagnostics[0];
  if (diagnostic) {
    const line = file.getLineAndCharacterOfPosition(diagnostic.start ?? 0).line + 1;
    throw new Error(`${filename}:${line}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
  }

  const candidates = [];
  const add = (text, position) => {
    const first = text.search(/\S/u);
    if (first < 0) return;
    candidates.push({
      text: text.trim().replace(/\s+/gu, ' '),
      line: file.getLineAndCharacterOfPosition(position + first).line + 1,
    });
  };
  const visit = node => {
    if (ts.isJsxText(node)) {
      add(node.text, node.pos);
    } else if (ts.isJsxAttribute(node) && displayAttributes.has(node.name.getText(file))
      && node.initializer && ts.isStringLiteral(node.initializer)) {
      add(node.initializer.text, node.initializer.getStart(file) + 1);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return candidates;
}
