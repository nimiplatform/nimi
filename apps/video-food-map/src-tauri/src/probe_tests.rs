use super::{canonicalize_bilibili_creator_url, extract_bilibili_creator_mid};
use super::probe_bilibili::{
    extract_creator_videos_from_dynamic_items, BilibiliApiEnvelope,
    BilibiliCreatorDynamicFeedData,
};

#[test]
fn extracts_creator_mid_from_standard_space_url() {
    assert_eq!(
        extract_bilibili_creator_mid("https://space.bilibili.com/946974?spm_id_from=333.337.0.0"),
        "946974"
    );
}

#[test]
fn extracts_creator_mid_from_mobile_space_url() {
    assert_eq!(
        extract_bilibili_creator_mid("https://m.bilibili.com/space/12345678"),
        "12345678"
    );
}

#[test]
fn canonicalizes_creator_url_to_space_domain() {
    assert_eq!(
        canonicalize_bilibili_creator_url("https://www.bilibili.com/space/12345678").unwrap(),
        "https://space.bilibili.com/12345678"
    );
}

#[test]
fn rejects_non_creator_urls_for_creator_sync() {
    assert!(
        canonicalize_bilibili_creator_url("https://www.bilibili.com/video/BV1xx411c7mD/").is_err()
    );
}

#[test]
fn extracts_recent_videos_from_dynamic_feed_items() {
    let payload = serde_json::from_str::<BilibiliApiEnvelope<BilibiliCreatorDynamicFeedData>>(
        r#"{
          "code": 0,
          "data": {
            "items": [
              {
                "type": "DYNAMIC_TYPE_AV",
                "modules": [
                  {
                    "module_author": {
                      "pub_ts": 1775556001,
                      "user": { "name": "JASON刘雨鑫" }
                    }
                  },
                  {
                    "module_dynamic": {
                      "dyn_archive": {
                        "bvid": "BV1en97B3E84",
                        "title": "湖北襄阳，开在巷子里的人气牛杂，尝尝怎么样"
                      }
                    }
                  }
                ]
              }
            ]
          }
        }"#,
    )
    .expect("dynamic feed should parse");

    let items = payload.data.and_then(|data| data.items).unwrap_or_default();
    let (creator_name, videos) = extract_creator_videos_from_dynamic_items(&items);

    assert_eq!(creator_name.as_deref(), Some("JASON刘雨鑫"));
    assert_eq!(videos.len(), 1);
    assert_eq!(videos[0].bvid, "BV1en97B3E84");
    assert_eq!(
        videos[0].canonical_url,
        "https://www.bilibili.com/video/BV1en97B3E84/"
    );
    assert_eq!(videos[0].title, "湖北襄阳，开在巷子里的人气牛杂，尝尝怎么样");
}
