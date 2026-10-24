use tauri::AppHandle;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            save_password,
            load_password,
            delete_password,
            report_log
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// 凭据存储：应用私有文件（0600），仅当前用户可读。不用系统钥匙串——
// ad-hoc 签名下钥匙串 ACL 随签名变化，每次升级/重装都会静默失效。
mod credentials {
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager};

    fn file(app: &AppHandle) -> Result<PathBuf, String> {
        let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(dir.join("credentials.json"))
    }

    fn read(app: &AppHandle) -> Result<BTreeMap<String, String>, String> {
        let path = file(app)?;
        match std::fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text).map_err(|e| e.to_string()),
            Err(_) => Ok(BTreeMap::new()),
        }
    }

    fn write(app: &AppHandle, map: &BTreeMap<String, String>) -> Result<(), String> {
        let path = file(app)?;
        let text = serde_json::to_string(map).map_err(|e| e.to_string())?;
        std::fs::write(&path, text).map_err(|e| e.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
        }
        Ok(())
    }

    pub fn save(app: &AppHandle, user: &str, password: &str) -> Result<(), String> {
        let mut map = read(app)?;
        map.insert(user.to_string(), password.to_string());
        write(app, &map)
    }

    pub fn load(app: &AppHandle, user: &str) -> Result<Option<String>, String> {
        let map = read(app)?;
        Ok(map.get(user).cloned())
    }

    pub fn delete(app: &AppHandle, user: &str) -> Result<(), String> {
        let mut map = read(app)?;
        map.remove(user);
        write(app, &map)
    }
}

#[tauri::command]
fn report_log(msg: String) {
    use std::io::Write;
    // open/Finder 启动 stdout 可能是 closed fd，println! 会 panic——
    // 诊断一律先落盘，stdout 仅在可写时输出。
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open("/tmp/orbitdown-diag.log")
    {
        let _ = writeln!(f, "{msg}");
    }
    let _ = writeln!(std::io::stdout().lock(), "[DIAG] {msg}");
}

#[tauri::command]
fn save_password(app: AppHandle, user: String, password: String) -> Result<(), String> {
    credentials::save(&app, &user, &password)
}

#[tauri::command]
fn load_password(app: AppHandle, user: String) -> Result<Option<String>, String> {
    credentials::load(&app, &user)
}

#[tauri::command]
fn delete_password(app: AppHandle, user: String) -> Result<(), String> {
    credentials::delete(&app, &user)
}
