import { PRODUCT_UPDATE_POLICY } from '../../config/product-update-policy.mjs';
import { PRODUCT_TARGETS, matchesProductAssetUrl, validateProductRelease, compareProductVersions } from '../../config/product-update-contract.mjs';
import { spawnSync } from 'node:child_process';

// Publishing code can advance without rebuilding an approved payload. Both
// revisions remain on main; version and signed source come from the payload.
export function readProductPublishSource(sourceRevision, repoRoot = process.cwd()) {
  if (!/^[a-f0-9]{40}$/u.test(sourceRevision)) throw Error('PRODUCT_RELEASE_SOURCE_INVALID');
  const git = args => spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', windowsHide: true });
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain', '--untracked-files=normal']);
  if (head.status !== 0 || status.status !== 0 || status.stdout.trim()) throw Error('PRODUCT_RELEASE_OPERATOR_DIRTY');
  if (git(['merge-base', '--is-ancestor', head.stdout.trim(), 'refs/remotes/origin/main']).status !== 0) throw Error('PRODUCT_RELEASE_OPERATOR_NOT_MAIN');
  if (git(['merge-base', '--is-ancestor', sourceRevision, head.stdout.trim()]).status !== 0) throw Error('PRODUCT_RELEASE_SOURCE_NOT_ANCESTOR');
  const manifest = git(['show', `${sourceRevision}:apps/desktop/package.json`]);
  if (manifest.status !== 0) throw Error('PRODUCT_RELEASE_SOURCE_INVALID');
  const version = JSON.parse(manifest.stdout).version;
  compareProductVersions(version, version);
  return { version };
}

function requireFreshMetadata(batch, now) {
  if(!Array.isArray(batch.releases) || batch.releases.length!==PRODUCT_TARGETS.length) throw Error('PRODUCT_RELEASE_METADATA_INCOMPLETE');
  for(const target of PRODUCT_TARGETS) {
    const matches=batch.releases.filter(r=>r.target===target);
    if(matches.length!==1) throw Error('PRODUCT_RELEASE_METADATA_INCOMPLETE');
    const release=validateProductRelease(matches[0],now);
    if(release.releaseId!==batch.releaseId || release.sourceRevision!==batch.sourceRevision || release.channel!==batch.channel) throw Error('PRODUCT_RELEASE_SOURCE_MISMATCH');
  }
}

function requireRemoteAssets(release,batch) {
  if (!Array.isArray(release.assets) || release.assets.length!==batch.files.length) throw Error('PRODUCT_RELEASE_REMOTE_ASSETS_INCOMPLETE');
  for(const file of batch.files) {
    const matches=release.assets.filter(a=>a.name===file.name);
    if(matches.length!==1 || matches[0].state!=='uploaded' || matches[0].size!==file.size || matches[0].digest!==`sha256:${file.sha256}`
      // GitHub draft assets use an untagged temporary URL until publication.
      // Nothing consumes that URL; the exact published address stays required.
      || (!release.draft && !matchesProductAssetUrl(matches[0].browser_download_url,batch.releaseId,file.name))) throw Error('PRODUCT_RELEASE_REMOTE_ASSET_MISMATCH');
  }
}

