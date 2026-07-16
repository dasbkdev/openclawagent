// Native shell: window + system tray + a global hotkey (Ctrl/Cmd+Alt+Space) to toggle the
// window. The brain lives elsewhere (control-plane OpenAI bridge); this is just the face.

use std::process::Command;

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager,
};
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

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Ctrl+Alt+Space (Win/Linux) / Cmd+Alt+Space feel — Modifiers::SUPER also works on macOS.
    let toggle = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::Space);
    let toggle_for_handler = toggle;

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            run_command,
            read_file,
            write_file,
            list_dir
        ])
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
                .tooltip("Starlab")
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
        .expect("error while running Starlab desktop");
}
