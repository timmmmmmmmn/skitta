// De kleine verbinding als het venster dicht is: één WebSocket, elke 45 seconden een teken van leven,
// en een melding bij nieuwe berichten, oproepen en contactverzoeken. Berichten zijn end-to-end
// versleuteld, dus de melding zegt alleen van wie het is. Deze verbinding staat op "afwezig".

use std::collections::{HashMap, HashSet};
use std::net::TcpStream;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::Value;
use tao::event_loop::EventLoopProxy;
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::{Message, WebSocket};

use crate::{SITE, UserEvent};

pub fn start(cookie: String, stop: Arc<AtomicBool>, proxy: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || {
        let mut state = State { cookie, me: 0, names: HashMap::new(), groups: HashMap::new(), seen: HashSet::new(), rings: HashSet::new() };
        let mut delay = Duration::from_secs(2);
        while !stop.load(Ordering::Relaxed) {
            match run(&mut state, &stop, &proxy) {
                Ok(()) => return,
                Err(Stop::Unauthorized) => return,
                Err(Stop::Retry) => {
                    let until = Instant::now() + delay;
                    while Instant::now() < until {
                        if stop.load(Ordering::Relaxed) {
                            return;
                        }
                        std::thread::sleep(Duration::from_millis(500));
                    }
                    delay = (delay * 2).min(Duration::from_secs(300));
                }
            }
        }
    });
}

struct State {
    cookie: String,
    me: i64,
    names: HashMap<i64, String>,
    groups: HashMap<i64, String>,
    seen: HashSet<i64>,
    rings: HashSet<String>,
}

enum Stop {
    Unauthorized,
    Retry,
}

impl State {
    fn get(&self, path: &str) -> Option<Value> {
        let mut res = ureq::get(&format!("{SITE}/api/{path}")).header("Cookie", &self.cookie).call().ok()?;
        serde_json::from_str(&res.body_mut().read_to_string().ok()?).ok()
    }

    fn refresh(&mut self) {
        if let Some(me) = self.get("me") {
            self.me = me["id"].as_i64().unwrap_or(0);
        }
        if let Some(Value::Array(list)) = self.get("contacts") {
            for u in list {
                if let (Some(id), Some(n)) = (u["id"].as_i64(), u["display_name"].as_str()) {
                    self.names.insert(id, n.to_string());
                }
            }
        }
        if let Some(Value::Array(list)) = self.get("conversations") {
            for c in list {
                for m in c["members"].as_array().into_iter().flatten() {
                    if let (Some(id), Some(n)) = (m["id"].as_i64(), m["display_name"].as_str()) {
                        self.names.entry(id).or_insert_with(|| n.to_string());
                    }
                }
                if c["kind"] == "group" {
                    let topic = c["topic"].as_str().filter(|t| !t.is_empty()).unwrap_or("Groepsgesprek");
                    self.groups.insert(c["id"].as_i64().unwrap_or(0), topic.to_string());
                }
            }
        }
    }

    /// Staat de gebruiker nu op "Niet storen"? Steeds even opvragen: de status kan op een ander apparaat veranderd zijn.
    fn dnd(&self) -> bool {
        self.get("me").is_some_and(|me| me["presence_pref"] == "dnd")
    }

    fn name(&mut self, id: i64) -> String {
        if !self.names.contains_key(&id) {
            self.refresh();
        }
        self.names.get(&id).cloned().unwrap_or_else(|| "Skitta".into())
    }
}

fn set_timeout(ws: &WebSocket<MaybeTlsStream<TcpStream>>) {
    let t = Some(Duration::from_secs(5));
    match ws.get_ref() {
        MaybeTlsStream::Plain(s) => {
            let _ = s.set_read_timeout(t);
        }
        MaybeTlsStream::Rustls(s) => {
            let _ = s.get_ref().set_read_timeout(t);
        }
        _ => {}
    }
}

fn run(state: &mut State, stop: &AtomicBool, proxy: &EventLoopProxy<UserEvent>) -> Result<(), Stop> {
    let url = format!("{}/api/ws?dev=desktop-achtergrond", SITE.replacen("https", "wss", 1));
    let mut req = url.into_client_request().map_err(|_| Stop::Retry)?;
    req.headers_mut().insert("Cookie", state.cookie.parse().map_err(|_| Stop::Unauthorized)?);
    let (mut ws, _) = match tungstenite::connect(req) {
        Ok(ok) => ok,
        Err(tungstenite::Error::Http(res)) if res.status() == 401 => return Err(Stop::Unauthorized),
        Err(_) => return Err(Stop::Retry),
    };
    set_timeout(&ws);
    state.refresh();
    let _ = ws.send(Message::text(r#"{"t":"idle","on":true}"#));
    let mut last_ping = Instant::now();
    loop {
        if stop.load(Ordering::Relaxed) {
            let _ = ws.close(None);
            return Ok(());
        }
        if last_ping.elapsed() > Duration::from_secs(45) {
            ws.send(Message::text(r#"{"t":"ping"}"#)).map_err(|_| Stop::Retry)?;
            last_ping = Instant::now();
        }
        match ws.read() {
            Ok(Message::Text(text)) => {
                if let Ok(e) = serde_json::from_str::<Value>(text.as_str()) {
                    if e["t"] == "kick" {
                        return Err(Stop::Unauthorized);
                    }
                    if let Some((title, body)) = handle(state, &e) {
                        // Niet storen (de status in Skitta): geen melding en geen geluid.
                        if state.dnd() {
                            continue;
                        }
                        let call = e["t"] == "call";
                        let _ = proxy.send_event(UserEvent::Notify { title, body, call });
                    }
                }
            }
            Ok(Message::Close(_)) => return Err(Stop::Retry),
            Ok(_) => {}
            Err(tungstenite::Error::Io(e)) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => {}
            Err(_) => return Err(Stop::Retry),
        }
    }
}

fn handle(state: &mut State, e: &Value) -> Option<(String, String)> {
    match e["t"].as_str()? {
        "msg" => {
            let m = &e["m"];
            let id = m["id"].as_i64()?;
            let from = m["u"].as_i64()?;
            let kind = m["k"].as_str()?;
            if from == state.me || kind == "system" || m["del"] == true || m["rm"] == true || m["ed"].is_number() || !state.seen.insert(id) {
                return None;
            }
            let body = match kind {
                "photo" => "Heeft een bijlage gestuurd",
                "call" => {
                    let missed = serde_json::from_str::<Value>(m["b"].as_str()?).ok()?["missed"] == true;
                    if !missed {
                        return None;
                    }
                    "Gemiste oproep"
                }
                _ => "Nieuw bericht",
            };
            let who = state.name(from);
            let title = match state.groups.get(&m["c"].as_i64().unwrap_or(0)) {
                Some(g) => format!("{who} in {g}"),
                None => who,
            };
            Some((title, body.into()))
        }
        "call" => {
            let d = &e["d"];
            if d["type"] != "ring" || !state.rings.insert(d["id"].as_str()?.to_string()) {
                return None;
            }
            let who = state.name(e["from"].as_i64()?);
            Some((who, if d["video"] == true { "wil met je videobellen" } else { "belt je — open Skitta om op te nemen" }.into()))
        }
        "contacts" => {
            let from = e["request"].as_i64()?;
            state.refresh();
            Some((state.name(from), "wil je toevoegen als contactpersoon".into()))
        }
        "conv" => {
            state.refresh();
            None
        }
        _ => None,
    }
}
