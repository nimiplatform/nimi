import process from 'node:process';

import {
  fetchPublicComments,
  parseProbeArgs,
  resolveVideoMetadataByUrl,
  runBilibiliFoodVideoProbe,
  screenCommentsForExtraction,
} from './lib/bilibili-food-video-probe.mts';

async function main(): Promise<void> {
  const args = parseProbeArgs(process.argv);
  const metadata = await resolveVideoMetadataByUrl(args.url);
  const rawComments = await fetchPublicComments(metadata.aid);
  const result = await runBilibiliFoodVideoProbe(args);
  const screenedComments = screenCommentsForExtraction({
    extractionJson: result.extractionJson,
    comments: rawComments,
  });
  const keptComments = screenedComments.filter((comment) => comment.keep);
  const excludedComments = screenedComments.filter((comment) => !comment.keep);

  process.stdout.write(`${JSON.stringify({
    bvid: metadata.bvid,
    title: metadata.title,
    rawCommentCount: rawComments.length,
    filteredCommentCount: keptComments.length,
    filteredCommentClues: result.commentClues,
    keptComments,
    excludedComments,
    rawComments: rawComments.map((comment) => ({
      commentId: String(comment.rpid || '').trim(),
      authorName: String(comment.member?.uname || '').trim(),
      publishedAt: Number(comment.ctime || 0) > 0
        ? new Date(Number(comment.ctime || 0) * 1000).toISOString()
        : '',
      likeCount: Number(comment.like || 0),
      message: String(comment.content?.message || '').trim(),
    })),
  }, null, 2)}\n`);
}

main().catch((error) => {
  const detail = error instanceof Error ? error.message : String(error || 'unknown error');
  process.stderr.write(`${detail}\n`);
  process.exit(1);
});
