---
name: test-unified-android
description: Build the Unified Media Capacitor Android app and drive it on a headless emulator (or a real device over adb). Use when asked to test the phone/TV app, build the debug APK, boot the Android emulator, or click through a flow in the native Android wrapper (as opposed to the web app — see run-unified-frontend for that).
---

> ## ⛔ The toolchain is not installed on this machine. Read this before anything else.
>
> Checked directly on 2026-08-16: **no `java`, no `adb`, no `gradle`, no `sdkmanager`, no
> `~/Android/Sdk`, no `~/.jdks`, no `~/.gradle`.** All of it went with the wipe.
>
> The previous version of this file opened with "Prerequisites (one-time; **already done on this
> machine** as of 2026-07-14)" and then listed those exact things. That statement described the
> pre-wipe server and is false today — every command below the build section would fail at
> `command not found`. Do not trust a "repointed" skill that was never run.
>
> Restoring it is a real install (JDK + SDK + a ~10GB system image), so it is a decision, not a
> step. See **"Restoring the toolchain"** at the bottom. Everything the emulator needs on the
> *host* side is already fine: `/dev/kvm` exists, `joe` is in the `kvm` group (991), and there is
> 392G free on `/`.

Drives the Capacitor Android shell at `/home/joe/unified-media/native/`. The shell has almost no
code of its own — `capacitor.config.ts` sets `server.url` to `https://<app-host>`, so
this skill is really "drive the real production site inside an Android WebView, using adb instead
of Playwright." No X server is required; everything is driven headlessly through
`adb shell input` + `adb exec-out screencap`.

Verified project facts (2026-08-16): appId **`dev.minijoe.unified`**, Gradle **8.14.3**,
AGP **8.13.0**.

> If you only need to know whether a *web* change works, stop here and use
> `run-unified-frontend` instead. The WebView loads the same live site; the APK adds nothing to a
> web-only question and costs minutes instead of seconds.

## ⚠️ DNS: the emulator cannot resolve the app's own URL by default

`<app-host>` resolves **only** through Pi-hole, and the host resolver deliberately never
points at Pi-hole (standing rule — that misconfiguration caused the original outage). An emulator
inherits the host's resolver, so the WebView will fail to load the site with a plain DNS error that
looks nothing like a DNS problem.

Boot the emulator with Pi-hole as its resolver:
```bash
emulator -avd unified_media_test -dns-server <lan-ip> ...
```
This was **not** in the pre-wipe version of this file, because the pre-wipe server had a different
DNS layout. Expect to hit it the first time the emulator ever runs here.

## Build the debug APK

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"
cd /home/joe/unified-media/native/android
./gradlew assembleDebug --console=plain
```
Output: `app/build/outputs/apk/debug/app-debug.apk`.

Rebuild only after changing `native/` (the Capacitor shell itself — `capacitor.config.ts`, icons,
plugins) or native-bridge code like `app/src/components/native/NativeAppBridge.tsx`. Ordinary web
feature work needs **no APK rebuild**: `server.url` mode means the WebView always loads whatever is
live at `https://<app-host>`.

## Boot the emulator (headless)

```bash
export ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
nohup emulator -avd unified_media_test -no-window -no-audio -no-boot-anim \
  -gpu swiftshader_indirect -no-snapshot -dns-server <lan-ip> > /tmp/emulator.log 2>&1 &
disown
adb wait-for-device
for i in $(seq 1 40); do
  [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')" = "1" ] && break
  sleep 8
done
```
Cold boot takes ~1–3 minutes. `adb devices` should show `emulator-5554  device` (not `offline`)
once `sys.boot_completed=1`.

The old version wrapped this in `sg kvm -c "..."` for a user named `minijoe`. Neither applies:
the user is **`joe`**, and `joe` is already in the `kvm` group, so no `sg` wrapper is needed unless
a future session's shell somehow lacks the group.

## Install + launch

