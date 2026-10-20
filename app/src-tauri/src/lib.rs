use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, RunEvent, State};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// What the UI needs to talk to the background service.
#[derive(Clone, Serialize, Deserialize)]
struct SidecarInfo {
    port: u16,
    token: String,
}

/// The sidecar prints one JSON line when it is listening: `{"ready":true,"port":N,"token":"..."}`.
#[derive(Deserialize)]
struct ReadyLine {
    ready: bool,
    port: u16,
    token: String,
}

#[derive(Default)]
struct Sidecar {
    info: Mutex<Option<SidecarInfo>>,
    child: Mutex<Option<CommandChild>>,
}

#[tauri::command]
fn sidecar_info(state: State<Sidecar>) -> Option<SidecarInfo> {
    state.info.lock().expect("sidecar info lock").clone()
}

fn spawn_sidecar(app: &tauri::AppHandle) -> Result<(), String> {
    let shell = app.shell();

    // Debug: run the TypeScript sources with the developer's Node. Release: the bundled Node and bundled sidecar.
    #[cfg(debug_assertions)]
    let command = {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../sidecar");
        shell
            .command("node")
            .args(["--import", "tsx", "src/index.ts"])
            .env("MEMOTION_DEV", "1")
            .current_dir(dir)
    };
    #[cfg(not(debug_assertions))]
    let command = {
        use tauri::path::BaseDirectory;
        let entry = app
            .path()
            .resolve("sidecar/dist/index.js", BaseDirectory::Resource)
            .map_err(|e| format!("sidecar resource not found: {e}"))?;
        shell
            .sidecar("node")
            .map_err(|e| format!("bundled node not found: {e}"))?
            .args([entry.to_string_lossy().to_string()])
            .current_dir(entry.parent().and_then(|p| p.parent()).unwrap_or(&entry).to_path_buf())
    };

    // The sidecar exits when this pipe closes, so it never outlives the app even after a crash.
    let (mut rx, child) = command
        .env("MEMOTION_EXIT_ON_STDIN_CLOSE", "1")
        .spawn()
        .map_err(|e| format!("failed to start the background service: {e}"))?;

    *app.state::<Sidecar>().child.lock().expect("sidecar child lock") = Some(child);

    let handle = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    for line in text.lines() {
                        if let Ok(ready) = serde_json::from_str::<ReadyLine>(line) {
                            if ready.ready {
                                *handle.state::<Sidecar>().info.lock().expect("sidecar info lock") =
                                    Some(SidecarInfo { port: ready.port, token: ready.token });
                            }
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes).trim_end()),
                CommandEvent::Error(e) => eprintln!("[sidecar] error: {e}"),
                CommandEvent::Terminated(t) => {
                    eprintln!("[sidecar] exited: {:?}", t.code);
                    *handle.state::<Sidecar>().info.lock().expect("sidecar info lock") = None;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Sidecar::default())
        .invoke_handler(tauri::generate_handler![sidecar_info])
        .setup(|app| {
            spawn_sidecar(app.handle()).map_err(|e| -> Box<dyn std::error::Error> { e.into() })
        })
        .build(tauri::generate_context!())
        .expect("error while building Memotion");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<Sidecar>().child.lock().expect("sidecar child lock").take() {
                let _ = child.kill();
            }
        }
    });
}
