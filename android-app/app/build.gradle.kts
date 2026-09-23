plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.detekt)
}

android {
    namespace = "com.evangeline.reader.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.evangeline.reader.app"
        // T089: API 26 gives TextToSpeech.synthesizeToFile with a file
        // descriptor and AudioAttributes-based focus handling.
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        jvmToolchain(17)
    }

    sourceSets {
        getByName("main").kotlin.srcDir("src/main/kotlin")
        getByName("test").kotlin.srcDir("src/test/kotlin")
        getByName("debug").kotlin.srcDir("src/debug/kotlin")
    }
}

dependencies {
    implementation(project(":core"))
    implementation(libs.kotlinx.coroutines.core)
    // OWASP A01:2025 Broken Access Control - profileinstaller contributes an
    // exported receiver to the merged manifest. This app never installs
    // baseline profiles, so the dependency is excluded rather than left to
    // widen the app's exported surface (T093).
    implementation(libs.androidx.core.ktx) {
        exclude(group = "androidx.profileinstaller", module = "profileinstaller")
    }

    testImplementation(kotlin("test"))
    testImplementation(libs.junit.jupiter)
    testImplementation(libs.kotlinx.coroutines.test)
    testRuntimeOnly(libs.junit.platform.launcher)
}

detekt {
    buildUponDefaultConfig = false
    config.setFrom(rootProject.file("detekt.yml"))
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
}

// Principle V: the complexity gate runs as part of `check`, not as an opt-in task.
tasks.named("check") {
    dependsOn(tasks.named("detekt"))
}
