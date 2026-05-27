/**
 * Comment analysis, screening, filtering, and merge logic for bilibili food video probe.
 */

export type CommentClue = {
  commentId: string;
  authorName: string;
  message: string;
  likeCount: number;
  publishedAt: string;
  matchedVenueNames: string[];
  addressHint: string;
};

export type CommentScreeningRecord = {
  commentId: string;
  authorName: string;
  message: string;
  likeCount: number;
  publishedAt: string;
  matchedVenueNames: string[];
  addressHint: string;
  keep: boolean;
  reason: string;
};

export type ReplyApiItem = {
  rpid?: number | string;
  like?: number;
  ctime?: number;
  member?: { uname?: string };
  content?: { message?: string };
  replies?: ReplyApiItem[];
};

const DEFAULT_MAX_COMMENT_CROSSCHECK = 10;

function normalizeForCompare(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/\s+/gu, '');
}

function formatPublishedAt(timestampSec: number): string {
  if (!Number.isFinite(timestampSec) || timestampSec <= 0) {
    return '';
  }
  return new Date(timestampSec * 1000).toISOString();
}

function isSpecificAddressText(addressText: string): boolean {
  const normalized = String(addressText || '').trim();
  if (!normalized) {
    return false;
  }
  const vagueMarkers = ['附近', '旁边', '周边', '对面', '里面', '门口', '地铁', '公交', '商圈', '一带', '附近的'];
  if (vagueMarkers.some((marker) => normalized.includes(marker))) {
    return false;
  }
  if (/\d/u.test(normalized)) {
    return true;
  }
  return ['号', '路', '街', '巷', '弄', '大道', '道', '楼', '层', '栋', '室', '城', '广场']
    .some((marker) => normalized.includes(marker));
}

function isPreciseCommentAddressText(addressText: string): boolean {
  const normalized = String(addressText || '').trim();
  if (!normalized) {
    return false;
  }
  if (['附近', '隔壁', '周街', '周边', '旁边', '对面', '里面', '门口'].some((marker) => normalized.includes(marker))) {
    return false;
  }
  if (/(?:路|街|巷|弄|大道|道).*(?:\d|号|楼|层|栋|室)/u.test(normalized)) {
    return true;
  }
  if (/(?:市|区|县|镇|乡|村).*(?:路|街|巷|弄|大道|道|\d|号)/u.test(normalized)) {
    return true;
  }
  if (/(?:广场|商城|中心|商场).*(?:\d+楼|\d+层|[AB]\d)/u.test(normalized)) {
    return true;
  }
  return false;
}

function extractAddressHintFromComment(message: string): string {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return '';
  }
  const patterns = [
    /(?:地址(?:是|在)?|就在|在)\s*([\u4e00-\u9fa5A-Za-z0-9-]{2,32}(?:路|街|巷|弄|道|大道)[\u4e00-\u9fa5A-Za-z0-9-]{0,20}(?:号|楼|层|栋|室)?)/u,
    /((?:[\u4e00-\u9fa5]{1,12}(?:省|市|区|县)){0,3}[\u4e00-\u9fa5A-Za-z0-9]{1,24}(?:路|街|巷|弄|道|大道)[\u4e00-\u9fa5A-Za-z0-9-]{0,20}(?:号|楼|层|栋|室)?)/u,
    /((?:[\u4e00-\u9fa5]{1,16}(?:广场|商城|天地|中心|城|mall|MALL))(?:[\u4e00-\u9fa5A-Za-z0-9-]{0,12}(?:[A-Z]?[0-9]+楼|[0-9]+层|[0-9]+楼|[AB]\d))?)/u,
  ];
  for (const pattern of patterns) {
    const matched = normalized.match(pattern)?.[1] || '';
    if (matched && isPreciseCommentAddressText(matched)) {
      return matched.trim();
    }
  }
  return '';
}

function extractStructuredVenueAddressPairsFromComment(message: string): Array<{
  venueName: string;
  addressHint: string;
}> {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return [];
  }

  const matches = [
    ...normalized.matchAll(
      /(?:🏠)?\s*([\u4e00-\u9fa5A-Za-z0-9]{2,32}(?:美食|粉店|卷筒粉|猪脚粉|鸡粉|老友粉|牛肉粉|牛腩粉|餐厅|小食店|面馆|大排档|食店|食府))\s*(?:\([^)]*\))?\s*[，,]?\s*(?:📍)?\s*位于[:：]\s*([^🏠📍]{4,48}?)(?=\s*(?:🏠|📍|$))/gu,
    ),
  ];

  const pairs = matches
    .map((entry) => ({
      venueName: String(entry[1] || '').trim(),
      addressHint: String(entry[2] || '')
        .replace(/[，,。；;]+$/u, '')
        .trim(),
    }))
    .filter((entry) => entry.venueName && entry.addressHint && isPreciseCommentAddressText(entry.addressHint));

  const deduped = new Map<string, { venueName: string; addressHint: string }>();
  for (const pair of pairs) {
    const key = normalizeForCompare(`${pair.venueName}|${pair.addressHint}`);
    if (!deduped.has(key)) {
      deduped.set(key, pair);
    }
  }
  return [...deduped.values()];
}

