fn load_dotenv_files() {
    let root_env_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../.env");
    eprintln!(
        "[boot:{:}] load_dotenv_candidate path={}",
        now_ms(),
        root_env_path.display()
    );
    if root_env_path.exists() {
        match load_dotenv_file_preserve_env(&root_env_path) {
            Ok(()) => eprintln!(
                "[boot:{:}] dotenv loaded path={}",
                now_ms(),
                root_env_path.display()
            ),
            Err(error) => eprintln!(
                "[boot:{:}] dotenv load failed path={} error={}",
                now_ms(),
                root_env_path.display(),
                error
            ),
        }
    } else {
        eprintln!(
            "[boot:{:}] dotenv skipped path={}",
            now_ms(),
            root_env_path.display()
        );
    }
}

fn load_dotenv_file_preserve_env(path: &Path) -> Result<(), String> {
    let iter = dotenvy::from_path_iter(path)
        .map_err(|error| format!("open dotenv file failed: {error}"))?;
    let mut parsed = HashMap::<String, String>::new();
    for item in iter {
        let (key, value) = item.map_err(|error| format!("parse dotenv failed: {error}"))?;
        parsed.insert(key, value);
    }

    // For project-scoped NIMI variables, prefer dotenv values to avoid stale
    // inherited shell/IDE env overriding repository .env unexpectedly.
    // For non-NIMI keys, keep explicit process env precedence.
    for (key, value) in parsed {
        let should_override = key.starts_with("NIMI_") || key.starts_with("VITE_NIMI_");
        if should_override || env::var_os(&key).is_none() {
            env::set_var(key, value);
        }
    }
    Ok(())
}

fn normalize_http_method(input: Option<String>) -> Result<Method, String> {
    let method = input.unwrap_or_else(|| "GET".to_string()).to_uppercase();
    match method.as_str() {
        "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD" => {
            Method::from_bytes(method.as_bytes()).map_err(|error| error.to_string())
        }
        _ => Err(format!("不支持的请求方法：{method}")),
    }
}

fn normalize_origin(url: &Url) -> Result<String, String> {
    let scheme = url.scheme();
    if scheme != "http" && scheme != "https" {
        return Err(format!("不支持的协议：{scheme}"));
    }

    let host = url
        .host_str()
        .ok_or_else(|| "URL 缺少 host".to_string())?
        .to_ascii_lowercase();

    let port = url.port_or_known_default().unwrap_or(80);
    Ok(format!("{scheme}://{host}:{port}"))
}

fn allowed_http_origins() -> HashSet<String> {
    let mut origins = HashSet::new();
    let candidates = [
        env_value("NIMI_REALM_URL", "http://localhost:3002"),
        "http://localhost".to_string(),
        "http://127.0.0.1".to_string(),
        "http://localhost:3002".to_string(),
        "http://127.0.0.1:3002".to_string(),
        env_value("NIMI_LOCAL_PROVIDER_ENDPOINT", "http://127.0.0.1:1234/v1"),
        env_value("NIMI_LOCAL_OPENAI_ENDPOINT", "http://127.0.0.1:1234/v1"),
    ];

    for candidate in candidates {
        if let Ok(url) = Url::parse(candidate.as_str()) {
            if let Ok(origin) = normalize_origin(&url) {
                origins.insert(origin);
            }
            // Allow localhost and 127.0.0.1 as loopback aliases for the same port.
            if let Some(host) = url.host_str() {
                let port = url.port_or_known_default().unwrap_or(80);
                let scheme = url.scheme();
                match host {
                    "localhost" => {
                        origins.insert(format!("{scheme}://127.0.0.1:{port}"));
                    }
                    "127.0.0.1" => {
                        origins.insert(format!("{scheme}://localhost:{port}"));
                    }
                    _ => {}
                }
            }
        }
    }

    origins
}

fn is_private_lan_http_origin(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }

    let Some(host) = url.host_str() else {
        return false;
    };

    let Ok(ip) = host.parse::<std::net::IpAddr>() else {
        return false;
    };

    match ip {
        std::net::IpAddr::V4(addr) => {
            let octets = addr.octets();
            // RFC1918 private IPv4 ranges.
            octets[0] == 10
                || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                || (octets[0] == 192 && octets[1] == 168)
        }
        std::net::IpAddr::V6(addr) => {
            let first = addr.segments()[0];
            // Unique local (fc00::/7) and link-local (fe80::/10).
            (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80
        }
    }
}

