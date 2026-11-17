// The desktop shell. It opens a window on the shared interface and provides
// the platform services the interface cannot do for itself: sending web
// requests to AI services, keeping keys in the system keychain, and saving
// files. Learning rules never live here; they are in the Ankhwiz core.

use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Manager;

const SERVICE: &str = "app.ankhwiz";

#[derive(Serialize)]
struct HttpReply {
  /// HTTP status, or 0 when the service could not be reached.
  status: u16,
  body: String,
}

/// Send one web request. Used only for the AI connection the learner set up.
#[tauri::command(async)]
fn http_send(url: String, method: String, headers: HashMap<String, String>, body: String) -> HttpReply {
  let agent = ureq::AgentBuilder::new()
    .timeout_connect(Duration::from_secs(15))
    .timeout(Duration::from_secs(180))
    .build();
  let mut request = agent.request(&method, &url);
  for (name, value) in &headers {
    request = request.set(name, value);
  }
  let result = if body.is_empty() { request.call() } else { request.send_string(&body) };
  match result {
    Ok(response) => {
      let status = response.status();
      HttpReply { status, body: response.into_string().unwrap_or_default() }
    }
    Err(ureq::Error::Status(status, response)) => HttpReply { status, body: response.into_string().unwrap_or_default() },
    Err(error) => HttpReply { status: 0, body: error.to_string() },
  }
}

fn fallback_file(app: &tauri::AppHandle) -> Option<PathBuf> {
  let dir = app.path().app_config_dir().ok()?;
  fs::create_dir_all(&dir).ok()?;
  Some(dir.join("keys.json"))
}

fn read_fallback(app: &tauri::AppHandle) -> HashMap<String, String> {
  fallback_file(app)
    .and_then(|path| fs::read_to_string(path).ok())
    .and_then(|text| serde_json::from_str(&text).ok())
    .unwrap_or_default()
}

fn write_fallback(app: &tauri::AppHandle, keys: &HashMap<String, String>) -> Result<(), String> {
  let path = fallback_file(app).ok_or("no settings folder")?;
  fs::write(&path, serde_json::to_string(keys).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
  }
  Ok(())
}

/// Store a key in the system keychain. When the system has none (some Linux
/// setups), it goes into a file only this user can read. Returns where it went.
#[tauri::command(async)]
fn key_set(app: tauri::AppHandle, name: String, value: String) -> Result<&'static str, String> {
  let mut keys = read_fallback(&app);
  if keyring::Entry::new(SERVICE, &name).and_then(|entry| entry.set_password(&value)).is_ok() {
    if keys.remove(&name).is_some() {
      write_fallback(&app, &keys)?;
    }
    return Ok("keychain");
  }
  keys.insert(name, value);
  write_fallback(&app, &keys)?;
  Ok("file")
}

#[tauri::command(async)]
fn key_get(app: tauri::AppHandle, name: String) -> Option<String> {
  if let Ok(value) = keyring::Entry::new(SERVICE, &name).and_then(|entry| entry.get_password()) {
    return Some(value);
  }
  read_fallback(&app).remove(&name)
}

#[tauri::command(async)]
fn key_delete(app: tauri::AppHandle, name: String) -> Result<(), String> {
  if let Ok(entry) = keyring::Entry::new(SERVICE, &name) {
    let _ = entry.delete_credential();
  }
  let mut keys = read_fallback(&app);
  if keys.remove(&name).is_some() {
    write_fallback(&app, &keys)?;
  }
  Ok(())
}

/// Save a file to the Downloads folder without overwriting anything.
/// Returns the full path.
#[tauri::command(async)]
fn save_file(app: tauri::AppHandle, name: String, contents: String) -> Result<String, String> {
  write_unique(&app, &name, contents.as_bytes())
}

/// Save binary data (an exported deck), sent as base64, the same way.
#[tauri::command(async)]
fn save_bytes(app: tauri::AppHandle, name: String, base64: String) -> Result<String, String> {
  use base64::Engine;
  let bytes = base64::engine::general_purpose::STANDARD.decode(base64.as_bytes()).map_err(|e| e.to_string())?;
  write_unique(&app, &name, &bytes)
}

fn write_unique(app: &tauri::AppHandle, name: &str, contents: &[u8]) -> Result<String, String> {
  let dir = app
    .path()
    .download_dir()
    .or_else(|_| app.path().document_dir())
    .or_else(|_| app.path().home_dir())
    .map_err(|_| "No folder was found to save into.".to_string())?;
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let clean: String = name.chars().map(|c| if c.is_alphanumeric() || "-_. ".contains(c) { c } else { '-' }).collect();
  let (stem, ext) = match clean.rsplit_once('.') {
    Some((s, e)) => (s.to_string(), format!(".{e}")),
    None => (clean.clone(), String::new()),
  };
  let mut path = dir.join(&clean);
  let mut n = 1;
  while path.exists() {
    n += 1;
    path = dir.join(format!("{stem} ({n}){ext}"));
  }
  fs::write(&path, contents).map_err(|e| e.to_string())?;
  Ok(path.to_string_lossy().into_owned())
}

/// Open a web page in the learner's own browser (a new release, for example).
/// Only plain https addresses are passed on, and never through a shell.
#[tauri::command(async)]
fn open_link(url: String) -> Result<(), String> {
  let ok = url.starts_with("https://") && url.len() < 2048 && !url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '"' || c == '\'' || c == '`');
  if !ok {
    return Err("Only https links can be opened.".into());
  }
  #[cfg(target_os = "windows")]
  let result = std::process::Command::new("explorer.exe").arg(&url).spawn();
  #[cfg(target_os = "macos")]
  let result = std::process::Command::new("open").arg(&url).spawn();
  #[cfg(all(unix, not(target_os = "macos")))]
  let result = std::process::Command::new("xdg-open").arg(&url).spawn();
  result.map(|_| ()).map_err(|e| format!("The browser could not be opened: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // The daily reminder, shown while Ankhwiz is open (it can be minimised).
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_tts::init())
    .invoke_handler(tauri::generate_handler![http_send, key_set, key_get, key_delete, save_file, save_bytes, open_link])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build())?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
