import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parse } from 'yaml';

for (const [filename, token] of [
  ['deploy-web.yml', 'CLOUDFLARE_PAGES_API_TOKEN'],
  ['deploy-install-gateway.yml', 'CLOUDFLARE_WORKERS_API_TOKEN'],
]) {
  const text = readFileSync(new URL(`../.github/workflows/${filename}`, import.meta.url), 'utf8');
  const workflow = parse(text);
  test(`${filename}: build has no production secret and deploy consumes its immutable artifact on another runner`, () => {
    assert.doesNotMatch(JSON.stringify(workflow.env ?? {}), /secrets\./u);
    assert.doesNotMatch(JSON.stringify(workflow.jobs.build), /secrets\./u);
    assert.equal(workflow.jobs.deploy.needs, 'build');
    const uploaded = workflow.jobs.build.steps.find(step => step.uses?.startsWith('actions/upload-artifact@'));
    assert.ok(uploaded);
    const downloaded = workflow.jobs.deploy.steps.find(step => step.uses?.startsWith('actions/download-artifact@'));
    assert.equal(downloaded.with['artifact-ids'], '${{ needs.build.outputs.artifact_id }}');
    assert.equal(downloaded.with['run-id'], undefined);
    assert.equal(downloaded.with.repository, undefined);
    assert.equal(workflow.jobs.build.outputs.artifact_id, `\${{ steps.${uploaded.id}.outputs.artifact-id }}`);
  });

  test(`${filename}: credentials exist only on upload/verification steps, after CLI preparation`, () => {
    assert.doesNotMatch(text, /secrets\.CLOUDFLARE_API_TOKEN\b/u);
    for (const [name, job] of Object.entries(workflow.jobs)) {
      assert.doesNotMatch(JSON.stringify(job.env ?? {}), /secrets\./u);
      if (name === 'build') continue;
      const preparation = job.steps.findIndex(step => /npm install --prefix.*wrangler@4\.127\.1/u.test(step.run || ''));
      for (const [index, step] of job.steps.entries()) {
        if (!JSON.stringify(step).includes('secrets.')) continue;
        assert.equal(step.uses, undefined, 'Actions must not receive a deployment token');
        assert.equal(step.env.CLOUDFLARE_API_TOKEN, `\${{ secrets.${token} }}`);
        assert.doesNotMatch(step.run, /\b(?:npm|pnpm|npx)\b|\b(?:install|test|build)\s*&&/u);
        if (name !== 'rollback') {
          assert.ok(preparation >= 0 && preparation < index, 'Prepare the pinned CLI before injecting a token');
          assert.match(step.run, /cloudflare-cli\/node_modules\/\.bin\/wrangler/u);
        }
      }
      assert.ok(!job.steps.some(step => /pnpm install|pnpm (?:test|build)|with-workspace-surfaces/u.test(step.run || '')));
    }
  });
}

test('Web retains automatic main publication and rollback avoids all build and dependency steps', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/deploy-web.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.match(workflow.jobs.build.if, /rollback_deployment_id == ''/u);
  assert.match(workflow.jobs.rollback.if, /rollback_deployment_id != ''/u);
  assert.doesNotMatch(JSON.stringify(workflow.jobs.rollback), /pnpm|npm install|setup-go|download-artifact|upload-artifact/u);
  for (const step of workflow.jobs.deploy.steps.filter(step => step.env?.CLOUDFLARE_API_TOKEN)) {
    assert.match(step.run, /--no-bundle/u);
  }
});

test('Worker publishes the exact uploaded version without reconciling Routes or Custom Domains', () => {
  const workflow = parse(readFileSync(new URL('../.github/workflows/deploy-install-gateway.yml', import.meta.url), 'utf8'));
  const publication = workflow.jobs.deploy.steps.find(step => step.name === 'Deploy install gateway worker');
  assert.match(publication.run, /versions upload .*--no-bundle --keep-vars/u);
  assert.match(publication.run, /versions deploy "\$VERSION_ID@100%"/u);
  assert.doesNotMatch(publication.run, /\.bin\/wrangler" deploy /u);
});