fn sanitize_headers(headers: Option<HashMap<String, String>>) -> Result<HeaderMap, String> {
    let mut header_map = HeaderMap::new();
    if let Some(values) = headers {
        for (name, value) in values {
            let header_name = reqwest::header::HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| error.to_string())?;
            let header_value = reqwest::header::HeaderValue::from_str(&value)
                .map_err(|error| error.to_string())?;
            header_map.insert(header_name, header_value);
        }
    }
    Ok(header_map)
}

fn is_loopback_http(url: &Url) -> bool {
    if url.scheme() != "http" {
        return false;
    }
    matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
}

fn validate_external_url(url: &Url) -> Result<(), String> {
    if url.scheme() == "https" || is_loopback_http(url) {
        return Ok(());
    }
    Err("仅支持 https 或 localhost/127.0.0.1 的 http 地址".to_string())
}

fn parse_oauth_redirect_uri(redirect_uri: &str) -> Result<(String, u16, String), String> {
    let url = Url::parse(redirect_uri).map_err(|error| error.to_string())?;
    if url.scheme() != "http" {
        return Err("OAuth redirect_uri 仅支持 http loopback".to_string());
    }
    let host = url
        .host_str()
        .ok_or_else(|| "OAuth redirect_uri 缺少 host".to_string())?
        .to_ascii_lowercase();
    if host != "localhost" && host != "127.0.0.1" {
        return Err("OAuth redirect_uri host 必须是 localhost 或 127.0.0.1".to_string());
    }
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "OAuth redirect_uri 缺少端口".to_string())?;
    let path = if url.path().trim().is_empty() {
        "/".to_string()
    } else {
        url.path().to_string()
    };
    Ok((host, port, path))
}

fn read_request_target(stream: &mut std::net::TcpStream) -> Result<String, String> {
    let mut buffer = [0_u8; 8192];
    let bytes = stream
        .read(&mut buffer)
        .map_err(|error| error.to_string())?;
    if bytes == 0 {
        return Err("OAuth callback 请求体为空".to_string());
    }
    let request = String::from_utf8_lossy(&buffer[..bytes]);
    let first_line = request
        .lines()
        .next()
        .ok_or_else(|| "OAuth callback 请求格式无效".to_string())?;
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_ascii_uppercase();
    let target = parts.next().unwrap_or_default().to_string();
    if method != "GET" {
        return Err(format!("OAuth callback 仅支持 GET，当前={method}"));
    }
    if target.trim().is_empty() {
        return Err("OAuth callback 缺少请求 target".to_string());
    }
    Ok(target)
}

