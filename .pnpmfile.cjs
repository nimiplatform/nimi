'use strict';

const path = require('node:path');

const nativeWorkspaces = new Set([
  path.join(__dirname, 'kit/shell/protected-local-node/npm/darwin-arm64'),
  path.join(__dirname, 'kit/shell/protected-local-node/npm/win32-x64'),
]);

module.exports = {
  hooks: {
    filterLog(log) {
      // pnpm 10.34.5 checks every workspace against the current machine during
      // filtered runs, without forwarding supportedArchitectures. These two
      // optional carriers intentionally retain their platform restrictions.
      // Only omit discovery warnings; install checks and errors stay visible.
      return !(log.name === 'pnpm'
        && log.level === 'warn'
        && nativeWorkspaces.has(log.prefix)
        && process.cwd() !== log.prefix
        && log.message.startsWith('Unsupported platform: wanted: '));
    },
  },
};