```bash
adb install -r /home/joe/unified-media/native/android/app/build/outputs/apk/debug/app-debug.apk
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
screenshots for display (a past session saw 900x2000, a 1.2x factor) and *states the scale factor
in its own output* ("Multiply coordinates by 1.20 to map to original image"). `adb shell input tap`
takes **native** pixel coordinates. Always multiply what you see in the preview by that stated
factor before tapping — tapping raw preview coordinates lands 15–20% higher on screen than
intended (a past session hit "Forgot password?" instead of "Sign In" this exact way).

**Keyboard gotcha.** The on-screen keyboard opening shifts layout upward (Android `adjustResize`),
so coordinates read from a screenshot taken *before* the keyboard appeared are wrong for anything
you tap *after* it appears. Take a fresh screenshot once the keyboard is open.

## Logging in — never let the plaintext password reach the transcript

There is no driver script to hide it behind here, so do it via a shell variable, and read it from
the **real** env file:

```bash
ADMIN_PW=$(grep "^ADMIN_PASSWORD=" /home/joe/docker/unified-media/.env | cut -d= -f2-)
adb shell input tap <username-field-x> <username-field-y>
adb shell input text "admin"
adb shell input tap <password-field-x> <password-field-y>
adb shell input text "$ADMIN_PW"
adb shell input tap <sign-in-x> <sign-in-y>
```
⚠️ The old version read `app/.env.local`. **That file does not exist on this machine** — the grep
would return nothing and you would silently type an empty password, then debug a "login is broken"
ghost. Credentials live in `/home/joe/docker/unified-media/.env`.

Never `echo "$ADMIN_PW"`, never `cat` the env file, never put the literal password in a command —
all of those land in the visible transcript.

## Checking what actually happened (screenshots don't show everything)

```bash
adb shell ps | grep dev.minijoe.unified                                  # process alive?
adb logcat -d --pid=<pid> | tail -100                                    # recent log, this app only
adb logcat -d --pid=<pid> | grep -iE "error|exception|40[0-9]|50[0-9]"   # targeted error scan
```
Real playback shows as `CCodecBufferChannel`/`Codec2Client`/`AAudioStream` activity in logcat, not
just a screenshot of a play button.

## Shut down when done

```bash
adb emu kill
```
Leaves the AVD and its disk image intact.

## Restoring the toolchain

Not done automatically — this is a multi-GB install and a user decision. What is needed:

1. **JDK 21**, pinned for Gradle only. AGP 8.13 / Gradle 8.14.3 support up to Java 24; a newer
   system JDK produces `Unsupported class file major version NN`. Install it, then:
   `echo 'org.gradle.java.home=/home/joe/.jdks/<jdk-21-dir>' >> ~/.gradle/gradle.properties`
   (`~/.gradle/` does not currently exist).
2. **Android SDK** at `~/Android/Sdk`: `platform-tools`, `platforms;android-36`,
   `build-tools;36.0.0`, `emulator`, `system-images;android-36;google_apis;x86_64`.
   Export `ANDROID_HOME`/`ANDROID_SDK_ROOT`/`PATH` in `~/.bashrc`.
3. **The AVD**:
   ```bash
   echo "no" | avdmanager create avd -n unified_media_test \
     -k "system-images;android-36;google_apis;x86_64" -d "pixel_7"
   ```
4. Then work through this file top to bottom and record what actually happened — **nothing below
   the build section has been executed on the rebuilt server.**

**Known install gotcha, kept from the pre-wipe run:** if `sdkmanager` fails partway through a large
package with `Warning: ... Premature EOF`, reproducibly at the same %, stop retrying it — fetch the
zip with `curl` instead (curl handled the same multi-GB file fine where `sdkmanager` did not):
```bash
curl -sI "https://dl.google.com/android/repository/sys-img/<tag>/<abi>-<api>_r<rev>.zip"
curl -# --retry 5 --retry-delay 3 -C - -o sysimg.zip "<that URL>"
mkdir -p "$ANDROID_HOME/system-images/android-<api>/<tag>"
cd "$ANDROID_HOME/system-images/android-<api>/<tag>" && unzip -q /path/to/sysimg.zip
```
A `source.properties` inside the extracted package is all `sdkmanager --list_installed` and
`avdmanager` need to treat it as installed — no full `package.xml` required.

## Other corrections made 2026-08-16
- Removed the reference to `/home/joe/.claude/plans/sorted-riding-popcorn.md` for "the full
  phone/TV app plan" — **that file does not exist**; it did not survive the wipe.
- `minijoe` → `joe` throughout (user, `usermod`, home paths).
- `app/.env.local` → `/home/joe/docker/unified-media/.env`.
- Added the `-dns-server <lan-ip>` requirement, which is new to the rebuilt server.
