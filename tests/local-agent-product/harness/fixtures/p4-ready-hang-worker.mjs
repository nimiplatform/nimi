#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? '' : process.argv[index + 1];
}

const request = JSON.parse(fs.readFileSync(path.resolve(option('--request')), 'utf8'));
fs.mkdirSync(request.outputDir, { recursive: true });
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
  windowsHide: true,
});
fs.writeFileSync(path.join(request.outputDir, 'descendant.pid'), `${descendant.pid}\n`, 'utf8');
fs.writeFileSync(path.join(request.outputDir, 'ready.json'), '{"ready":true}\n', 'utf8');
setInterval(() => {}, 1_000);
