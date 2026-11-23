import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
}

// Ondertekening uit ../../AndroidStudioProjects/belliechat-release.properties (staat buiten de repo).
val localSigning = Properties().apply {
    val file = rootProject.file("../../AndroidStudioProjects/belliechat-release.properties")
    if (file.exists()) file.inputStream().use { load(it) }
}
fun signing(name: String): String? = System.getenv(name) ?: localSigning.getProperty(name)

android {
    namespace = "nl.timvanbergen.belliechat"
    compileSdk {
        version = release(37)
    }

    defaultConfig {
        applicationId = "nl.timvanbergen.belliechat"
        minSdk = 24
        targetSdk = 37
        versionCode = 3
        versionName = "1.2.0"
    }

    signingConfigs {
        create("release") {
            signing("BELLIECHAT_KEYSTORE")?.let { storeFile = file(it) }
            storePassword = signing("BELLIECHAT_KEYSTORE_PASSWORD")
            keyAlias = signing("BELLIECHAT_KEY_ALIAS")
            keyPassword = signing("BELLIECHAT_KEY_PASSWORD")
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
    implementation(libs.androidx.activity)
    implementation(libs.okhttp)
}
