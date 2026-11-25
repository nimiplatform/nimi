'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

async function checkDarwinWorkspace(addon) {
  // /tmp is a system-owned alias. Supplying the user-visible path exercises all
  // three callers of the descriptor boundary: workspace, cwd and snapshot custody.
  const base = await fs.mkdtemp('/tmp/nimi-workspace-');
  const workspaceRoot = path.join(base, 'work');
  const snapshotRoot = path.join(base, 'custody');
  const control = spawn('/bin/sleep', ['120'], { stdio: 'ignore' });
  const controlExit = once(control, 'exit');
  const ok = async outcome => {
    const result = await outcome;
    assert.equal(result.status, 'ok', JSON.stringify(result));
    return result.value;
  };
  try {
    await fs.mkdir(workspaceRoot);
    await fs.mkdir(snapshotRoot);
    const location = { workspaceRoot, relativePath: 'nested/report.md' };
    const write = (text, options) => addon.harnessSecureWriteFile({
      ...location, content: Buffer.from(text), ...options,
    });
    const created = await ok(write('before', { allowCreate: true, mustNotExist: true }));
    const read = await ok(addon.harnessSecureReadFile({ ...location, offset: 1, maxBytes: 3 }));
    assert.equal(Buffer.from(read.contentBase64, 'base64').toString(), 'efo');
    const canon = await fs.realpath(workspaceRoot);
    const verified = await ok(addon.harnessVerifyWorkspacePath({ ...location, workspaceRoot: canon }));
    assert.equal(verified.objectId, read.objectId);
    const snapshotPath = path.join(snapshotRoot, 'before');
    const updated = await ok(write('after', { snapshotRoot, snapshotPath, preconditionSha256: created.sha256 }));
    assert.equal(await fs.readFile(snapshotPath, 'utf8'), 'before');
    assert.equal((await write('stale', { preconditionSha256: created.sha256 })).status, 'error');
    assert.equal((await write('collision', { allowCreate: true, mustNotExist: true })).status, 'error');
    const restored = await ok(write(await fs.readFile(snapshotPath, 'utf8'), { preconditionSha256: updated.sha256 }));
    assert.equal(restored.sha256, created.sha256);
    await fs.link(path.join(workspaceRoot, location.relativePath), path.join(base, 'extra-link'));
    assert.equal((await addon.harnessSecureReadFile(location)).reasonCode, 'hardlink-rejected');
    await fs.unlink(path.join(base, 'extra-link'));
    await ok(addon.harnessSecureDeleteFile({ ...location, snapshotRoot, preconditionSha256: restored.sha256 }));
    assert.deepEqual(await fs.readdir(path.join(workspaceRoot, 'nested')), []);
    assert.deepEqual(await fs.readdir(snapshotRoot), ['before']);
    console.log('Darwin workspace alias/canonical identity, range, hardlink, snapshot, conflicts, delete and custody cleanup passed');

    const job = { workingDirectory: workspaceRoot, executable: '/bin/sh', args: ['-c', 'echo done; exit 7'] };
    const done = await ok(addon.harnessRunJobProcess(job));
    assert.equal(done.exitCode, 7);
    assert.equal(done.stdoutUtf8.trim(), 'done');
    assert.equal(done.activeProcessesRemaining, 0);
    for (const action of ['timeout', 'cancel']) {
      const started = await ok(addon.harnessSpawnJobProcess({
        ...job, args: ['-c', '/bin/sleep 30 & echo $! > child.pid; wait'],
      }));
      const childFile = path.join(workspaceRoot, 'child.pid');
      try {
        let pid;
        for (let i = 0; i < 100 && !pid; i++) {
          pid = Number(await fs.readFile(childFile, 'utf8').catch(() => ''));
          if (!pid) await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.ok(pid > 0);
        const wait = addon.harnessWaitJobProcess({ jobId: started.jobId, timeoutMs: action === 'timeout' ? 100 : 5000 });
        if (action === 'cancel') await ok(addon.harnessKillJobProcess({ jobId: started.jobId }));
        const result = await ok(wait);
        assert.equal(result.timedOut, action === 'timeout');
        assert.equal(result.killed, action === 'cancel');
        assert.equal(result.activeProcessesRemaining, 0);
        assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
        process.kill(control.pid, 0);
        console.log('Darwin ' + action + ' drained owned child and grandchild; control and test process alive');
      } finally {
        await addon.harnessKillJobProcess({ jobId: started.jobId });
        await fs.rm(childFile, { force: true });
      }
    }
  } finally {
    control.kill();
    await controlExit;
    await fs.rm(base, { recursive: true, force: true });
  }
}
module.exports = { checkDarwinWorkspace };
