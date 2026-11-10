// Skitta voor Windows en macOS: de website in de webweergave van het systeem (WebView2 / WebKit),
// met meldingen, een icoon in het systeemvak en zuinig gedrag op de achtergrond.
//
// Venster dicht = Skitta draait door in het systeemvak. Na een minuut wordt de webweergave helemaal
// afgebroken en houdt een kleine Rust-verbinding (achtergrond.rs) de meldingen bij. Dat kost bijna
// geen stroom. Venster weer open = de webweergave komt terug en de kleine verbinding stopt.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod achtergrond;
mod updater;

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tao::dpi::LogicalSize;
use tao::event::{Event, StartCause, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy, EventLoopWindowTarget};
use tao::window::{Icon, Window, WindowBuilder};
use tray_icon::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tray_icon::{MouseButton, TrayIcon, TrayIconBuilder, TrayIconEvent};
use wry::{WebContext, WebView, WebViewBuilder};

// SKITTA_SITE alleen om te testen tegen `wrangler dev`.
pub const SITE: &str = match option_env!("SKITTA_SITE") {
    Some(s) => s,
    None => "https://skitta.timvanbergen.nl",
};
const SLEEP_AFTER: Duration = Duration::from_secs(60);

pub enum UserEvent {
    Ipc(String),
    Tray(TrayIconEvent),
    Menu(MenuEvent),
    Notify { title: String, body: String, call: bool },
    /// Uitkomst van een updatecontrole; `true` = handmatig gevraagd (dan ook "geen update" melden).
    Update(Option<updater::Update>, bool),
    UpdateReady(PathBuf),
    UpdateFailed(String),
}

// Wat de pagina van de app kan vragen (zelfde vorm als in de Android-app).
const BRIDGE: &str = r#"
window.SkittaNative = {
  platform: () => 'desktop',
  notify: (title, body, c, kind) => window.ipc.postMessage(JSON.stringify({ t: 'notify', title, body, c: Number(c) || 0, kind })),
  badge: (n) => window.ipc.postMessage(JSON.stringify({ t: 'badge', n: Number(n) || 0 })),
  ready: () => window.ipc.postMessage('{"t":"ready"}'),
  appVersion: () => '{VERSION}',
  checkForUpdate: () => window.ipc.postMessage('{"t":"checkUpdate"}'),
  signedOut: () => window.ipc.postMessage('{"t":"signedOut"}')
};
"#;

fn icon_rgba() -> (Vec<u8>, u32, u32) {
    let decoder = png::Decoder::new(std::io::Cursor::new(include_bytes!("../../public/img/logo.png")));
    let mut reader = decoder.read_info().expect("icoon");
    let mut buf = vec![0; reader.output_buffer_size().expect("icoon")];
    let info = reader.next_frame(&mut buf).expect("icoon");
    let px = &buf[..info.buffer_size()];
    let rgba = match info.color_type {
        png::ColorType::Rgba => px.to_vec(),
        png::ColorType::Rgb => px.chunks(3).flat_map(|c| [c[0], c[1], c[2], 255]).collect(),
        _ => px.chunks(1).flat_map(|c| [c[0], c[0], c[0], 255]).collect(),
    };
    (rgba, info.width, info.height)
}

fn data_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join("Library/Application Support")))
        .unwrap_or_else(std::env::temp_dir);
    let dir = base.join("Skitta");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

fn downloads_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|h| PathBuf::from(h).join("Downloads"))
        .unwrap_or_else(std::env::temp_dir)
}

struct App {
    window: Window,
    context: WebContext,
    webview: Option<WebView>,
    proxy: EventLoopProxy<UserEvent>,
    hidden_since: Option<Instant>,
    background: Option<Arc<AtomicBool>>,
    tray: Option<TrayIcon>,
    unread: u32,
    /// Versies waarvoor al "Later" is gekozen: daar niet opnieuw over zeuren (tot de volgende start).
    skipped: Vec<String>,
}

