# ZipScope Android APK

Native Expo Android app for opening large ZIP archives without the old 12 MB failure mode. It lists nested files and previews HTML, CSS, JavaScript, Python, images, MP3, MP4, and other assets.

## Preview layout

The app keeps a 70/30 workspace: the main preview occupies the larger area and the error log stays visible beside it. The preview can be expanded to full screen for web pages or a second-screen experience.

## Run

From this folder, install the Expo dependencies and run the Android app with Expo Go or an Android development build. The ZIP reader loads the archive into a single async buffer, extracts entries lazily, and writes media previews to the native cache only when selected.

This folder is the mobile app source; the existing collector project remains untouched.
