// Windows: het Skitta-icoon en de productnaam in skitta.exe zetten (wordt op Windows gebouwd).
fn main() {
    #[cfg(windows)]
    {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("skitta.ico");
        res.set("ProductName", "Skitta");
        res.set("FileDescription", "Skitta");
        res.compile().expect("Windows-resources");
    }
}
