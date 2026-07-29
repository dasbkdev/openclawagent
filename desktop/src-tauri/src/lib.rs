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
// Force PowerShell + native exes to emit UTF-8 so Cyrillic (window titles, output) isn't
// mangled by the console's OEM code page (cp866 on RU Windows) when we read it as UTF-8.
#[cfg(target_os = "windows")]
const PS_UTF8: &str =
    "$OutputEncoding=[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; chcp 65001 > $null; ";

#[tauri::command]
fn run_command(cmd: String, cwd: Option<String>) -> CommandResult {
    let mut command = if cfg!(target_os = "windows") {
        let mut c = Command::new("powershell.exe");
        c.arg("-NoProfile").arg("-Command").arg(format!("{PS_UTF8}{cmd}"));
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

// ---------------------------------------------------------------------------
// Computer-use — the agent's "hands" on the machine (parity with OpenClaw's
// device agent): keyboard, mouse, clipboard, window/process inspection, apps.
// The destructive ones are behind the UI confirm-gate.
// ---------------------------------------------------------------------------

use enigo::{
    Axis, Button,
    Coordinate::Abs,
    Direction::{Click, Press, Release},
    Enigo, Key, Keyboard, Mouse, Settings,
};

fn new_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| e.to_string())
}

fn parse_key(s: &str) -> Option<Key> {
    let k = s.to_lowercase();
    Some(match k.as_str() {
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "win" | "super" | "meta" | "cmd" | "command" => Key::Meta,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "space" => Key::Space,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "up" => Key::UpArrow,
        "down" => Key::DownArrow,
        "left" => Key::LeftArrow,
        "right" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" => Key::PageUp,
        "pagedown" => Key::PageDown,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        _ if k.chars().count() == 1 => Key::Unicode(k.chars().next().unwrap()),
        _ => return None,
    })
}

fn is_modifier(s: &str) -> bool {
    matches!(
        s.to_lowercase().as_str(),
        "ctrl" | "control" | "alt" | "option" | "shift" | "win" | "super" | "meta" | "cmd" | "command"
    )
}

// Type a string of text at the current focus (as if typed on the keyboard).
#[tauri::command]
fn type_text(text: String) -> Result<(), String> {
    new_enigo()?.text(&text).map_err(|e| e.to_string())
}

// Press a key combination, e.g. ["ctrl","c"] or ["alt","tab"] or ["win","d"].
#[tauri::command]
fn key_combo(keys: Vec<String>) -> Result<(), String> {
    let mut e = new_enigo()?;
    let mods: Vec<&String> = keys.iter().filter(|k| is_modifier(k)).collect();
    let main: Vec<&String> = keys.iter().filter(|k| !is_modifier(k)).collect();
    for m in &mods {
        if let Some(k) = parse_key(m) {
            e.key(k, Press).map_err(|x| x.to_string())?;
        }
    }
    for k in &main {
        if let Some(key) = parse_key(k) {
            e.key(key, Click).map_err(|x| x.to_string())?;
        }
    }
    for m in mods.iter().rev() {
        if let Some(k) = parse_key(m) {
            e.key(k, Release).map_err(|x| x.to_string())?;
        }
    }
    Ok(())
}

// Move the mouse to absolute screen coordinates.
#[tauri::command]
fn mouse_move(x: i32, y: i32) -> Result<(), String> {
    new_enigo()?.move_mouse(x, y, Abs).map_err(|e| e.to_string())
}

// Click at (x,y) if given (else at the current position). button: left|right|middle.
#[tauri::command]
fn mouse_click(x: Option<i32>, y: Option<i32>, button: Option<String>) -> Result<(), String> {
    let mut e = new_enigo()?;
    if let (Some(x), Some(y)) = (x, y) {
        e.move_mouse(x, y, Abs).map_err(|s| s.to_string())?;
    }
    let b = match button.as_deref() {
        Some("right") => Button::Right,
        Some("middle") => Button::Middle,
        _ => Button::Left,
    };
    e.button(b, Click).map_err(|s| s.to_string())
}

// Scroll vertically: positive = down, negative = up (in wheel steps).
#[tauri::command]
fn mouse_scroll(amount: i32) -> Result<(), String> {
    new_enigo()?.scroll(amount, Axis::Vertical).map_err(|e| e.to_string())
}

#[tauri::command]
fn clipboard_get() -> Result<String, String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.get_text())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn clipboard_set(text: String) -> Result<(), String> {
    arboard::Clipboard::new()
        .and_then(|mut c| c.set_text(text))
        .map_err(|e| e.to_string())
}

