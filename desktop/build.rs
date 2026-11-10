// Windows: het Skitta-icoon en de versie in skitta.exe zetten.
fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("skitta.ico");
        res.set("ProductName", "Skitta");
        res.set("FileDescription", "Skitta");
        res.compile().expect("Windows-resources");
    }
}
