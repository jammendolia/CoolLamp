# Adjustable effect center

In the phone app, connect over Wi-Fi and open **Settings → Wi-Fi & advanced settings → Effect center**. The lamp's web page exposes the same setting.

**Center after LED** counts from the strip's data-input end, starting at 1. On a 134-LED strip, 40 places the boundary between LEDs 40 and 41, giving sides of 40 and 94 LEDs. Valid custom boundaries are 1 through LED count minus 1. **0 selects automatic**, preserving the previous midpoint behavior. A one-LED strip only supports automatic.

Saving applies immediately and persists through restart. Save strip-length changes before changing the center. If the strip is shortened below a saved center, rendering limits it to the last valid boundary; the stored preference remains available if the strip is lengthened again.

The setting controls split fire (including reversed direction/colors and alternate palettes), rain, comet collision, both bouncing-droplet directions, heartbeat, and Sound meter. Each side scales independently. Color selection using the knob samples the configured center. Other effects keep their existing spatial layout; Sound glow still illuminates the whole strip.

The original settings blob and all GPIO assignments remain unchanged. A separate three-byte `geometryV1` preference stores a format version and little-endian center boundary. Missing or invalid data defaults to automatic. The app hides this control on older firmware.

`GET /api/state` includes `midpoint` (saved preference) and `effectiveMidpoint` (current first-side length). Authenticated, token-protected `POST /api/geometry` accepts `midpoint=0..ledCount-1`, saves it, and applies it without restarting. Requests are rejected during firmware updates.

Validation includes persistence and failed writes, boundary checks, exact automatic-coordinate compatibility, and actual effect loops with uneven splits, single-LED, odd/even, and 1024-LED strips under address/undefined-behavior sanitizers. App tests verify authentication, invalid inputs, automatic reset, and older firmware behavior.
