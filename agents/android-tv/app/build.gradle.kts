plugins { id("com.android.application") }

android {
    namespace = "org.classroomhub.display"
    compileSdk = 35
    defaultConfig {
        applicationId = "org.classroomhub.display"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }
    buildTypes { release { isMinifyEnabled = false } }
}
