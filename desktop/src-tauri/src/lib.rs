// Native shell: window + system tray + a global hotkey (Ctrl/Cmd+Alt+Space) to toggle the
// window. The brain lives elsewhere (control-plane OpenAI bridge); this is just the face.

use std::process::Command;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Serialize)]
pub struct CommandResult {
    stdout: String,
    stderr: String,
    code: i32,
}

// Run one shell command in the built-in terminal. This is a personal tool on the Owner's
// own machine — the terminal is an explicit feature (OpenClaw parity), so it executes what
// the user (or later the agent, with confirmation) asks. PowerShell on Windows, bash elsewhere.
#[tauri::command]
fn run_command(cmd: String, cwd: Option<String>) -> CommandResult {
    let mut command = if cfg!(target_os = "windows") {
        let mut c = Command::new("powershell.exe");
        c.arg("-NoProfile").arg("-Command").arg(&cmd);
        c
    } else {
        let mut c = Command::new("bash");
        c.arg("-lc").arg(&cmd);
        c
    };
    if let Some(dir) = cwd.filter(|d| !d.is_empty()) {
        command.current_dir(dir);
    }
    match command.output() {
        Ok(out) => CommandResult {
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
            code: out.status.code().unwrap_or(-1),
        },
        Err(e) => CommandResult {
            stdout: String::new(),
            stderr: format!("не удалось запустить: {e}"),
            code: -1,
        },
    }
}

fn toggle_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
        } else {
            let _ = win.show();
            let _ = win.set_focus();
        }
    }
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

// Base64 of a file's raw bytes — used to feed images (screenshots, pasted pictures) to the
// vision model. Kept native so the agent can hand a path straight to Claude.
#[tauri::command]
fn read_file_base64(path: String) -> Result<String, String> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(bytes))
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// Targeted edit: replace exactly `old` with `new`. Fails if `old` is absent or ambiguous
// (appears more than once) — same discipline as a code-editing tool, so the agent can't
// silently clobber the wrong place.
#[tauri::command]
fn edit_file(path: String, old: String, new: String) -> Result<String, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let count = content.matches(&old).count();
    if count == 0 {
        return Err("фрагмент old не найден в файле".into());
    }
    if count > 1 {
        return Err(format!("фрагмент old встречается {count} раз — сделай его уникальным"));
    }
    let updated = content.replacen(&old, &new, 1);
    std::fs::write(&path, updated).map_err(|e| e.to_string())?;
    Ok("файл изменён".into())
}

#[tauri::command]
fn list_dir(path: String) -> Result<Vec<String>, String> {
    let entries = std::fs::read_dir(&path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        let suffix = if entry.path().is_dir() { "/" } else { "" };
        out.push(format!("{name}{suffix}"));
    }
    out.sort();
    Ok(out)
}

const WALK_MAX_ENTRIES: usize = 20_000;
const SKIP_DIRS: &[&str] = &["node_modules", ".git", "target", "dist", "build", ".venv", "__pycache__"];

fn walk(root: &std::path::Path, mut visit: impl FnMut(&std::path::Path) -> bool) {
    let mut stack = vec![root.to_path_buf()];
    let mut seen = 0usize;
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            seen += 1;
            if seen > WALK_MAX_ENTRIES {
                return;
            }
            let path = entry.path();
            if path.is_dir() {
                let name = entry.file_name().to_string_lossy().into_owned();
                if SKIP_DIRS.contains(&name.as_str()) {
                    continue;
                }
                stack.push(path);
            } else if !visit(&path) {
                return;
            }
        }
    }
}

// Find files whose name contains `pattern` (case-insensitive) under `root`. Cheap glob-lite.
#[tauri::command]
fn find_files(root: String, pattern: String, max: Option<usize>) -> Result<Vec<String>, String> {
    let cap = max.unwrap_or(200);
    let needle = pattern.to_lowercase();
    let mut out = Vec::new();
    walk(std::path::Path::new(&root), |path| {
        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
            if needle.is_empty() || name.to_lowercase().contains(&needle) {
                out.push(path.to_string_lossy().into_owned());
            }
        }
        out.len() < cap
    });
    Ok(out)
}

// Grep: lines containing `query` (case-insensitive) in text files under `root`.
#[tauri::command]
fn search_files(root: String, query: String, max: Option<usize>) -> Result<Vec<String>, String> {
    let cap = max.unwrap_or(200);
    let needle = query.to_lowercase();
    if needle.is_empty() {
        return Err("пустой запрос".into());
    }
    let mut out = Vec::new();
    walk(std::path::Path::new(&root), |path| {
        if let Ok(text) = std::fs::read_to_string(path) {
            for (i, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    let trimmed = line.trim();
                    let snippet: String = trimmed.chars().take(200).collect();
                    out.push(format!("{}:{}: {}", path.to_string_lossy(), i + 1, snippet));
                    if out.len() >= cap {
                        return false;
                    }
                }
            }
        }
        out.len() < cap
    });
    Ok(out)
}

// Open a file, folder, or URL with the OS default handler.
#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    let result = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &path]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&path).spawn()
    } else {
        Command::new("xdg-open").arg(&path).spawn()
    };
    result.map(|_| ()).map_err(|e| e.to_string())
}

// Capture the whole screen to a temp PNG and return its path (feed to vision via base64).
// Uses the OS's own tooling so we don't drag in a screen-capture crate.
#[tauri::command]
fn screenshot() -> Result<String, String> {
    let mut file = std::env::temp_dir();
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    file.push(format!("sai-shot-{stamp}.png"));
    let path = file.to_string_lossy().into_owned();

    let status = if cfg!(target_os = "windows") {
        let ps = format!(
            "Add-Type -AssemblyName System.Windows.Forms,System.Drawing; \
             $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \
             $bmp=New-Object System.Drawing.Bitmap($b.Width,$b.Height); \
             $g=[System.Drawing.Graphics]::FromImage($bmp); \
             $g.CopyFromScreen($b.X,$b.Y,0,0,$bmp.Size); \
             $bmp.Save('{}',[System.Drawing.Imaging.ImageFormat]::Png)",
            path.replace('\\', "\\\\")
        );
        Command::new("powershell.exe").args(["-NoProfile", "-Command", &ps]).status()
    } else if cfg!(target_os = "macos") {
        Command::new("screencapture").args(["-x", &path]).status()
    } else {
        Command::new("import").args(["-window", "root", &path]).status()
    };
    match status {
        Ok(s) if s.success() => Ok(path),
        Ok(s) => Err(format!("screenshot завершился с кодом {:?}", s.code())),
        Err(e) => Err(format!("не удалось сделать скриншот: {e}")),
    }
}

// Launch SAI on system login (tray + global hotkey make it an always-available assistant).
#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(|e| e.to_string())
    } else {
        manager.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn get_autostart(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ctrl+Alt+Space (Win/Linux) / Cmd+Alt+Space feel — Modifiers::SUPER also works on macOS.
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let toggle_for_handler = toggle;

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            run_command,
            read_file,
            read_file_base64,
            write_file,
            edit_file,
            list_dir,
            find_files,
            search_files,
            open_path,
            screenshot,
            set_autostart,
            get_autostart
        ])
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &toggle_for_handler && event.state() == ShortcutState::Pressed {
                        toggle_main_window(app);
                    }
                })
                .build(),
        )
        .setup(move |app| {
            app.global_shortcut().register(toggle)?;

            let show = MenuItem::with_id(app, "show", "Показать", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("SAI")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "quit" => app.exit(0),
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running SAI desktop");
}
