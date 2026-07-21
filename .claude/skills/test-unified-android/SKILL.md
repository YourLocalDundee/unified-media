---
name: test-unified-android
description: Build the Unified Media Capacitor Android app and drive it on a headless emulator (or a real device over adb). Use when asked to test the phone/TV app, build the debug APK, boot the Android emulator, or click through a flow in the native Android wrapper (as opposed to the web app — see run-unified-frontend for that).
---

Drives the Capacitor Android shell at `/home/minijoe/dev/unified-frontend/native/` (see
`/home/minijoe/.claude/plans/sorted-riding-popcorn.md` for the full phone/TV app plan). The
shell has almost no code of its own — `capacitor.config.ts` points its WebView straight at
`https://unified.minijoe.dev`, so this skill is really "drive the real production site inside an
Android WebView, using adb instead of Playwright." No X server/display is required — everything
below is driven headlessly through `adb shell input` + `adb exec-out screencap`.

## Prerequisites (one-time; already done on this machine as of 2026-07-14)

- Android SDK at `~/Android/Sdk` (`platform-tools`, `platforms;android-36`, `build-tools;36.0.0`,
  `emulator`, `system-images;android-36;google_apis;x86_64`). `ANDROID_HOME`/`ANDROID_SDK_ROOT`/
  `PATH` already exported in `~/.bashrc` — a fresh interactive shell has them; a plain `bash -c`
  invocation from this harness may not, so the commands below set them explicitly anyway.
