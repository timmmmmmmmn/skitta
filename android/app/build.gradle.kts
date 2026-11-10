import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Ondertekening: uit ../../AndroidStudioProjects/skitta-release.properties (staat buiten de repo),
// of op GitHub uit de geheime instellingen.
val localSigning = Properties().apply {
    val file = rootProject.file("../../AndroidStudioProjects/skitta-release.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signing(name: String): String? = System.getenv(name) ?: localSigning.getProperty(name)

// Versienummer: op GitHub het buildnummer, lokaal uit -PbuildNumber.
val buildNumber = System.getenv("GITHUB_RUN_NUMBER")?.toIntOrNull()
    ?: (project.findProperty("buildNumber") as String?)?.toIntOrNull() ?: 1

android {
    namespace = "nl.timvanbergen.skitta"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "nl.timvanbergen.skitta"
        minSdk = 26
        targetSdk = 37
        versionCode = buildNumber
        versionName = "1.0.$buildNumber"
        // Alleen om te testen tegen `wrangler dev`: -PskittaSite=http://localhost:8795
        val site = (project.findProperty("skittaSite") as String?) ?: "https://skitta.timvanbergen.nl"
        buildConfigField("String", "SITE", "\"$site\"")
        manifestPlaceholders["cleartext"] = site.startsWith("http://").toString()
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        create("release") {
            signing("SKITTA_KEYSTORE")?.let { storeFile = file(it) }
            storePassword = signing("SKITTA_KEYSTORE_PASSWORD")
            keyAlias = signing("SKITTA_KEY_ALIAS")
            keyPassword = signing("SKITTA_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.customview)
    implementation(libs.okhttp)
}
