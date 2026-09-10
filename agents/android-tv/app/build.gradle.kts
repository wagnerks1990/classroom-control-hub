plugins { id("com.android.application") }

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
        versionCode = 2
        versionName = "0.2.0-agent-v2"
    }
    buildTypes { release { isMinifyEnabled = false } }
}

dependencies {
    implementation("com.github.MuntashirAkon:libadb-android:3.1.1")
    implementation("org.conscrypt:conscrypt-android:2.5.3")
}
