# CoolLamp phone app

Capacitor app with a bundled web interface, Wi-Fi discovery/control, and the community BLE plugin.
No cloud or Wi-Fi is required for Bluetooth control.
See [implementation and protocol](../docs/bluetooth-app.md).
See [multi-lamp app, discovery, design, and validation](../docs/app-1.4.md).

## Development

Use Node 22 or newer and pnpm. Versions are locked in pnpm-lock.yaml.
The workspace uses a flat dependency layout to avoid directory-link traversal by Arduino IDE.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
pnpm exec cap sync
```

Use pnpm dev for local interface development. Browser Bluetooth support varies;
use the native app for iOS and Android validation.

## Android

After syncing, open android/ in Android Studio. Install its required SDK and JDK,
then build/run on a physical phone. Bluetooth scan/connect permissions are declared.
Android 12+ scanning uses neverForLocation; older versions may request location
permission for Bluetooth scanning.

## iOS

On a Mac with Xcode, install dependencies, build, sync and open
ios/App/App.xcodeproj. Select a signing team and physical iPhone. Swift Package
Manager supplies dependencies; the Bluetooth usage description is included.
Bluetooth is not available in the iOS simulator.

The registered app ID is com.coollamp.controller and the Apple Team ID is
P3XKA54Q3B. Both Debug and Release use automatic signing for this team.
No signing credentials or store releases are configured.

### Build from Windows using GitHub Actions

The manually triggered `iOS build check` workflow uses a GitHub-hosted Mac to
test the web code, sync Capacitor, and compile the iPhone Release target without
signing. The shared App scheme is checked in for command-line builds.
After the source and workflow are pushed to GitHub's default branch, select
Actions > iOS build check > Run workflow. Build logs are retained for seven days.
GitHub runner usage may count toward the account's Actions allowance.

This check does not produce an installable app or upload to TestFlight. Distribution
still requires the registered Bundle ID, Apple Team ID, and signing credentials
configured in the build service. Never commit Apple private keys or certificates.

### TestFlight signing and upload

The `iOS TestFlight upload` workflow runs only when manually started. It builds
and validates an IPA, then uploads it to Apple for processing. It does not submit
an App Store release or an external beta review. After processing, add the build
to an internal testing group in App Store Connect and install it with TestFlight.

In the personal `jammendolia/CoolLamp` repository, configure these Actions settings:

| Type | Name | Value |
| --- | --- | --- |
| Variable | APP_STORE_CONNECT_KEY_IDENTIFIER | G84MR42636 |
| Variable | APP_STORE_CONNECT_ISSUER_ID | c73e6da3-7393-4662-a7ac-d669ce8e68b4 |
| Secret | APP_STORE_CONNECT_PRIVATE_KEY | Entire downloaded Apple .p8 file, including BEGIN/END lines |
| Secret | CERTIFICATE_PRIVATE_KEY | A persistent RSA 2048-bit private key in PEM format, separate from the .p8 API key |

The open-source Codemagic CLI tools run on GitHub's Mac; a Codemagic account is
not needed. The signing step creates an Apple distribution certificate and App
Store provisioning profile if needed, reusing the certificate private key on later
builds. Do not regenerate that key for each build or revoke existing certificates
to resolve a failure. The API key needs permission to manage certificates/profiles.

The workflow uses build numbers `<workflow run number>.<attempt>`. Run numbers
increase across new runs; attempts increase on reruns. If builds are later uploaded
by another system, coordinate numbering before using this workflow again.

Both workflows and the app source must be pushed before they can run. Native
compilation, signing, and upload remain unverified until a hosted run succeeds.

References: [Codemagic CLI with GitHub Actions](https://blog.codemagic.io/deploy-your-app-to-app-store-with-codemagic-cli-tools-and-github-actions/),
[signing command](https://github.com/codemagic-ci-cd/cli-tools/blob/master/docs/app-store-connect/fetch-signing-files.md).

## Verification

pnpm test exercises the actual transport code with a fake radio: input boundaries,
effect consistency, notifications, reconnect, ordered writes, acknowledgments,
timeouts, stale callbacks and firmware errors.

Both native projects include the BLE plugin. They need their platform toolchains
for compilation and installation. A successful web build is not an APK or a signed
iOS application; mock tests cannot verify radio connectivity.

## Online firmware updates

The app reads installed/latest versions and update progress over Bluetooth. It offers Check for updates, Update now, and a persistent automatic-install toggle (off by default). The lamp itself needs internet-connected home Wi-Fi. Install updater firmware 1.2.0 manually once to enable this feature; older lamps remain controllable and show an upgrade explanation. Reconnect after the lamp restarts. See ../docs/github-updates.md for release and recovery details.
