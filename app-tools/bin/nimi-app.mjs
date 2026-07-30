#!/usr/bin/env node

import process from 'node:process';
import {
  createApp,
  doctorAppScaffold,
  initAppScaffold,
  runDevShell,
  updateAppScaffold,
} from '../lib/index.mjs';

function parseArgs(argv) {
  const [command = '', ...rest] = argv;
  let dir = '';
  let profile = '';
  let appId = '';
  let title = '';
  let packageName = '';
  let author = '';
  let shell = '';
  let cdpPort;
  let cdpPortSeen = false;
  let conformance = '';
  let json = false;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--') {
      continue;
    }
    if (rest[index] === '--dir') {
      dir = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--profile') {
      profile = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--app-id') {
      appId = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--title') {
      title = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--package-name') {
      packageName = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--author') {
      author = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--shell') {
      shell = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--cdp-port') {
      if (cdpPortSeen) throw new Error('Duplicate option: --cdp-port');
      if (rest[index + 1] === undefined || String(rest[index + 1]).startsWith('--')) {
        throw new Error('--cdp-port requires a value');
      }
      cdpPortSeen = true;
      cdpPort = String(rest[index + 1]);
      index += 1;
      continue;
    }
    if (rest[index] === '--conformance') {
      conformance = String(rest[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (rest[index] === '--json') {
      json = true;
      continue;
    }
    throw new Error(`Unknown option: ${rest[index]}`);
  }
  return {
    command: String(command || '').trim(),
    dir,
    profile,
    appId,
    title,
    packageName,
    author,
    shell,
    cdpPort,
    conformance,
    json,
  };
}

function printUsage() {
  process.stdout.write(
    [
      'Usage:',
      '  nimi-app create [--dir path] [--profile standalone|workspace-app|tester-reference] [--app-id id] [--title title] [--package-name name] [--author author]',
      '  nimi-app init [--dir path] [--json]',
      '  nimi-app doctor [--dir path] [--json]',
      '  nimi-app doctor [--dir path] --conformance simulator',
      '  nimi-app update [--dir path] [--json]',
      '  nimi-app dev [--dir path] [--shell electron] [--cdp-port 1024..65535]',
      '',
    ].join('\n'),
  );
}

let parsedArgs = null;
try {
  parsedArgs = parseArgs(process.argv.slice(2));
  const {
    command,
    dir,
    profile,
    appId,
    title,
    packageName,
    author,
    shell,
    cdpPort,
    conformance,
    json,
  } = parsedArgs;
  if (!command || command === '--help' || command === '-h') {
    printUsage();
    process.exit(0);
  }
  if (command !== 'dev' && cdpPort !== undefined) {
    throw new Error('--cdp-port is available only for nimi-app dev');
  }
  switch (command) {
    case 'create':
      createApp(process.cwd(), {
        dir,
        profile,
        appId,
        title,
        packageName,
        author,
      });
      break;
    case 'init':
      initAppScaffold(process.cwd(), {
        dir,
        json,
      });
      break;
    case 'doctor':
      doctorAppScaffold(process.cwd(), {
        dir,
        conformance,
        json,
      });
      break;
    case 'update':
      updateAppScaffold(process.cwd(), {
        dir,
        json,
      });
      break;
    case 'dev':
      await runDevShell(process.cwd(), {
        dir,
        shell: shell || 'electron',
        cdpPort,
      });
      break;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`[nimi-app] failed: ${message}\n`);
  process.exit(1);
}
