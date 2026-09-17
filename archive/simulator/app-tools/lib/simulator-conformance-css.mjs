import selectorParser from 'postcss-selector-parser';

import { SimulatorConformanceError } from './simulator-manifest.mjs';

function fail(code, message, fieldPath) {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

export function validateSimulatorCssSelectors(root, relativePath, rootClass, globalPrefix) {
  let usesRoot = false;
  root.walkRules((rule) => {
    let parent = rule.parent;
    let insideRootScope = false;
    while (parent) {
      if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return;
      if (parent.type === 'atrule'
        && parent.name.toLowerCase() === 'scope'
        && parent.params.trim() === `(.${rootClass})`) {
        insideRootScope = true;
        usesRoot = true;
      }
      parent = parent.parent;
    }
    selectorParser((selectors) => {
      selectors.each((selector) => {
        const classes = [];
        selector.walkClasses((classNode) => {
          classes.push(classNode.value);
        });
        const selectorOwnsRoot = classes.includes(rootClass);
        if (selectorOwnsRoot) usesRoot = true;
        const scoped = insideRootScope
          || selectorOwnsRoot
          || (classes.length > 0 && classes.every((value) => value.startsWith(globalPrefix)));
        if (!scoped) {
          fail('SIM_CSS_GLOBAL_SELECTOR', `unscoped selector ${JSON.stringify(selector.toString())} is forbidden`, relativePath);
        }
        if (!insideRootScope && !selectorOwnsRoot) {
          const invalid = classes.find((value) => !value.startsWith(globalPrefix));
          if (invalid) {
            fail('SIM_CSS_NAMESPACE', `CSS class ${JSON.stringify(invalid)} is outside the derived module namespace`, relativePath);
          }
        }
      });
    }).processSync(rule.selector);
  });
  return usesRoot;
}

export function validateSimulatorCssGlobalSymbols(root, relativePath, globalPrefix) {
  const propertyPrefix = `--${globalPrefix}`;
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--') && !declaration.prop.startsWith(propertyPrefix)) {
      fail('SIM_CSS_CUSTOM_PROPERTY_NAMESPACE', `App-owned custom property ${JSON.stringify(declaration.prop)} is outside ${propertyPrefix}*`, relativePath);
    }
  });
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (/keyframes$/u.test(name) && !rule.params.trim().startsWith(globalPrefix)) {
      fail('SIM_CSS_KEYFRAMES_NAMESPACE', `App-owned keyframes ${JSON.stringify(rule.params.trim())} are outside ${globalPrefix}*`, relativePath);
    }
    if (name === 'property' && !rule.params.trim().startsWith(propertyPrefix)) {
      fail('SIM_CSS_PROPERTY_NAMESPACE', `App-owned @property ${JSON.stringify(rule.params.trim())} is outside ${propertyPrefix}*`, relativePath);
    }
    if (name === 'layer' && rule.params.trim() === 'properties') {
      fail('SIM_CSS_RESERVED_LAYER', 'Tailwind foundation property layer is reserved to the shared foundation', relativePath);
    }
    if (name !== 'font-face') return;
    const family = rule.nodes?.find((node) => node.type === 'decl' && node.prop.toLowerCase() === 'font-family');
    const value = family?.value.trim().replace(/^['"]|['"]$/gu, '') || '';
    if (!value.startsWith(globalPrefix)) {
      fail('SIM_CSS_FONT_NAMESPACE', `App-owned font family ${JSON.stringify(value)} is outside ${globalPrefix}*`, relativePath);
    }
  });
}

export function validateSimulatorProductionFoundationCss(root, relativePath) {
  const selectors = [];
  root.walkAtRules((rule) => {
    if (rule.name.toLowerCase() !== 'import') {
      fail(
        'SIM_CSS_PRODUCTION_SECOND_TRUTH',
        `production host foundation cannot declare @${rule.name}`,
        relativePath,
      );
    }
  });
  root.walkRules((rule) => {
    if (rule.parent !== root) {
      fail('SIM_CSS_PRODUCTION_SECOND_TRUTH', 'production host foundation rules must be top-level', relativePath);
    }
    selectorParser((parsed) => {
      parsed.each((selector) => {
        const value = selector.toString().trim();
        if (![':root', 'html', 'body'].includes(value)) {
          fail(
            'SIM_CSS_PRODUCTION_SECOND_TRUTH',
            `App UI selector ${JSON.stringify(value)} must live in the canonical style closure`,
            relativePath,
          );
        }
        selectors.push(value);
      });
    }).processSync(rule.selector);
  });
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--')) {
      fail(
        'SIM_CSS_PRODUCTION_SECOND_TRUTH',
        'App custom properties must live in the canonical style closure',
        relativePath,
      );
    }
  });
  return Object.freeze([...new Set(selectors)].sort());
}
