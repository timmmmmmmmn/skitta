# Skitta Lite voor Android

WebView-app rond https://skittalite.timvanbergen.nl (de webapp staat in `../public/lite/`).
Pakketnaam is nog `nl.timvanbergen.belliechat` (de app heette eerst Belliechat), zodat bestaande installaties gewoon bijwerken.

Bouwen: `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleRelease`
(sleutel in `~/AndroidStudioProjects/belliechat-release.*`), daarna
`cp app/build/outputs/apk/release/app-release.apk ../public/lite/download/skittalite.apk` en deployen.
