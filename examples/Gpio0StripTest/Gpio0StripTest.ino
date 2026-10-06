// Standalone CoolLamp wiring test. Does not use Wi-Fi, Bluetooth, or an encoder.
#include <FastLED.h>

constexpr uint8_t DATA_PIN = 0;
constexpr uint16_t LED_COUNT = 205;  // Change if the test strip has a different length.
constexpr uint8_t BRIGHTNESS = 32;
constexpr uint32_t BLINK_INTERVAL_MS = 250;
static_assert(LED_COUNT > 0, "The test needs at least one LED.");
CRGB leds[LED_COUNT];

// Refresh during every pause so the end marker blinks throughout all test phases.
void showFor(uint32_t durationMs) {
  const uint32_t started = millis();
  do {
    leds[LED_COUNT - 1] = (millis() / BLINK_INTERVAL_MS) % 2 == 0
                             ? CRGB::White : CRGB::Black;
    FastLED.show();
    delay(5);
  } while (millis() - started < durationMs);
}

void showSolid(const CRGB& color, const char* name) {
  Serial.println(name);
  fill_solid(leds, LED_COUNT, color);
  showFor(2000);
  FastLED.clear();
  showFor(400);
}

void setup() {
  Serial.begin(115200);
  FastLED.addLeds<WS2812B, DATA_PIN, GRB>(leds, LED_COUNT);
  FastLED.setBrightness(BRIGHTNESS);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, 350);
  FastLED.clear();
  showFor(500);
  Serial.printf("CoolLamp GPIO0 strip test: %u LEDs, brightness %u/255\n",
                static_cast<unsigned>(LED_COUNT), static_cast<unsigned>(BRIGHTNESS));
}

void loop() {
  showSolid(CRGB::Red, "RED");
  showSolid(CRGB::Green, "GREEN");
  showSolid(CRGB::Blue, "BLUE");
  Serial.println("WHITE PIXEL: first LED to next-to-last LED; last LED blinks");
  for (uint16_t i = 0; i < LED_COUNT - 1; ++i) {
    FastLED.clear();
    leds[i] = CRGB::White;
    showFor(35);
  }
  FastLED.clear();
  showFor(1000);
}
