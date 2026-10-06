# GPIO0 LED strip wiring test

Standalone ESP32-C3 test for the CoolLamp WS2812B strip. Connect GPIO0 to the
strip's DIN, supply the strip with 5 V, and connect strip and ESP32 ground.

The test repeats solid red, green, and blue, then moves a single white pixel
from the first LED to the next-to-last LED. The last configured LED (LED 205)
continuously blinks white: 250 ms on, 250 ms off, including during dark pauses.
It runs without a serial monitor, microphone, encoder, Wi-Fi, or Bluetooth.

The default is 205 LEDs, brightness 32/255, and a FastLED estimated LED power
limit of 350 mA. Change `LED_COUNT` in the sketch for a different strip length.
Pixels beyond this count are not controlled by the test.

Build with the repository's installed Arduino tools:

```sh
.build/tooling/arduino-cli-local compile \
  --fqbn esp32:esp32:esp32c3:CDCOnBoot=cdc,PartitionScheme=no_fs \
  --build-path .build/cache-strip-test \
  --output-dir .build/strip-test \
  examples/Gpio0StripTest
```

Upload to the detected USB serial port with Arduino CLI. This replaces the
application on that board with the wiring test; it does not modify CoolLamp's
production firmware sources.
