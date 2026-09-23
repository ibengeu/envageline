pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "evangeline-android"

// `core` is pure JVM: it holds the ported narration, read-ahead and playback
// logic and depends on nothing Android, so it is testable without a device.
include(":core")

// `app` is everything platform-bound: PDF extraction, speech, audio focus,
// persistence and UI. Dependencies point one way only: app -> core.
include(":app")