impl App {
    fn build_webview(&mut self) {
        if self.webview.is_some() {
            return;
        }
        let proxy = self.proxy.clone();
        let downloads = downloads_dir();
        let builder = WebViewBuilder::new_with_web_context(&mut self.context)
            .with_url(SITE)
            .with_initialization_script(BRIDGE.replace("{VERSION}", updater::VERSION))
            .with_ipc_handler(move |req| {
                let _ = proxy.send_event(UserEvent::Ipc(req.body().clone()));
            })
            .with_download_started_handler(move |_url, path| {
                let name = path.file_name().map(|n| n.to_owned()).unwrap_or_else(|| "bestand".into());
                *path = downloads.join(name);
                true
            })
            .with_new_window_req_handler(|url, _features| {
                // Links naar andere sites in de gewone browser openen.
                let _ = open_in_browser(&url);
                wry::NewWindowResponse::Deny
            });
        match builder.build(&self.window) {
            Ok(view) => self.webview = Some(view),
            Err(e) => eprintln!("webweergave: {e}"),
        }
    }

    fn show(&mut self) {
        self.stop_background();
        self.hidden_since = None;
        self.build_webview();
        self.window.set_visible(true);
        self.window.set_minimized(false);
        self.window.set_focus();
    }

    fn hide(&mut self) {
        self.window.set_visible(false);
        self.hidden_since = Some(Instant::now());
    }

    // Lang genoeg weg: webweergave afbreken en overschakelen op de kleine verbinding.
    fn sleep(&mut self) {
        let Some(view) = self.webview.take() else { return };
        let cookie = view
            .cookies_for_url(SITE)
            .unwrap_or_default()
            .iter()
            .map(|c| format!("{}={}", c.name(), c.value()))
            .collect::<Vec<_>>()
            .join("; ");
        drop(view);
        if cookie.contains("sid=") {
            let stop = Arc::new(AtomicBool::new(false));
            achtergrond::start(cookie, stop.clone(), self.proxy.clone());
            self.background = Some(stop);
        }
    }

    fn stop_background(&mut self) {
        if let Some(stop) = self.background.take() {
            stop.store(true, Ordering::Relaxed);
        }
    }

    fn set_unread(&mut self, n: u32) {
        self.unread = n;
        if let Some(tray) = &self.tray {
            let _ = tray.set_tooltip(Some(if n > 0 { format!("Skitta ({n} ongelezen)") } else { "Skitta".into() }));
        }
        self.window.set_title(&if n > 0 { format!("({n}) Skitta™") } else { "Skitta™".into() });
    }

    fn handle_ipc(&mut self, msg: &str) {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(msg) else { return };
        match v["t"].as_str() {
            Some("notify") => {
                // De pagina vraagt dit alleen als Skitta niet in beeld is.
                notify(v["title"].as_str().unwrap_or("Skitta"), v["body"].as_str().unwrap_or(""));
            }
            Some("badge") => self.set_unread(v["n"].as_u64().unwrap_or(0) as u32),
            Some("signedOut") => self.stop_background(),
            Some("checkUpdate") => updater::check_now(self.proxy.clone()),
            _ => {}
        }
    }
}

// De klassieke geluiden bij meldingen van de achtergrondverbinding (de pagina speelt ze zelf als die leeft).
const SOUND_IM: &[u8] = include_bytes!("../sounds/IM.wav");
const SOUND_CALL: &[u8] = include_bytes!("../sounds/CALL_IN.wav");

pub fn play_sound(call: bool) {
    std::thread::spawn(move || {
        let Ok(sink) = rodio::DeviceSinkBuilder::open_default_sink() else { return };
        if let Ok(player) = rodio::play(sink.mixer(), std::io::Cursor::new(if call { SOUND_CALL } else { SOUND_IM })) {
            player.sleep_until_end();
        }
    });
}

pub fn notify(title: &str, body: &str) {
    let _ = notify_rust::Notification::new()
        .appname("Skitta")
        .summary(title)
        .body(body)
        .show();
}

fn open_in_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd").args(["/C", "start", "", url]).spawn().map(|_| ())
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open").arg(url).spawn().map(|_| ())
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ())
    }
}

