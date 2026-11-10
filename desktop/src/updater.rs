// Automatisch bijwerken: kijkt bij het opstarten en daarna elke zes uur in download/desktop.json
// of er een nieuwere versie is. Zo ja, dan vraagt de app of hij mag bijwerken; daarna haalt hij de
// zip op, zet de nieuwe versie op de plek van de oude en start opnieuw op.
//
// De website zelf werkt altijd al vanzelf bij; dit gaat alleen over het programma eromheen
// (venster, systeemvak, meldingen op de achtergrond).

use std::path::{Path, PathBuf};
use std::time::Duration;

use rfd::{MessageButtons, MessageDialog, MessageDialogResult, MessageLevel};
use serde_json::Value;
use tao::event_loop::EventLoopProxy;

use crate::{SITE, UserEvent};

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
const EVERY: Duration = Duration::from_secs(6 * 3600);

pub struct Update {
    pub version: String,
    pub notes: String,
    url: String,
}

/// Op de achtergrond blijven kijken; een nieuwe versie gaat als gebeurtenis naar de hoofdlus.
pub fn watch(proxy: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_secs(20));
        loop {
            if let Ok(Some(u)) = check() {
                let _ = proxy.send_event(UserEvent::Update(Some(u), false));
            }
            std::thread::sleep(EVERY);
        }
    });
}

/// Handmatig (menu "Controleren op updates"): ook melden als er niets nieuws is.
pub fn check_now(proxy: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || match check() {
        Ok(u) => {
            let _ = proxy.send_event(UserEvent::Update(u, true));
        }
        Err(e) => {
            let _ = proxy.send_event(UserEvent::UpdateFailed(format!("Controleren lukte niet: {e}")));
        }
    });
}

fn check() -> Result<Option<Update>, String> {
    let url = format!("{SITE}/download/desktop.json?v={VERSION}");
    let mut res = ureq::get(&url).call().map_err(|e| e.to_string())?;
    let info: Value = serde_json::from_str(&res.body_mut().read_to_string().map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let version = info["version"].as_str().unwrap_or_default().to_string();
    let key = if cfg!(target_os = "windows") { "windows" } else { "mac" };
    let Some(url) = info[key].as_str() else { return Ok(None) };
    if !newer(&version, VERSION) || !url.starts_with(SITE) {
        return Ok(None);
    }
    Ok(Some(Update { version, notes: info["notes"].as_str().unwrap_or_default().to_string(), url: url.to_string() }))
}

fn newer(a: &str, b: &str) -> bool {
    let parts = |s: &str| s.split('.').map(|p| p.parse::<u32>().unwrap_or(0)).collect::<Vec<_>>();
    parts(a) > parts(b)
}

/// Vragen (in de hoofdlus, want dialoogvensters horen op de hoofddraad).
pub fn ask(u: &Update) -> bool {
    // Alleen in testbuilds: meteen "Bijwerken" kiezen.
    if option_env!("SKITTA_TEST_UPDATE").is_some() {
        return true;
    }
    let text = if u.notes.is_empty() {
        format!("Skitta {} is beschikbaar (je hebt {VERSION}).\n\nNu bijwerken? Skitta start daarna opnieuw op.", u.version)
    } else {
        format!("Skitta {} is beschikbaar (je hebt {VERSION}).\n\n{}\n\nNu bijwerken? Skitta start daarna opnieuw op.", u.version, u.notes)
    };
    MessageDialog::new()
        .set_level(MessageLevel::Info)
        .set_title("Nieuwe versie van Skitta")
        .set_description(text)
        .set_buttons(MessageButtons::OkCancelCustom("Bijwerken".into(), "Later".into()))
        .show()
        == MessageDialogResult::Custom("Bijwerken".into())
}

pub fn info(title: &str, text: &str) {
    MessageDialog::new().set_level(MessageLevel::Info).set_title(title).set_description(text).set_buttons(MessageButtons::Ok).show();
}

/// Downloaden en uitpakken op een eigen draad; als alles klaarstaat, vervangt `finish` het programma.
pub fn download(u: Update, proxy: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || {
        let event = match prepare(&u.url) {
            Ok(path) => UserEvent::UpdateReady(path),
            Err(e) => UserEvent::UpdateFailed(format!("Bijwerken lukte niet: {e}")),
        };
        let _ = proxy.send_event(event);
    });
}