export function flattenReplies(items: ReplyApiItem[], bucket: ReplyApiItem[] = []): ReplyApiItem[] {
  for (const item of items) {
    bucket.push(item);
    if (Array.isArray(item.replies) && item.replies.length > 0) {
      flattenReplies(item.replies, bucket);
    }
  }
  return bucket;
}

function readVenueNameCandidates(extractionJson: Record<string, unknown> | null): string[] {
  const venues = Array.isArray(extractionJson?.venues) ? extractionJson.venues : [];
  return venues
    .map((entry) => (entry && typeof entry === 'object' && !Array.isArray(entry) ? String((entry as Record<string, unknown>).venue_name || '').trim() : ''))
    .filter(Boolean);
}

function isLikelyVenueNameHint(value: string): boolean {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return false;
  }
  const blockedPrefixes = ['求', '问', '請問', '请问', '有冇', '有没有', '系咪', '是不是', '住咩', '住乜', '哪家', '邊間', '边间'];
  if (blockedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
    return false;
  }
  if (normalized.includes('店名') || normalized.includes('酒店名')) {
    return false;
  }
  return true;
}

function extractVenueNameHintsFromComment(message: string): string[] {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return [];
  }
  const pattern = /([\u4e00-\u9fa5A-Za-z0-9]{2,24}(?:小食店|餐厅|农庄|酒店|酒楼|饭店|面馆|粉店|卷筒粉|猪脚粉|鸡粉|老友粉|牛肉粉|海鲜粉|肠粉|茶餐厅|烧腊店|烧鹅店|烧烤店|甜品店|咖啡店|大排档|食店|食府|茶档|排档|美食))/gu;
  const matches = [...normalized.matchAll(pattern)]
    .map((entry) => String(entry[1] || '').trim())
    .filter((entry) => Boolean(entry) && isLikelyVenueNameHint(entry));
  return [...new Set(matches)];
}

function hasCrossCheckCue(message: string): boolean {
  const normalized = String(message || '').trim();
  if (!normalized) {
    return false;
  }
  const markers = ['本期', '具体地址', '导航', '到店', '地图', '就在', '斜对面', '楼下'];
  return markers.some((marker) => normalized.includes(marker));
}

function hasUsefulCommentBody(message: string): boolean {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return false;
  }
  if (normalized.length < 4) {
    return false;
  }
  return /[\u4e00-\u9fa5A-Za-z0-9]/u.test(normalized);
}

function isLikelyNoiseComment(message: string): boolean {
  const normalized = String(message || '').replace(/\s+/gu, ' ').trim();
  if (!normalized) {
    return true;
  }
  const exactNoise = ['求店名', '求咩酒店', '求什么酒店', '求酒店名', '住咩酒店', '唔会', '老乡'];
  if (exactNoise.includes(normalized)) {
    return true;
  }
  if (normalized.length <= 8 && (normalized.startsWith('求') || normalized.startsWith('问'))) {
    return true;
  }
  return false;
}