- A JDK 21 pin for Gradle only, at `~/.jdks/jdk-21.0.11+10`, via `org.gradle.java.home` in
  `~/.gradle/gradle.properties`. **Needed because**: the system `java` is a 25-ea preview build,
  and Gradle 8.14/AGP 8.13 (this Capacitor project's versions) only support up to Java 24 — you'll
  see `Unsupported class file major version 69` if this pin is ever missing/removed.
- User `minijoe` is in the `kvm` group (`sudo usermod -aG kvm minijoe`, run once by the user
  directly — this needs an interactive sudo password, which no agent session has). If a fresh
  session's shell doesn't see the group yet (no full relogin happened), wrap the emulator launch in
  `sg kvm -c "..."` — that applies the group immediately, no relogin needed.
- AVD `unified_media_test` already created (Pixel 7 profile, `android-36;google_apis;x86_64`).
  Check `avdmanager list avd`; recreate with the command in Troubleshooting if it's gone.

## Build the debug APK

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
cd /home/minijoe/dev/unified-frontend/native/android
./gradlew assembleDebug --console=plain
```
Output: `app/build/outputs/apk/debug/app-debug.apk`. The `org.gradle.java.home` pin in
`~/.gradle/gradle.properties` applies automatically — no need to set `JAVA_HOME` here.

Rebuild only after changing `native/` (the Capacitor shell itself, e.g. `capacitor.config.ts`,
icons, plugins) or `app/src/components/native/NativeAppBridge.tsx`-style native-bridge code.
Ordinary web feature work needs **no APK rebuild** — `server.url` mode means the WebView always
loads whatever is currently live at `https://unified.minijoe.dev`.

## Boot the emulator (headless)

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
nohup sg kvm -c "emulator -avd unified_media_test -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -no-snapshot" > /tmp/emulator.log 2>&1 &
disown
adb wait-for-device
for i in $(seq 1 40); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" = "1" ] && break
  sleep 8
done
```
Full cold boot takes ~1–3 minutes. `adb devices` should show `emulator-5554  device` (not
`offline`) once `sys.boot_completed=1`.

## Install + launch

```bash
adb install -r /home/minijoe/dev/unified-frontend/native/android/app/build/outputs/apk/debug/app-debug.apk
adb shell am start -n dev.minijoe.unified/.MainActivity
```
Don't use `adb shell monkey -p <pkg> -c android.intent.category.LAUNCHER 1` to launch — it was
flaky in practice (landed on the home screen instead of the app). `am start -n` is reliable.

## Driving the UI: tap / type / screenshot loop

```bash
adb shell input tap <x> <y>
adb shell input text "<literal text, no spaces — use %s for a space if needed>"
adb shell input keyevent <code>       # 4=BACK, 66=ENTER, 67=DEL
adb exec-out screencap -p > /path/to/shot.png
```
Then view the PNG with the Read tool.

**Coordinate gotcha — the single biggest source of mis-taps.** `adb shell wm size` for this AVD
reports the real framebuffer as **1080x2400**, but the Read tool's image preview downscales large
screenshots for display (this session saw 900x2000, a 1.2x factor) and *tells you the scale factor
in its own output* ("Multiply coordinates by 1.20 to map to original image"). `adb shell input tap`
takes **native** pixel coordinates. Always multiply what you see in the preview by that stated
factor before tapping — tapping raw preview coordinates lands 15-20% higher on screen than intended
(this session's first attempt hit "Forgot password?" instead of "Sign In" this exact way).

**Keyboard gotcha.** The on-screen keyboard opening shifts page layout upward (Android
`adjustResize`) — coordinates read from a screenshot taken *before* the keyboard appeared are wrong
for a field/button you're about to tap *after* it appears. Take a fresh screenshot after the
keyboard opens (e.g. after the first field-tap) before computing coordinates for anything below it.

## Logging in — never let the plaintext password land in a command Claude prints or echoes

Same underlying risk as `run-unified-frontend`'s tmux/`send-keys` warning, different mechanism here
(there's no driver script to hide it behind — yet). Do it like this, so the password only ever
exists inside a shell variable, never as a literal argument that gets echoed or printed:
```bash
ADMIN_PW=$(grep "^ADMIN_PASSWORD=" /home/minijoe/dev/unified-frontend/app/.env.local | cut -d= -f2-)
adb shell input tap <username-field-x> <username-field-y>
adb shell input text "admin"
adb shell input tap <password-field-x> <password-field-y>
adb shell input text "$ADMIN_PW"
adb shell input tap <sign-in-x> <sign-in-y>
```
Never `echo "$ADMIN_PW"`, never `cat .env.local`, never put the literal password string in a
command — all of those land in the visible transcript. Reading it into a variable via `grep`/`cut`
and referencing `"$ADMIN_PW"` does not.

## Checking what actually happened (screenshots don't show everything)

`adb exec-out screencap` only proves what's on screen. To confirm real work happened underneath
(e.g. actual video decode, not just a player UI shell):
```bash
adb shell ps | grep dev.minijoe.unified                      # confirm the process is alive
adb logcat -d --pid=<pid> | tail -100                         # full recent log for just this app
adb logcat -d --pid=<pid> | grep -iE "error|exception|40[0-9]|50[0-9]"   # targeted error scan
```
Real playback shows up as `CCodecBufferChannel`/`Codec2Client`/`AAudioStream` activity in logcat,
not just a static screenshot of a play button.

## Shut down when done

```bash
adb emu kill
```
This kills the emulator process but leaves the AVD (and its disk image) intact — no need to
recreate it next time, just re-run the boot step above.

## Troubleshooting

- **`sdkmanager` install of a large package (system images especially) fails partway with
  `Warning: ... Premature EOF`, reproducibly at the same %, even after retries**: don't keep
  retrying `sdkmanager` itself. Get the real URL and pull it with `curl` instead (curl's downloader
  handled the same multi-GB file fine where `sdkmanager`'s didn't):
  ```bash
  curl -sI "https://dl.google.com/android/repository/sys-img/<tag>/<abi>-<api>_r<rev>.zip"   # confirm it resolves
  curl -# --retry 5 --retry-delay 3 -C - -o sysimg.zip "<that URL>"
  mkdir -p "$ANDROID_HOME/system-images/android-<api>/<tag>"
  cd "$ANDROID_HOME/system-images/android-<api>/<tag>" && unzip -q /path/to/sysimg.zip
  ```
  A `source.properties` file inside the extracted package is all `sdkmanager --list_installed` /
  `avdmanager` need to recognize it as properly installed — no need for a full `package.xml`.
- **`Unsupported class file major version 69` from Gradle**: the JDK 21 pin in
  `~/.gradle/gradle.properties` is missing or was removed. Re-add
  `org.gradle.java.home=/home/minijoe/.jdks/jdk-21.0.11+10` (see Prerequisites).
- **`adb devices` shows the emulator as `offline` for a while after boot**: normal during early
  boot — wait for `sys.boot_completed=1` rather than treating `offline` as a failure.
- **AVD is gone / this is a fresh machine**: recreate it —
  ```bash
  sdkmanager "system-images;android-36;google_apis;x86_64"   # if not already installed
  echo "no" | avdmanager create avd -n unified_media_test -k "system-images;android-36;google_apis;x86_64" -d "pixel_7"
  ```
