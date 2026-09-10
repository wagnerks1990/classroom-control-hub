plugins { id("com.android.application") }

android {
    namespace = "org.classroomhub.display"
    compileSdk = 35
    defaultConfig {
        applicationId = "org.classroomhub.display"
        minSdk = 26
        targetSdk = 35
        versionCode = 2
        versionName = "0.2.0-agent-v2"
    }
    buildTypes { release { isMinifyEnabled = false } }
}