export function screenCommentsForExtraction(input: {
  extractionJson: Record<string, unknown> | null;
  comments: ReplyApiItem[];
}): CommentScreeningRecord[] {
  const knownVenueNames = readVenueNameCandidates(input.extractionJson);
  return input.comments.flatMap((comment) => {
    const message = String(comment.content?.message || '').replace(/\s+/gu, ' ').trim();
    const likeCount = Number(comment.like || 0);
    const publishedAt = formatPublishedAt(Number(comment.ctime || 0));
    const authorName = String(comment.member?.uname || '').trim();
    const commentId = String(comment.rpid || '').trim();
    const structuredPairs = extractStructuredVenueAddressPairsFromComment(message);

    if (!message) {
      return [{
        commentId,
        authorName,
        message,
        likeCount,
        publishedAt,
        matchedVenueNames: [],
        addressHint: '',
        keep: false,
        reason: '空评论',
      }];
    }

    if (isLikelyNoiseComment(message)) {
      return [{
        commentId,
        authorName,
        message,
        likeCount,
        publishedAt,
        matchedVenueNames: [],
        addressHint: '',
        keep: false,
        reason: '明显噪声',
      }];
    }

    const normalizedMessage = normalizeForCompare(message);
    const matchedKnownVenueNames = knownVenueNames.filter((venueName) =>
      normalizedMessage.includes(normalizeForCompare(venueName)),
    );
    const extractedVenueHints = extractVenueNameHintsFromComment(message);
    const matchedVenueNames = [...new Set([...matchedKnownVenueNames, ...extractedVenueHints])];
    const addressHint = extractAddressHintFromComment(message);
    const hasCue = hasCrossCheckCue(message);
    const likedGeneric = likeCount > 0 && hasUsefulCommentBody(message);
    const keep = matchedVenueNames.length > 0 || Boolean(addressHint) || hasCue || likedGeneric;
    let reason = '无明显线索';
    if (matchedVenueNames.length > 0) {
      reason = '命中店名';
    } else if (addressHint) {
      reason = '命中地址';
    } else if (hasCue) {
      reason = '命中强线索词';
    } else if (likedGeneric) {
      reason = '点赞评论进入候选池';
    }

    const baseRecord = {
      commentId,
      authorName,
      message,
      likeCount,
      publishedAt,
      matchedVenueNames,
      addressHint,
      keep,
      reason,
    };

    if (structuredPairs.length === 0) {
      return [baseRecord];
    }

    const expandedRecords = structuredPairs.map((pair, index) => ({
      ...baseRecord,
      commentId: `${commentId}#${index + 1}`,
      matchedVenueNames: [...new Set([...matchedVenueNames, pair.venueName])],
      addressHint: pair.addressHint,
      keep: true,
      reason: '命中店名和地址清单',
    }));

    if (
      baseRecord.keep
      && !expandedRecords.some((record) =>
        normalizeForCompare(record.addressHint) === normalizeForCompare(baseRecord.addressHint)
        && normalizeForCompare(record.matchedVenueNames.join('|')) === normalizeForCompare(baseRecord.matchedVenueNames.join('|')),
      )
    ) {
      expandedRecords.push(baseRecord);
    }

    return expandedRecords;
  });
}

export function filterCommentCluesForExtraction(input: {
  extractionJson: Record<string, unknown> | null;
  comments: ReplyApiItem[];
}): CommentClue[] {
  const clues = screenCommentsForExtraction(input)
    .filter((item) => item.keep)
    .map((item) => ({
      commentId: item.commentId,
      authorName: item.authorName,
      message: item.message,
      likeCount: item.likeCount,
      publishedAt: item.publishedAt,
      matchedVenueNames: item.matchedVenueNames,
      addressHint: item.addressHint,
    }));

  const deduped = new Map<string, CommentClue>();
  for (const clue of clues) {
    const key = normalizeForCompare(`${clue.matchedVenueNames.join('|')}|${clue.addressHint}|${clue.message}`);
    if (!deduped.has(key)) {
      deduped.set(key, clue);
    }
  }

  return [...deduped.values()]
    .sort((left, right) => {
      const leftScore = (left.matchedVenueNames.length * 20)
        + (left.addressHint ? 12 : 0)
        + (hasCrossCheckCue(left.message) ? 8 : 0)
        + Math.min(left.likeCount, 20)
        + Math.min(Math.floor(left.message.length / 24), 4);
      const rightScore = (right.matchedVenueNames.length * 20)
        + (right.addressHint ? 12 : 0)
        + (hasCrossCheckCue(right.message) ? 8 : 0)
        + Math.min(right.likeCount, 20)
        + Math.min(Math.floor(right.message.length / 24), 4);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      if (right.likeCount !== left.likeCount) {
        return right.likeCount - left.likeCount;
      }
      return String(right.publishedAt).localeCompare(String(left.publishedAt));
    })
    .slice(0, DEFAULT_MAX_COMMENT_CROSSCHECK);
}

