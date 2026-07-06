# Buckshot IRL Android App

This app replaces the phone browser UI. It loads the HTML/CSS/JS and assets from the APK, talks to the ESP32 at `http://192.168.4.1`, and uses native Android NFC for item reads/writes.

## Build

```sh
cd android-app
gradle assembleDebug
```

The debug APK is written to:

```text
android-app/app/build/outputs/apk/debug/app-debug.apk
```

## Install

```sh
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Connect the phone to the ESP32 AP before opening the app. The app uses `/join/allow`, so scanning the QR URL is not required.