fn prepare(url: &str) -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!("skitta-update-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let zip = dir.join("skitta.zip");
    let mut res = ureq::get(url).call().map_err(|e| e.to_string())?;
    let bytes = res.body_mut().with_config().limit(200 * 1024 * 1024).read_to_vec().map_err(|e| e.to_string())?;
    std::fs::write(&zip, bytes).map_err(|e| e.to_string())?;
    let out = dir.join("nieuw");
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    unzip(&zip, &out)?;
    let found = if cfg!(target_os = "windows") { find(&out, "exe") } else { find(&out, "app") };
    found.ok_or_else(|| "de download bevat geen Skitta".to_string())
}

fn find(dir: &Path, ext: &str) -> Option<PathBuf> {
    std::fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).find(|p| p.extension().is_some_and(|x| x.eq_ignore_ascii_case(ext)))
}

#[cfg(target_os = "macos")]
fn unzip(zip: &Path, out: &Path) -> Result<(), String> {
    // ditto houdt rechten en de opbouw van de .app heel.
    let ok = std::process::Command::new("/usr/bin/ditto").arg("-x").arg("-k").arg(zip).arg(out).status().map_err(|e| e.to_string())?;
    if ok.success() { Ok(()) } else { Err("uitpakken mislukt".into()) }
}

#[cfg(target_os = "windows")]
fn unzip(zip: &Path, out: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    // tar.exe zit sinds Windows 10 in Windows en kan zip-bestanden uitpakken; zonder zwart venster.
    let ok = std::process::Command::new("tar")
        .arg("-xf")
        .arg(zip)
        .arg("-C")
        .arg(out)
        .creation_flags(0x0800_0000)
        .status()
        .map_err(|e| e.to_string())?;
    if ok.success() { Ok(()) } else { Err("uitpakken mislukt".into()) }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn unzip(_zip: &Path, _out: &Path) -> Result<(), String> {
    Err("niet ondersteund op dit systeem".into())
}

/// De nieuwe versie op de plek van de oude zetten en die starten. Daarna moet de app zelf afsluiten.
#[cfg(target_os = "macos")]
pub fn finish(new: &Path) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    // .../Skitta.app/Contents/MacOS/Skitta
    let bundle = exe.ancestors().nth(3).filter(|p| p.extension().is_some_and(|x| x == "app")).ok_or("Skitta draait niet vanuit Skitta.app")?;
    // Een klein script wacht tot deze app dicht is, wisselt de mappen om en opent de nieuwe versie.
    // Lukt het omwisselen niet, dan komt de oude terug.
    let script = r#"
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
rm -rf "$2.oud"
if mv "$2" "$2.oud" && mv "$3" "$2"; then
  rm -rf "$2.oud"
  xattr -dr com.apple.quarantine "$2" 2>/dev/null
else
  [ -d "$2" ] || mv "$2.oud" "$2"
fi
open "$2"
"#;
    std::process::Command::new("/bin/sh")
        .arg("-c")
        .arg(script)
        .arg("skitta-update")
        .arg(std::process::id().to_string())
        .arg(bundle)
        .arg(new)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
pub fn finish(new: &Path) -> Result<(), String> {
    // Een draaiend .exe-bestand mag je op Windows wel hernoemen, maar niet overschrijven.
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let old = exe.with_extension("exe.oud");
    let _ = std::fs::remove_file(&old);
    std::fs::rename(&exe, &old).map_err(|e| e.to_string())?;
    if let Err(e) = std::fs::copy(new, &exe) {
        let _ = std::fs::rename(&old, &exe);
        return Err(e.to_string());
    }
    std::process::Command::new(&exe).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub fn finish(_new: &Path) -> Result<(), String> {
    Err("niet ondersteund op dit systeem".into())
}

/// Bij het opstarten: wat er van een vorige update over is opruimen.
pub fn cleanup() {
    #[cfg(target_os = "windows")]
    if let Ok(exe) = std::env::current_exe() {
        let _ = std::fs::remove_file(exe.with_extension("exe.oud"));
    }
}