export function mergeCommentCluesIntoExtraction(input: {
  extractionJson: Record<string, unknown> | null;
  commentClues: CommentClue[];
}): Record<string, unknown> | null {
  if (!input.extractionJson) {
    return input.commentClues.length > 0
      ? {
        video_summary: '',
        venues: [],
        uncertain_points: [],
        comment_clues: input.commentClues,
      }
      : null;
  }

  const cloned = JSON.parse(JSON.stringify(input.extractionJson)) as Record<string, unknown>;
  const venues = Array.isArray(cloned.venues) ? cloned.venues : [];
  const uncertainPoints = Array.isArray(cloned.uncertain_points)
    ? [...cloned.uncertain_points].map((item) => String(item || '').trim()).filter(Boolean)
    : [];

  for (const entry of venues) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      continue;
    }
    const venue = entry as Record<string, unknown>;
    const venueName = String(venue.venue_name || '').trim();
    const addressText = String(venue.address_text || '').trim();
    if (!venueName) {
      continue;
    }

    const matchedClues = input.commentClues.filter((clue) =>
      clue.matchedVenueNames.some((name) => normalizeForCompare(name) === normalizeForCompare(venueName))
      && clue.addressHint,
    );
    const distinctHints = [...new Set(matchedClues.map((clue) => clue.addressHint.trim()).filter(Boolean))];
    if (distinctHints.length === 1 && !isSpecificAddressText(addressText)) {
      venue.address_text = distinctHints[0]!;
      const evidence = Array.isArray(venue.evidence) ? [...venue.evidence] : [];
      const quoted = matchedClues[0]?.message ? `评论补充：${matchedClues[0].message}` : '';
      if (quoted && !evidence.includes(quoted)) {
        evidence.push(quoted);
      }
      venue.evidence = evidence;
    } else if (distinctHints.length > 1) {
      uncertainPoints.push(`评论区对"${venueName}"给出了多个不同地址线索，暂时保留待确认。`);
      venue.needs_review = true;
    }
  }

  const existingVenueNames = new Set(
    venues
      .map((entry) =>
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? normalizeForCompare(String((entry as Record<string, unknown>).venue_name || ''))
          : '',
      )
      .filter(Boolean),
  );
  const groupedCommentOnlyClues = new Map<string, CommentClue[]>();
  for (const clue of input.commentClues) {
    for (const venueName of clue.matchedVenueNames) {
      const normalizedVenueName = normalizeForCompare(venueName);
      if (!normalizedVenueName || existingVenueNames.has(normalizedVenueName)) {
        continue;
      }
      const bucket = groupedCommentOnlyClues.get(normalizedVenueName) || [];
      bucket.push(clue);
      groupedCommentOnlyClues.set(normalizedVenueName, bucket);
    }
  }

  for (const [normalizedVenueName, clueGroup] of groupedCommentOnlyClues.entries()) {
    const firstNamedClue = clueGroup.find((clue) =>
      clue.matchedVenueNames.some((venueName) => normalizeForCompare(venueName) === normalizedVenueName),
    );
    const venueName = firstNamedClue?.matchedVenueNames.find((name) =>
      normalizeForCompare(name) === normalizedVenueName,
    ) || '';
    if (!venueName) {
      continue;
    }

    const distinctHints = [...new Set(clueGroup.map((clue) => clue.addressHint.trim()).filter(Boolean))];
    const shouldCreateReviewVenue = clueGroup.length >= 2 || distinctHints.length > 0;
    if (!shouldCreateReviewVenue) {
      continue;
    }

    const evidence = clueGroup
      .slice(0, 3)
      .map((clue) => `评论补充：${clue.message}`);
    const addressText = distinctHints.length === 1 ? distinctHints[0]! : '';
    venues.push({
      venue_name: venueName,
      address_text: addressText,
      recommended_dishes: [],
      cuisine_tags: [],
      flavor_tags: [],
      evidence,
      recommendation_polarity: 'positive',
      confidence: distinctHints.length > 0 || clueGroup.length >= 3 ? 'medium' : 'low',
      needs_review: true,
    });
    if (distinctHints.length > 1) {
      uncertainPoints.push(`评论区对"${venueName}"给出了多个不同地址线索，先放进待确认。`);
    } else {
      uncertainPoints.push(`"${venueName}"目前主要来自评论线索，先放进待确认。`);
    }
    existingVenueNames.add(normalizedVenueName);
  }

  cloned.uncertain_points = [...new Set(uncertainPoints)];
  cloned.venues = venues;
  cloned.comment_clues = input.commentClues;
  return cloned;
}

export function summarizeCommentCluesForPrompt(commentClues: CommentClue[]): Array<{
  commentId: string;
  authorName: string;
  likeCount: number;
  messages: string[];
  matchedVenueNames: string[];
  addressHints: string[];
}> {
  const grouped = new Map<string, {
    commentId: string;
    authorName: string;
    likeCount: number;
    messages: string[];
    matchedVenueNames: string[];
    addressHints: string[];
  }>();

  for (const clue of commentClues) {
    const baseCommentId = String(clue.commentId || '').split('#')[0] || String(clue.commentId || '');
    const key = `${baseCommentId}::${normalizeForCompare(clue.message)}`;
    const current = grouped.get(key) || {
      commentId: baseCommentId,
      authorName: clue.authorName,
      likeCount: clue.likeCount,
      messages: [],
      matchedVenueNames: [],
      addressHints: [],
    };
    if (!current.messages.includes(clue.message)) {
      current.messages.push(clue.message);
    }
    for (const venueName of clue.matchedVenueNames) {
      if (!current.matchedVenueNames.includes(venueName)) {
        current.matchedVenueNames.push(venueName);
      }
    }
    if (clue.addressHint && !current.addressHints.includes(clue.addressHint)) {
      current.addressHints.push(clue.addressHint);
    }
    current.likeCount = Math.max(current.likeCount, clue.likeCount);
    if (!current.authorName && clue.authorName) {
      current.authorName = clue.authorName;
    }
    grouped.set(key, current);
  }

  return [...grouped.values()];
}
