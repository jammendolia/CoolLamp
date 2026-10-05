# CoolLamp helix app icon

The app icon uses the same helix path as the Light workspace, with a mint/white glow on a deep blue background. It has no lettering, so the lamp remains recognizable at home-screen size.

[Full-size preview](previews/app-icon.png) · [Home-screen size and Android crop previews](previews/app-icon-sizes.png)

Editable sources:

- `mobile/assets/app-icon.svg`: square master artwork for iOS and Android legacy icons.
- `mobile/assets/app-icon-foreground.svg`: transparent Android adaptive foreground, with the mark centered within its safe region.

Native assets:

- iOS uses the existing `AppIcon.appiconset` reference and a 1024 × 1024 RGB PNG without an alpha channel. Corners remain square in the source; the system masks the installed icon.
- Android has square/round legacy PNGs and transparent adaptive foreground PNGs for mdpi through xxxhdpi. The adaptive background is deep blue. API 33+ also has a separate monochrome helix for themed icons. The older unused template vector drawables have been updated to the helix as well.

`tools/build-app-icons.cjs` renders both editable sources, writes native PNGs and produces the previews. It needs Playwright and Chromium as local tooling; they are not app dependencies. It losslessly removes the iOS PNG's alpha channel and verifies that every source pixel is opaque.

```sh
node tools/build-app-icons.cjs
```

Xcode’s asset compiler successfully compiled the icon catalog for iPhone and iPad. Additional validation checks the iOS dimensions/alpha channel, all 15 Android PNG sizes, XML parsing and adaptive resource references. The icon has been reviewed at 128, 60, 48 and 32 pixels and with an Android circular crop. Android native compilation requires an Android SDK; that SDK is not installed on this Mac.

References: [Apple app-icon asset catalogs](https://developer.apple.com/documentation/xcode/configuring-your-app-icon), [Apple app-icon design](https://developer.apple.com/design/human-interface-guidelines/app-icons/), [Android adaptive icon design](https://developer.android.com/develop/ui/compose/system/icon_design_adaptive).

The native build includes these assets. TestFlight publication uses the existing iOS upload workflow.
