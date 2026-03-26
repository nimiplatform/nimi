/**
 * Verify Bilibili cookieless API access for:
 * 1. /x/web-interface/view — video metadata (already known to work)
 * 2. /x/player/playurl — audio stream URLs
 * 3. /x/player/v2 — subtitle list
 *
 * Usage: npx tsx apps/video-food-map/scripts/verify-cookieless-api.mts [BVID]
 */
import process from 'node:process';

const TEST_BVID = process.argv[2] || 'BV1P2Awz6EUQ';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const REFERER = 'https://www.bilibili.com/';

async function fetchJson<T>(url: string, label: string): Promise<T> {
  console.log(`\n--- ${label} ---`);
  console.log(`GET ${url}`);
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'accept': 'application/json',
      'user-agent': UA,
      'referer': REFERER,
    },
  });
  console.log(`status: ${response.status}`);
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    console.log(`raw response (first 500 chars): ${text.slice(0, 500)}`);
    throw new Error(`${label}: invalid json`);
  }
}

type ViewResponse = {
  code?: number;
  message?: string;
  data?: {
    bvid?: string;
    aid?: number;
    cid?: number;
    title?: string;
    duration?: number;
    owner?: { mid?: number; name?: string };
  };
};

type PlayUrlResponse = {
  code?: number;
  message?: string;
  data?: {
    dash?: {
      audio?: Array<{
        baseUrl?: string;
        base_url?: string;
        bandwidth?: number;
        id?: number;
      }>;
    };
    durl?: Array<{
      url?: string;
    }>;
  };
};

type PlayerV2Response = {
  code?: number;
  message?: string;
  data?: {
    subtitle?: {
      subtitles?: Array<{
        lan?: string;
        lan_doc?: string;
        subtitle_url?: string;
      }>;
    };
  };
};

async function main(): Promise<void> {
  console.log(`Testing cookieless API access for BVID: ${TEST_BVID}`);

  // Step 1: View API — get metadata + cid
  const view = await fetchJson<ViewResponse>(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(TEST_BVID)}`,
    'Step 1: View API (metadata)',
  );
  console.log(`code: ${view.code}, message: ${view.message || ''}`);
  if (view.code !== 0 || !view.data) {
    console.log('FAIL: View API returned non-zero code or no data');
    return;
  }
  const { aid, cid, title, duration, owner } = view.data;
  console.log(`title: ${title}`);
  console.log(`aid: ${aid}, cid: ${cid}, duration: ${duration}s`);
  console.log(`owner: mid=${owner?.mid}, name=${owner?.name}`);
  console.log('PASS: View API works without cookie');

  if (!cid || !aid) {
    console.log('FAIL: missing aid/cid, cannot continue');
    return;
  }

  // Step 2: PlayUrl API — get audio stream URLs
  const playUrl = await fetchJson<PlayUrlResponse>(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(TEST_BVID)}&cid=${cid}&fnval=16&fourk=1`,
    'Step 2: PlayUrl API (audio streams)',
  );
  console.log(`code: ${playUrl.code}, message: ${playUrl.message || ''}`);
  if (playUrl.code !== 0 || !playUrl.data) {
    console.log('FAIL: PlayUrl API returned non-zero code or no data');
    console.log(`Full response: ${JSON.stringify(playUrl, null, 2).slice(0, 1000)}`);
  } else {
    const audioTracks = playUrl.data.dash?.audio || [];
    console.log(`dash audio tracks: ${audioTracks.length}`);
    if (audioTracks.length > 0) {
      const best = audioTracks[0];
      const audioUrl = best?.baseUrl || best?.base_url || '';
      console.log(`best audio bandwidth: ${best?.bandwidth}, id: ${best?.id}`);
      console.log(`audio URL (first 120 chars): ${audioUrl.slice(0, 120)}...`);
      console.log('PASS: PlayUrl API works without cookie');

      // Step 2b: verify audio URL is downloadable without cookie
      console.log('\n--- Step 2b: Audio CDN download (no cookie, with referer) ---');
      const audioResponse = await fetch(audioUrl, {
        method: 'HEAD',
        headers: { 'user-agent': UA, 'referer': REFERER },
      });
      console.log(`audio CDN status: ${audioResponse.status}`);
      console.log(`content-type: ${audioResponse.headers.get('content-type')}`);
      console.log(`content-length: ${audioResponse.headers.get('content-length')}`);
      if (audioResponse.ok) {
        console.log('PASS: Audio CDN accessible without cookie');
      } else {
        console.log('FAIL: Audio CDN returned non-200');
      }
    } else {
      const durl = playUrl.data.durl || [];
      console.log(`durl entries: ${durl.length}`);
      if (durl.length > 0) {
        console.log(`durl[0] URL (first 120 chars): ${(durl[0]?.url || '').slice(0, 120)}...`);
        console.log('PASS: PlayUrl API works (durl mode) without cookie');
      } else {
        console.log('FAIL: No audio tracks in dash or durl');
      }
    }
  }

  // Step 3: Player V2 API — get subtitle list
  const playerV2 = await fetchJson<PlayerV2Response>(
    `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(TEST_BVID)}&cid=${cid}`,
    'Step 3: Player V2 API (subtitles)',
  );
  console.log(`code: ${playerV2.code}, message: ${playerV2.message || ''}`);
  if (playerV2.code !== 0 || !playerV2.data) {
    console.log('FAIL: Player V2 API returned non-zero code or no data');
    console.log(`Full response: ${JSON.stringify(playerV2, null, 2).slice(0, 1000)}`);
  } else {
    const subtitles = playerV2.data.subtitle?.subtitles || [];
    console.log(`subtitle tracks: ${subtitles.length}`);
    if (subtitles.length > 0) {
      for (const sub of subtitles) {
        console.log(`  - ${sub.lan} (${sub.lan_doc}): ${sub.subtitle_url?.slice(0, 100)}...`);
      }
      console.log('PASS: Subtitles available without cookie');
    } else {
      console.log('NOTE: No subtitles for this video (may not have AI captions)');
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log('View API:    cookieless OK (already known)');
  console.log(`PlayUrl API: see results above`);
  console.log(`Player V2:   see results above`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