fn make_tray() -> Option<TrayIcon> {
    let (rgba, w, h) = icon_rgba();
    let icon = tray_icon::Icon::from_rgba(rgba, w, h).ok()?;
    let menu = Menu::new();
    let _ = menu.append_items(&[
        &MenuItem::with_id("open", "Skitta openen", true, None),
        &MenuItem::with_id("update", "Controleren op updates…", true, None),
        &PredefinedMenuItem::separator(),
        &MenuItem::with_id("quit", "Skitta afsluiten", true, None),
    ]);
    TrayIconBuilder::new()
        .with_icon(icon)
        .with_tooltip("Skitta")
        .with_menu(Box::new(menu))
        .with_menu_on_left_click(false)
        .build()
        .ok()
}

fn main() {
    #[cfg(target_os = "macos")]
    let _ = notify_rust::set_application("nl.timvanbergen.skitta");

    updater::cleanup();
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    updater::watch(proxy.clone());
    {
        let p = proxy.clone();
        TrayIconEvent::set_event_handler(Some(move |e| {
            let _ = p.send_event(UserEvent::Tray(e));
        }));
        let p = proxy.clone();
        MenuEvent::set_event_handler(Some(move |e| {
            let _ = p.send_event(UserEvent::Menu(e));
        }));
    }

    let (rgba, w, h) = icon_rgba();
    let window = WindowBuilder::new()
        .with_title("Skitta™")
        .with_inner_size(LogicalSize::new(1100.0, 720.0))
        .with_min_inner_size(LogicalSize::new(640.0, 460.0))
        .with_window_icon(Icon::from_rgba(rgba, w, h).ok())
        .build(&event_loop)
        .expect("venster");

    let mut app = App {
        window,
        context: WebContext::new(Some(data_dir().join("web"))),
        webview: None,
        proxy,
        hidden_since: None,
        background: None,
        tray: None,
        unread: 0,
        skipped: Vec::new(),
    };
    app.build_webview();

    event_loop.run(move |event, _target: &EventLoopWindowTarget<UserEvent>, flow| {
        *flow = match app.hidden_since {
            Some(t) if app.webview.is_some() => ControlFlow::WaitUntil(t + SLEEP_AFTER),
            _ => ControlFlow::Wait,
        };
        match event {
            Event::NewEvents(StartCause::Init) => {
                // Op macOS mag het systeemvak-icoon pas als de lus draait.
                app.tray = make_tray();
            }
            Event::NewEvents(StartCause::ResumeTimeReached { .. }) => {
                if app.hidden_since.is_some_and(|t| t.elapsed() >= SLEEP_AFTER) {
                    app.sleep();
                }
            }
            Event::WindowEvent { event: WindowEvent::CloseRequested, .. } => app.hide(),
            #[cfg(target_os = "macos")]
            Event::Reopen { .. } => app.show(),
            Event::UserEvent(UserEvent::Ipc(msg)) => app.handle_ipc(&msg),
            Event::UserEvent(UserEvent::Notify { title, body, call }) => {
                play_sound(call);
                notify(&title, &body);
            }
            Event::UserEvent(UserEvent::Update(Some(u), manual)) => {
                if manual || !app.skipped.contains(&u.version) {
                    if updater::ask(&u) {
                        updater::download(u, app.proxy.clone());
                    } else {
                        app.skipped.push(u.version);
                    }
                }
            }
            Event::UserEvent(UserEvent::Update(None, _)) => {
                updater::info("Skitta is bijgewerkt", &format!("Je hebt de nieuwste versie ({}).", updater::VERSION));
            }
            Event::UserEvent(UserEvent::UpdateReady(path)) => match updater::finish(&path) {
                Ok(()) => {
                    app.stop_background();
                    app.webview = None;
                    *flow = ControlFlow::Exit;
                }
                Err(e) => updater::info("Bijwerken lukte niet", &e),
            },
            Event::UserEvent(UserEvent::UpdateFailed(e)) => updater::info("Skitta bijwerken", &e),
            Event::UserEvent(UserEvent::Tray(TrayIconEvent::Click { button: MouseButton::Left, .. })) => app.show(),
            Event::UserEvent(UserEvent::Tray(TrayIconEvent::DoubleClick { .. })) => app.show(),
            Event::UserEvent(UserEvent::Menu(e)) => match e.id.0.as_str() {
                "open" => app.show(),
                "update" => updater::check_now(app.proxy.clone()),
                "quit" => {
                    app.stop_background();
                    app.webview = None;
                    *flow = ControlFlow::Exit;
                }
                _ => {}
            },
            _ => {}
        }
    });
}
