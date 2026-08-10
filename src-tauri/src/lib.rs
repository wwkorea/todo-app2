use serde::{Deserialize, Serialize};

/// AI API 키는 데이터 폴더가 아닌 Windows 자격 증명 관리자(DPAPI 기반)에 저장한다.
/// 데이터 폴더는 백업·복사·공유 대상이라 키가 따라다니면 유출 경로가 되기 때문.
const KEYRING_SERVICE: &str = "rag-todo-app";
const KEYRING_USER: &str = "ai_api_key";

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())
}

fn get_ai_key() -> Option<String> {
    keyring_entry().ok()?.get_password().ok()
}

#[tauri::command]
fn set_ai_key(key: Option<String>) -> Result<(), String> {
    let entry = keyring_entry()?;
    match key.map(|k| k.trim().to_string()).filter(|k| !k.is_empty()) {
        Some(k) => entry.set_password(&k).map_err(|e| e.to_string()),
        None => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

#[tauri::command]
fn has_ai_key() -> bool {
    get_ai_key().is_some()
}

#[derive(Deserialize)]
struct AiConfig {
    base_url: String,
    model: String,
}

#[derive(Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: String,
}

#[derive(Serialize)]
struct AiResult {
    ok: bool,
    content: Option<String>,
    error: Option<String>,
}

fn ai_err(msg: String) -> AiResult {
    AiResult { ok: false, content: None, error: Some(msg) }
}

/// 사내 LLM 호출 (OpenAI 호환 chat/completions).
/// 웹뷰의 CORS 제약을 피하고 API 키를 웹 영역에 노출하지 않기 위해 Rust에서 호출한다.
#[tauri::command]
async fn ai_complete(cfg: AiConfig, messages: Vec<ChatMessage>) -> AiResult {
    let url = format!("{}/chat/completions", cfg.base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let mut req = client
        .post(&url)
        .timeout(std::time::Duration::from_secs(120))
        .json(&serde_json::json!({
            "model": cfg.model,
            "messages": messages,
            "temperature": 0.2
        }));
    if let Some(key) = get_ai_key() {
        req = req.bearer_auth(key);
    }

    let res = match req.send().await {
        Ok(r) => r,
        Err(e) if e.is_timeout() => return ai_err("요청 시간 초과 (120초)".into()),
        Err(e) => return ai_err(e.to_string()),
    };

    let status = res.status();
    if !status.is_success() {
        let text: String = res.text().await.unwrap_or_default().chars().take(300).collect();
        return ai_err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    match res.json::<serde_json::Value>().await {
        Ok(v) => match v["choices"][0]["message"]["content"].as_str() {
            Some(c) => AiResult { ok: true, content: Some(c.to_string()), error: None },
            None => ai_err("응답에 content가 없습니다".into()),
        },
        Err(e) => ai_err(e.to_string()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use tauri::Manager;
    tauri::Builder::default()
        // 단일 인스턴스: 중복 실행 시 새 프로세스는 종료되고 기존 창을 앞으로 띄운다.
        // 다른 플러그인보다 먼저 등록해야 한다.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![set_ai_key, has_ai_key, ai_complete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
