use std::process::{Command, Child};
use std::sync::Mutex;
use std::net::TcpStream;
use std::time::{Duration, Instant};
use std::thread;
use tauri::Manager;

static API_SERVER: Mutex<Option<Child>> = Mutex::new(None);

fn wait_for_server(port: u16, timeout: Duration) -> bool {
  let start = Instant::now();
  while start.elapsed() < timeout {
    if TcpStream::connect(("127.0.0.1", port)).is_ok() {
      return true;
    }
    thread::sleep(Duration::from_millis(200));
  }
  false
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Start the API server as a child process
      let npx = if cfg!(target_os = "windows") { "npx.cmd" } else { "npx" };
      let project_root = std::env::var("NEXUS_ROOT").unwrap_or_else(|_| {
        let exe = std::env::current_exe().unwrap_or_default();
        exe.parent()
          .and_then(|p| p.parent())
          .and_then(|p| p.parent())
          .and_then(|p| p.parent())
          .map(|p| p.to_string_lossy().into_owned())
          .unwrap_or_else(|| "C:\\Fran\\claude-nexus".to_string())
      });

      eprintln!("[claude-nexus] Starting API server from: {}", project_root);

      match Command::new(npx)
        .args(["tsx", "src/web/server.ts"])
        .current_dir(&project_root)
        .spawn()
      {
        Ok(child) => {
          let pid = child.id();
          *API_SERVER.lock().unwrap() = Some(child);
          eprintln!("[claude-nexus] API server spawned (pid: {})", pid);
        }
        Err(e) => {
          eprintln!("[claude-nexus] Failed to start API server: {}", e);
        }
      }

      // Wait for server to be ready before showing the window
      eprintln!("[claude-nexus] Waiting for API server on port 3210...");
      if wait_for_server(3210, Duration::from_secs(15)) {
        eprintln!("[claude-nexus] API server ready!");
      } else {
        eprintln!("[claude-nexus] Warning: API server did not start within 15s");
      }

      // Now show the window
      let windows = app.webview_windows();
      if let Some((_label, window)) = windows.into_iter().next() {
        window.show().ok();
        window.set_focus().ok();
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");

  // Clean up API server on exit
  if let Some(ref mut child) = *API_SERVER.lock().unwrap() {
    let _ = child.kill();
    let _ = child.wait();
    eprintln!("[claude-nexus] API server stopped");
  }
}
