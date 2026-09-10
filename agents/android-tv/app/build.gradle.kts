plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val managedKeystore = System.getenv("CLASSROOM_HUB_ANDROID_KEYSTORE")?.takeIf { it.isNotBlank() }
val managedStorePassword = System.getenv("CLASSROOM_HUB_ANDROID_STORE_PASSWORD")?.takeIf { it.isNotBlank() }
val managedKeyAlias = System.getenv("CLASSROOM_HUB_ANDROID_KEY_ALIAS")?.takeIf { it.isNotBlank() } ?: "classroom-hub"
val managedKeyPassword = System.getenv("CLASSROOM_HUB_ANDROID_KEY_PASSWORD")?.takeIf { it.isNotBlank() } ?: managedStorePassword
val managedSigningReady = managedKeystore != null && managedStorePassword != null && managedKeyPassword != null

android {
    namespace = "org.classroomhub.display"
    compileSdk = 35
    buildFeatures {
        buildConfig = true
    }
    defaultConfig {
        applicationId = "org.classroomhub.display"
        minSdk = 26
        targetSdk = 35
        versionCode = 4
        versionName = "0.3.0-agent-v2"
    }
    signingConfigs {
        if (managedSigningReady) {
            create("managed") {
                storeFile = file(managedKeystore!!)
                storePassword = managedStorePassword
                keyAlias = managedKeyAlias
                keyPassword = managedKeyPassword
            }
        }
    }
    buildTypes {
        debug {
            if (managedSigningReady) signingConfig = signingConfigs.getByName("managed")
        }
        release {
            isMinifyEnabled = false
            if (managedSigningReady) signingConfig = signingConfigs.getByName("managed")
        }
    }
}

dependencies {
    implementation("com.github.MuntashirAkon:libadb-android:3.1.1")
    implementation("org.conscrypt:conscrypt-android:2.5.3")
    implementation("com.github.OnFreund:sendspin-jvm:v0.3.4")
    implementation("com.squareup.moshi:moshi:1.15.2")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
}