// Specific complete Nimi release handoff. This never changes repository
// settings, signing credentials, tags of another component or existing assets.
export async function publishPreparedProductRelease(batch, gh, notesFile, now = Date.now) {
  const repo=PRODUCT_UPDATE_POLICY.repository, api=['api','-H','X-GitHub-Api-Version: 2026-03-10'];
  const requireImmutable=async()=>{ const settings=await gh([...api,`repos/${repo}/immutable-releases`]); if(settings?.enabled!==true) throw Error('PRODUCT_RELEASE_IMMUTABILITY_NOT_ENABLED'); };
  await requireImmutable();
  const checkTag=async(required=false)=>{
  const ref=await gh([...api,`repos/${repo}/git/ref/tags/${batch.releaseId}`],true);
  if(required && !ref) throw Error('PRODUCT_RELEASE_TAG_SOURCE_MISMATCH');
  if(ref) {
    let object=ref.object;
    for(let depth=0;object?.type==='tag' && depth<8;depth++) object=(await gh([...api,`repos/${repo}/git/tags/${object.sha}`])).object;
    if(object?.type!=='commit' || object.sha!==batch.sourceRevision) throw Error('PRODUCT_RELEASE_TAG_SOURCE_MISMATCH');
  }
  };
  await checkTag();
  // The tag endpoint is published-only. List releases includes drafts for a
  // push-authorized caller; all later operations bind the exact release ID.
  const pages=await gh([...api,'--paginate','--slurp',`repos/${repo}/releases?per_page=100`]);
  if(!Array.isArray(pages) || pages.some(page=>!Array.isArray(page))) throw Error('PRODUCT_RELEASE_LIST_INVALID');
  const matches=pages.flat().filter(r=>r.tag_name===batch.releaseId);
  if(matches.length>1) throw Error('PRODUCT_RELEASE_DRAFT_CONFLICT');
  let release=matches[0] ?? null;
  if(release && (release.tag_name!==batch.releaseId || release.target_commitish!==batch.sourceRevision)) throw Error('PRODUCT_RELEASE_SOURCE_MISMATCH');
  if(release && !release.draft) {
    if(release.immutable!==true || release.prerelease!==(batch.channel==='beta')) throw Error('PRODUCT_RELEASE_NOT_IMMUTABLE');
    await checkTag(true); requireRemoteAssets(release,batch); return release;
  }
  if(!release) {
    release=await gh([...api,'--method','POST','-f',`tag_name=${batch.releaseId}`,'-f',`target_commitish=${batch.sourceRevision}`,'-f',`name=Nimi ${batch.version} ${batch.channel}`,'-F','draft=true','-F',`prerelease=${batch.channel==='beta'}`,'-F',`body=@${notesFile}`,`repos/${repo}/releases`]);
  }
  const id=release?.id;
  const requireDraft=release=>{ if(!Number.isSafeInteger(id) || id<=0 || release?.id!==id || release.draft!==true || release.tag_name!==batch.releaseId || release.target_commitish!==batch.sourceRevision || release.prerelease!==(batch.channel==='beta')) throw Error('PRODUCT_RELEASE_DRAFT_MISMATCH'); };
  requireDraft(release);
  const readRelease=()=>gh([...api,`repos/${repo}/releases/${id}`]);
  for(const file of batch.files) {
    const matches=release.assets.filter(a=>a.name===file.name);
    if(matches.length>1 || (matches[0] && (matches[0].size!==file.size || matches[0].digest!==`sha256:${file.sha256}` || matches[0].state!=='uploaded'))) throw Error('PRODUCT_RELEASE_REMOTE_ASSET_MISMATCH');
    if(!matches.length) await gh([...api,'--method','POST','-H','Content-Type: application/octet-stream','--input',file.path,`https://uploads.github.com/repos/${repo}/releases/${id}/assets?name=${encodeURIComponent(file.name)}`]);
  }
  release=await readRelease(); requireDraft(release);
  requireRemoteAssets(release,batch);
  await requireImmutable();
  await checkTag();
  // Last boundary immediately before the irreversible draft transition.
  // These are the two initially authenticated payloads, never refreshed here.
  requireFreshMetadata(batch,now());
  await gh([...api,'--method','PATCH','-F','draft=false','-f','make_latest=false',`repos/${repo}/releases/${id}`]);
  release=await readRelease();
  if(release?.id!==id || release.draft!==false || release.immutable!==true || release.tag_name!==batch.releaseId || release.target_commitish!==batch.sourceRevision || release.prerelease!==(batch.channel==='beta')) throw Error('PRODUCT_RELEASE_NOT_IMMUTABLE');
  await checkTag(true);
  requireRemoteAssets(release,batch); return release;
}