fn write_oauth_callback_page(stream: &mut std::net::TcpStream, success: bool) {
    let body = if success {
        r###"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OAuth Complete - Nimi</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: #ffffff;
        }
        .container {
            text-align: center;
            padding: 56px 48px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 28px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            backdrop-filter: blur(10px);
            max-width: 460px;
            width: 90%;
            animation: slideUp 0.6s ease-out;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .logo_wrapper {
            margin-bottom: 32px;
            animation: float 3s ease-in-out infinite;
        }
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        .logo {
            width: 140px;
            height: 140px;
        }
        .status_wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 20px;
        }
        .success_icon {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            animation: scaleIn 0.5s ease-out 0.3s both;
        }
        @keyframes scaleIn {
            from { opacity: 0; transform: scale(0); }
            to { opacity: 1; transform: scale(1); }
        }
        .checkmark {
            width: 16px;
            height: 16px;
            stroke: white;
            stroke-width: 3;
            stroke-linecap: round;
            stroke-linejoin: round;
            fill: none;
            animation: drawCheck 0.4s ease-out 0.6s both;
        }
        @keyframes drawCheck {
            from { stroke-dasharray: 40; stroke-dashoffset: 40; }
            to { stroke-dasharray: 40; stroke-dashoffset: 0; }
        }
        h1 {
            color: #1f2937;
            font-size: 26px;
            font-weight: 700;
            animation: fadeIn 0.5s ease-out 0.4s both;
        }
        p {
            color: #6b7280;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 8px;
            animation: fadeIn 0.5s ease-out 0.5s both;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .auto_close {
            margin-top: 24px;
            padding: 14px 24px;
            background: #f3f4f6;
            border-radius: 12px;
            font-size: 14px;
            color: #9ca3af;
            animation: fadeIn 0.5s ease-out 0.7s both;
            display: inline-flex;
            align-items: center;
            gap: 8px;
        }
        .dots {
            display: inline-flex;
            gap: 4px;
        }
        .dot {
            width: 4px;
            height: 4px;
            background: #9ca3af;
            border-radius: 50%;
            animation: bounce 1.4s ease-in-out infinite both;
        }
        .dot:nth-child(1) { animation-delay: 0s; }
        .dot:nth-child(2) { animation-delay: 0.2s; }
        .dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes bounce {
            0%, 80%, 100% { transform: scale(0); opacity: 0.5; }
            40% { transform: scale(1); opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo_wrapper">
            <svg class="logo" viewBox="184 313 380 380" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M422.113 481.686C430.279 480.015 446.572 482.447 454.744 485.044C474.442 491.419 490.788 505.375 500.17 523.835C510.86 544.83 507.885 568.74 508.02 591.755C508.09 603.355 509.375 625.185 506.61 635.715C501.86 653.805 472.816 653.475 468.884 633.79C467.447 626.595 467.732 621.445 467.725 614.045L467.799 576.085C467.82 569.98 468.13 559.645 467.414 553.935C466.877 549.735 465.639 545.65 463.753 541.855C458.426 531.205 450.147 526.415 439.371 522.855C418.86 518.45 397.129 530.92 393.886 552.465C392.732 560.135 393.355 570.905 393.38 578.865L393.501 616.235C393.539 630.155 393.938 646.325 376.066 648.96C370.79 649.76 365.414 648.385 361.173 645.145C356.643 641.695 353.662 636.02 353.392 630.495C352.832 619.04 352.815 605.915 353.063 594.415C353.741 563.005 348.149 536.885 369.342 510.415C382.862 493.529 400.96 484.259 422.113 481.686Z" fill="#1E377A"/>
                <path d="M366.78 358.693C387.936 354.799 413.753 366.464 428.697 381.272C455.942 408.267 451.554 439.24 451.453 474.569C436.213 470.888 426.427 471.087 410.973 473.849C410.952 464.297 411.502 434.843 409.743 426.92C408.674 422.173 406.671 417.686 403.851 413.72C397.957 405.5 389.408 400.845 379.57 399.148C361.515 396.503 343.387 406.617 337.892 424.366C335.266 432.85 335.94 441.424 335.986 450.205C336.03 458.147 336.033 466.089 335.995 474.031C321.154 470.317 310.245 471.335 295.554 474.351L295.477 447.484C295.438 423.32 296.416 407.895 312.579 387.553C325.927 370.754 345.517 360.925 366.78 358.693Z" fill="#1F9BAB"/>
                <path d="M308.576 481.688C328.835 479.184 350.932 486.027 366.299 499.41C355.659 511.25 350.596 521.465 346.144 536.55C345.187 535.31 344.164 534.12 343.08 532.99C336.399 526.07 327.253 522.07 317.637 521.865C306.582 521.69 297.979 525.26 289.97 532.86C276.865 545.29 279.364 561.995 279.416 578.375L279.48 617.375C279.575 625.65 280.237 633.975 275.159 641.04C272.042 645.34 267.339 648.215 262.092 649.035C250.188 650.875 239.87 642.685 239.051 630.68C237.974 614.88 239.03 598.35 238.633 582.555C237.997 557.28 237.564 532.345 254.522 511.645C268.926 493.583 285.701 484.6 308.576 481.688Z" fill="#1D3D7C"/>
            </svg>
        </div>
        <div class="status_wrapper">
            <div class="success_icon">
                <svg class="checkmark" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
            <h1>Authentication Complete!</h1>
        </div>
        <p>You have successfully signed in to Nimi.</p>
        <div class="auto_close">
            You can close this window now
            <span class="dots">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
            </span>
        </div>
    </div>
    <script>
        setTimeout(function() {
            window.close();
        }, 3000);
    </script>
</body>
</html>"###
    } else {
        r###"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OAuth Failed - Nimi</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        .container {
            text-align: center;
            padding: 56px 48px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 28px;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
            backdrop-filter: blur(10px);
            max-width: 460px;
            width: 90%;
            animation: slideUp 0.6s ease-out;
        }
        @keyframes slideUp {
            from { opacity: 0; transform: translateY(30px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .logo_wrapper {
            margin-bottom: 32px;
            animation: shake 0.8s ease-in-out;
        }
        @keyframes shake {
            0%, 100% { transform: translateX(0); }
            10%, 30%, 50%, 70%, 90% { transform: translateX(-5px); }
            20%, 40%, 60%, 80% { transform: translateX(5px); }
        }
        .logo {
            width: 140px;
            height: 140px;
            filter: drop-shadow(0 10px 20px rgba(240, 147, 251, 0.3));
        }
        .status_wrapper {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            margin-bottom: 20px;
        }
        .error_icon {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            animation: scaleIn 0.5s ease-out;
        }
        @keyframes scaleIn {
            from { opacity: 0; transform: scale(0); }
            to { opacity: 1; transform: scale(1); }
        }
        .x_mark {
            width: 16px;
            height: 16px;
            stroke: white;
            stroke-width: 3;
            stroke-linecap: round;
            stroke-linejoin: round;
        }
        h1 {
            color: #1f2937;
            font-size: 26px;
            font-weight: 700;
            animation: fadeIn 0.5s ease-out 0.2s both;
        }
        p {
            color: #6b7280;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 8px;
            animation: fadeIn 0.5s ease-out 0.3s both;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .retry_btn {
            margin-top: 28px;
            padding: 14px 32px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            border-radius: 12px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            animation: fadeIn 0.5s ease-out 0.4s both;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        .retry_btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px -5px rgba(102, 126, 234, 0.4);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="logo_wrapper">
            <svg class="logo" viewBox="184 313 380 380" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M422.113 481.686C430.279 480.015 446.572 482.447 454.744 485.044C474.442 491.419 490.788 505.375 500.17 523.835C510.86 544.83 507.885 568.74 508.02 591.755C508.09 603.355 509.375 625.185 506.61 635.715C501.86 653.805 472.816 653.475 468.884 633.79C467.447 626.595 467.732 621.445 467.725 614.045L467.799 576.085C467.82 569.98 468.13 559.645 467.414 553.935C466.877 549.735 465.639 545.65 463.753 541.855C458.426 531.205 450.147 526.415 439.371 522.855C418.86 518.45 397.129 530.92 393.886 552.465C392.732 560.135 393.355 570.905 393.38 578.865L393.501 616.235C393.539 630.155 393.938 646.325 376.066 648.96C370.79 649.76 365.414 648.385 361.173 645.145C356.643 641.695 353.662 636.02 353.392 630.495C352.832 619.04 352.815 605.915 353.063 594.415C353.741 563.005 348.149 536.885 369.342 510.415C382.862 493.529 400.96 484.259 422.113 481.686Z" fill="#1E377A"/>
                <path d="M366.78 358.693C387.936 354.799 413.753 366.464 428.697 381.272C455.942 408.267 451.554 439.24 451.453 474.569C436.213 470.888 426.427 471.087 410.973 473.849C410.952 464.297 411.502 434.843 409.743 426.92C408.674 422.173 406.671 417.686 403.851 413.72C397.957 405.5 389.408 400.845 379.57 399.148C361.515 396.503 343.387 406.617 337.892 424.366C335.266 432.85 335.94 441.424 335.986 450.205C336.03 458.147 336.033 466.089 335.995 474.031C321.154 470.317 310.245 471.335 295.554 474.351L295.477 447.484C295.438 423.32 296.416 407.895 312.579 387.553C325.927 370.754 345.517 360.925 366.78 358.693Z" fill="#1F9BAB"/>
                <path d="M308.576 481.688C328.835 479.184 350.932 486.027 366.299 499.41C355.659 511.25 350.596 521.465 346.144 536.55C345.187 535.31 344.164 534.12 343.08 532.99C336.399 526.07 327.253 522.07 317.637 521.865C306.582 521.69 297.979 525.26 289.97 532.86C276.865 545.29 279.364 561.995 279.416 578.375L279.48 617.375C279.575 625.65 280.237 633.975 275.159 641.04C272.042 645.34 267.339 648.215 262.092 649.035C250.188 650.875 239.87 642.685 239.051 630.68C237.974 614.88 239.03 598.35 238.633 582.555C237.997 557.28 237.564 532.345 254.522 511.645C268.926 493.583 285.701 484.6 308.576 481.688Z" fill="#1D3D7C"/>
            </svg>
        </div>
        <div class="status_wrapper">
            <div class="error_icon">
                <svg class="x_mark" viewBox="0 0 24 24">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </div>
            <h1>Authentication Failed</h1>
        </div>
        <p>Something went wrong during the sign-in process.</p>
        <p>Please return to the app and try again.</p>
        <button class="retry_btn" onclick="window.close()">Close Window</button>
    </div>
</body>
</html>"###
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store, no-cache, must-revalidate\r\nPragma: no-cache\r\nExpires: 0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

fn oauth_listen_for_code_blocking(
    payload: OauthListenForCodePayload,
) -> Result<OauthListenForCodeResult, String> {
    let (host, port, expected_path) = parse_oauth_redirect_uri(payload.redirect_uri.as_str())?;
    let bind_host = if host == "localhost" {
        "127.0.0.1".to_string()
    } else {
        host.clone()
    };
    let address = format!("{bind_host}:{port}");
    let listener = TcpListener::bind(address.as_str()).map_err(|error| error.to_string())?;
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;

    let timeout_ms = payload.timeout_ms.unwrap_or(180_000).clamp(10_000, 600_000);
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(timeout_ms);

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                stream
                    .set_nonblocking(false)
                    .map_err(|error| error.to_string())?;
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(5)));
                let target = read_request_target(&mut stream)?;
                if !target.starts_with(expected_path.as_str()) {
                    write_oauth_callback_page(&mut stream, false);
                    continue;
                }

                let callback_url = format!("http://localhost:{port}{target}");
                let parsed =
                    Url::parse(callback_url.as_str()).map_err(|error| error.to_string())?;
                let code = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "code")
                    .map(|(_, value)| value.to_string());
                let state = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "state")
                    .map(|(_, value)| value.to_string());
                let error = parsed
                    .query_pairs()
                    .find(|(key, _)| key == "error")
                    .map(|(_, value)| value.to_string());

                write_oauth_callback_page(&mut stream, code.is_some() && error.is_none());

                return Ok(OauthListenForCodeResult {
                    callback_url,
                    code,
                    state,
                    error,
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() >= deadline {
                    return Err("等待 OAuth 回调超时".to_string());
                }
                std::thread::sleep(std::time::Duration::from_millis(80));
            }
            Err(error) => {
                return Err(error.to_string());
            }
        }
    }
}

fn preview_text_utf8_safe(input: &str, max_bytes: usize) -> String {
    if input.len() <= max_bytes {
        return input.to_string();
    }

    let mut end = max_bytes.min(input.len());
    while end > 0 && !input.is_char_boundary(end) {
        end -= 1;
    }

    let head = &input[..end];
    format!("{head}... (截断, 共 {} 字节)", input.len())
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.trim().to_ascii_lowercase();
    normalized == "authorization"
        || normalized == "cookie"
        || normalized == "set-cookie"
        || normalized.contains("token")
        || normalized.contains("password")
        || normalized.contains("secret")
        || normalized.contains("api_key")
        || normalized.contains("apikey")
}

fn redact_json_value(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Object(map) => {
            let keys = map.keys().cloned().collect::<Vec<_>>();
            for key in keys {
                if let Some(entry) = map.get_mut(&key) {
                    if is_sensitive_key(&key) {
                        *entry = serde_json::Value::String("[REDACTED]".to_string());
                    } else {
                        redact_json_value(entry);
                    }
                }
            }
        }
        serde_json::Value::Array(items) => {
            for item in items {
                redact_json_value(item);
            }
        }
        _ => {}
    }
}

fn redact_body_preview(input: &str, max_bytes: usize) -> String {
    let trimmed = input.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(mut parsed) = serde_json::from_str::<serde_json::Value>(trimmed) {
            redact_json_value(&mut parsed);
            if let Ok(redacted) = serde_json::to_string(&parsed) {
                return preview_text_utf8_safe(&redacted, max_bytes);
            }
        }
    }
    preview_text_utf8_safe(input, max_bytes)
}
