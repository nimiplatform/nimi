use reqwest::blocking::Client;
use reqwest::header::{
    ACCEPT, ACCEPT_LANGUAGE, HeaderMap, HeaderValue, ORIGIN, REFERER, USER_AGENT,
};

pub(super) const BILIBILI_ORIGIN: &str = "https://www.bilibili.com";
pub(super) const BILIBILI_REFERER: &str = "https://www.bilibili.com/";

const BILIBILI_BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const BILIBILI_ACCEPT: &str = "application/json, text/plain, */*";
const BILIBILI_ACCEPT_LANGUAGE: &str = "zh-CN,zh;q=0.9,en;q=0.8";

pub(super) fn build_http_client() -> Result<Client, String> {
    let mut default_headers = HeaderMap::new();
    default_headers.insert(ACCEPT, HeaderValue::from_static(BILIBILI_ACCEPT));
    default_headers.insert(
        ACCEPT_LANGUAGE,
        HeaderValue::from_static(BILIBILI_ACCEPT_LANGUAGE),
    );
    default_headers.insert(ORIGIN, HeaderValue::from_static(BILIBILI_ORIGIN));
    default_headers.insert(REFERER, HeaderValue::from_static(BILIBILI_REFERER));
    default_headers.insert(
        USER_AGENT,
        HeaderValue::from_static(BILIBILI_BROWSER_USER_AGENT),
    );

    Client::builder()
        .cookie_store(true)
        .default_headers(default_headers)
        .build()
        .map_err(|error| format!("http client build failed: {error}"))
}
