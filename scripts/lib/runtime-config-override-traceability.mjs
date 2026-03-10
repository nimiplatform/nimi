function normalizeConfigSchemaKey(value) {
  const text = String(value || '').trim();
  if (!text) {
    return '';
  }
  return text
    .split('.')
    .map((segment) => segment.replace(/[_-]/g, '').toLowerCase())
    .filter(Boolean)
    .join('.');
}

function findEnclosingRuntimeRuleId(lines, lineIndex) {
  for (let i = lineIndex; i >= 0; i -= 1) {
    const match = /^##\s+(K-[A-Z]+-\d{3}[a-z]?)\b/u.exec(lines[i]);
    if (match?.[1]) {
      return match[1];
    }
  }
  return '';
}

export function checkConfigOverrideTraceability(input) {
  const {
    configSchemaPath,
    fail,
    read,
    readYaml,
    runtimeMarkdownFiles,
  } = input;

  const configSchema = readYaml(configSchemaPath);
  const fields = Array.isArray(configSchema?.fields) ? configSchema.fields : [];
  if (fields.length === 0) {
    fail(`${configSchemaPath} must define at least one config field`);
    return;
  }

  const configFieldByKey = new Map();
  for (const field of fields) {
    const key = String(field?.key || '').trim();
    const sourceRule = String(field?.source_rule || '').trim();
    if (!key) {
      fail(`${configSchemaPath} contains field with empty key`);
      continue;
    }
    const normalizedKey = normalizeConfigSchemaKey(key);
    if (!normalizedKey) {
      fail(`${configSchemaPath} contains field with unparseable key: ${key}`);
      continue;
    }
    const existing = configFieldByKey.get(normalizedKey);
    if (existing && existing.key !== key) {
      fail(`${configSchemaPath} contains conflicting normalized keys: ${existing.key} vs ${key}`);
      continue;
    }
    configFieldByKey.set(normalizedKey, {
      key,
      sourceRule,
    });
  }

  const overridePattern = /可通过\s*`?K-DAEMON-009`?.*配置覆盖/u;
  for (const rel of runtimeMarkdownFiles) {
    const content = read(rel);
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
      if (!overridePattern.test(lines[i])) {
        continue;
      }

      const enclosingRuleId = findEnclosingRuntimeRuleId(lines, i);
      if (!enclosingRuleId) {
        fail(`${rel}:${i + 1} claims K-DAEMON-009 config override outside a kernel rule section`);
        continue;
      }

      const contextWindow = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 3)).join('\n');
      const canonicalMatches = new Map();
      for (const match of contextWindow.matchAll(/`([^`]+)`/g)) {
        const candidate = String(match[1] || '').trim();
        if (!candidate || /^K-[A-Z]+-\d{3}[a-z]?$/u.test(candidate)) {
          continue;
        }
        const normalizedCandidate = normalizeConfigSchemaKey(candidate);
        if (!normalizedCandidate) {
          continue;
        }
        const configField = configFieldByKey.get(normalizedCandidate);
        if (configField) {
          canonicalMatches.set(configField.key, configField);
        }
      }

      if (canonicalMatches.size === 0) {
        fail(`${rel}:${i + 1} claims K-DAEMON-009 config override for ${enclosingRuleId}, but no canonical config-schema.yaml key is referenced nearby`);
        continue;
      }

      if (canonicalMatches.size > 1) {
        fail(`${rel}:${i + 1} claims K-DAEMON-009 config override for ${enclosingRuleId}, but nearby context is ambiguous across keys: ${[...canonicalMatches.keys()].join(', ')}`);
        continue;
      }

      const configField = [...canonicalMatches.values()][0];
      if (!configField) {
        fail(`${rel}:${i + 1} claims K-DAEMON-009 config override for ${enclosingRuleId}, but config key lookup failed`);
        continue;
      }

      if (!configField.sourceRule) {
        fail(`${configSchemaPath} field ${configField.key} must declare source_rule`);
        continue;
      }

      if (configField.sourceRule !== enclosingRuleId) {
        fail(`${rel}:${i + 1} claims K-DAEMON-009 config override for ${enclosingRuleId}, but key ${configField.key} belongs to ${configField.sourceRule}`);
      }
    }
  }
}