// Running processes (names). Windows: tasklist; unix: ps.
#[tauri::command]
fn list_processes() -> Result<String, String> {
    let out = if cfg!(target_os = "windows") {
        Command::new("powershell.exe").args([
            "-NoProfile",
            "-Command",
            &format!(
                "{PS_UTF8}Get-Process | Sort-Object WS -Descending | Select-Object -First 60 | \
                 ForEach-Object {{ \"$($_.ProcessName) (pid $($_.Id))\" }}"
            ),
        ]).output()
    } else {
        Command::new("ps").arg("-eo").arg("comm").output()
    };
    out.map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .map_err(|e| e.to_string())
}

// Visible top-level windows with titles (best-effort, per OS).
#[tauri::command]
fn list_windows() -> Result<String, String> {
    let out = if cfg!(target_os = "windows") {
        Command::new("powershell.exe").args([
            "-NoProfile",
            "-Command",
            &format!("{PS_UTF8}Get-Process | Where-Object {{ $_.MainWindowTitle }} | ForEach-Object {{ \"$($_.ProcessName): $($_.MainWindowTitle)\" }}"),
        ]).output()
    } else if cfg!(target_os = "macos") {
        Command::new("osascript").args([
            "-e",
            "tell application \"System Events\" to get name of (processes where background only is false)",
        ]).output()
    } else {
        Command::new("wmctrl").arg("-l").output()
    };
    out.map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .map_err(|e| e.to_string())
}

// The currently focused window ("<app>: <title>").
#[tauri::command]
fn active_window() -> Result<String, String> {
    let out = if cfg!(target_os = "windows") {
        Command::new("powershell.exe").args([
            "-NoProfile",
            "-Command",
            &format!("{PS_UTF8}Add-Type -MemberDefinition '[DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);' -Name U -Namespace W -PassThru | Out-Null; $h=[W.U]::GetForegroundWindow(); $p=0; [W.U]::GetWindowThreadProcessId($h,[ref]$p) | Out-Null; $proc=Get-Process -Id $p; \"$($proc.ProcessName): $($proc.MainWindowTitle)\""),
        ]).output()
    } else if cfg!(target_os = "macos") {
        Command::new("osascript").args([
            "-e",
            "tell application \"System Events\" to get name of first process whose frontmost is true",
        ]).output()
    } else {
        Command::new("xdotool").args(["getactivewindow", "getwindowname"]).output()
    };
    out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        .map_err(|e| e.to_string())
}

// Virtual-screen size as "WIDTHxHEIGHT" — lets the agent map what it sees to click coords.
#[tauri::command]
fn screen_size() -> Result<String, String> {
    let out = if cfg!(target_os = "windows") {
        Command::new("powershell.exe").args([
            "-NoProfile",
            "-Command",
            &format!("{PS_UTF8}Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.SystemInformation]::VirtualScreen; \"$($b.Width)x$($b.Height)\""),
        ]).output()
    } else if cfg!(target_os = "macos") {
        Command::new("bash").args(["-lc", "system_profiler SPDisplaysDataType | awk '/Resolution/{print $2\"x\"$4; exit}'"]).output()
    } else {
        Command::new("bash").args(["-lc", "xrandr | awk '/\\*/{print $1; exit}'"]).output()
    };
    out.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_owned())
        .map_err(|e| e.to_string())
}

// Launch an application by name or path.
#[tauri::command]
fn open_app(name: String) -> Result<(), String> {
    let r = if cfg!(target_os = "windows") {
        Command::new("cmd").args(["/C", "start", "", &name]).spawn()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg("-a").arg(&name).spawn()
    } else {
        Command::new(&name).spawn()
    };
    r.map(|_| ()).map_err(|e| e.to_string())
}

// Force-close an application by executable/process name.
#[tauri::command]
fn close_app(name: String) -> Result<(), String> {
    let r = if cfg!(target_os = "windows") {
        Command::new("taskkill").args(["/IM", &name, "/F"]).output()
    } else {
        Command::new("pkill").arg("-f").arg(&name).output()
    };
    r.map(|o| {
        let _ = o;
    })
    .map_err(|e| e.to_string())
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
            type_text,
            key_combo,
            mouse_move,
            mouse_click,
            mouse_scroll,
            clipboard_get,
            clipboard_set,
            list_processes,
            list_windows,
            active_window,
            open_app,
            close_app,
            screen_size,
            set_autostart,
            get_autostart
        ])
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
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
        .on_window_event(|window, event| {
            // Close = hide to tray, don't quit. SAI stays alive in the background so the task
            // queue keeps polling and the global hotkey can bring it back. Real quit is the
            // tray "Выход" item (app.exit).
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running SAI desktop");
}
