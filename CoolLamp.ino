/// @file CoolLamp.ino
/// @brief LED effects for an ESP32-C3 lamp with a rotary encoder.

#define FASTLED_ALLOW_INTERRUPTS 0
#include <ESP32RotaryEncoder.h>
#include <FastLED.h>
#include "LampConfig.h"

// ESP32-C3 Mini wiring.
#define DATA_PIN 0
const uint8_t DI_ENCODER_A = 4;
const uint8_t DI_ENCODER_B = 3;
const int8_t DI_ENCODER_SW = 2;
const int8_t DO_ENCODER_VCC = 1;
RotaryEncoder rotaryEncoder(DI_ENCODER_A, DI_ENCODER_B, DI_ENCODER_SW, DO_ENCODER_VCC);

// Active strip length is loaded from settings before FastLED is initialized.
uint16_t activeLedCount = DEFAULT_LED_COUNT;
#define NUM_LEDS activeLedCount
#define MAX_POWER_MILLIAMPS 500
#define LED_TYPE WS2812B
#define COLOR_ORDER GRB
#define FRAMES_PER_SECOND 60

#define MODE_PACIFICA 1
#define MODE_AURORA 2
#define MODE_RAIN 3
#define MODE_FIRE 4
#define MODE_FIRESPLIT 5
#define MODE_FIRESPLIT_REVERSE 6
#define MODE_FIRESPLIT_REVERSE_COLORS 7
#define MODE_FIRE_BLUE 8
#define MODE_FIRE_GREEN 9
#define MODE_FIRE_PURPLE 10
#define MODE_EMBERS 11
#define MODE_LAVA 12
#define MODE_PLASMA 13
#define MODE_RAINBOW 14
#define MODE_RAINBOW_GLITTER 15
#define MODE_CONFETTI 16
#define MODE_COMET_COLLISION 17
#define MODE_SINELON 18
#define MODE_BPM 19
#define MODE_JUGGLE 20
#define MODE_WHITE 21
#define MODE_RED 22
#define MODE_GREEN 23
#define MODE_BLUE 24
#define MODE_PURPLE 25
#define MODE_PINK 26
#define MODE_YELLOW 27
#define MODE_CYAN 28
#define MODE_MAX MODE_CYAN

CRGB leds[MAX_LED_COUNT];
uint8_t Mode = MODE_FIRE;
uint8_t Brightness = 100;
uint8_t gHue = 0;
bool PowerOn = true;

void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0); // USB diagnostic replies must never stall rendering.
  delay(3000); // Allow time for boot recovery before driving the strip.

  loadLampSettings();
  activeLedCount = lampSettings.ledCount;
  Brightness = lampSettings.brightness;
  Mode = lampSettings.startupMode;

  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS)
      .setCorrection(TypicalLEDStrip);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, lampSettings.milliAmps);
  FastLED.setBrightness(Brightness);

  rotaryEncoder.setEncoderType(EncoderType::HAS_PULLUP);
  rotaryEncoder.setBoundaries(1, MODE_MAX, true);
  // Poll events in loop() instead of changing lamp state from a timer task.
  rotaryEncoder.begin(false);
  rotaryEncoder.setEncoderValue(Mode);
  beginLampNetwork();
}

void loop() {
  serviceLampNetwork();
  if (lampIsUpdating()) { delay(1); return; }
  bool renderNow = false;
  if (rotaryEncoder.encoderChanged()) {
    const uint8_t nextMode = static_cast<uint8_t>(rotaryEncoder.getEncoderValue());
    if (nextMode != Mode) {
      Mode = nextMode;
      fill_solid(leds, NUM_LEDS, CRGB::Black);
      renderNow = true;
    }
  }

  if (pollLampButton()) {
    PowerOn = !PowerOn;
    FastLED.setBrightness(PowerOn ? Brightness : 0);
    if (PowerOn) {
      renderNow = true;
    } else {
      FastLED.show(); // Transmit the power-off change immediately.
    }
  }

  // No serial writes here: USB backpressure must never delay lamp controls.
  // Keep input polling responsive between frames, including while off.
  static uint32_t lastFrameMs = 0;
  const uint32_t now = millis();
  if (lampSetupPulse()) {
    FastLED.setBrightness(Brightness);
    fill_solid(leds, NUM_LEDS, CRGB::Teal);
    FastLED.show();
    delay(1);
    return;
  }
  FastLED.setBrightness(PowerOn ? Brightness : 0);
  if (!PowerOn) FastLED.show();
  if (!PowerOn || (!renderNow && now - lastFrameMs < 1000 / FRAMES_PER_SECOND)) {
    delay(1);
    return;
  }
  lastFrameMs = now;

  switch (Mode) {
    case MODE_AURORA: Aurora(); break;
    case MODE_RAIN: Rain(); break;
    case MODE_EMBERS: Embers(); break;
    case MODE_LAVA: Lava(); break;
    case MODE_PLASMA: Plasma(); break;
    case MODE_COMET_COLLISION: CometCollision(); break;
    case MODE_FIRE_BLUE: FireSplit(false, false, 1); break;
    case MODE_FIRE_GREEN: FireSplit(false, false, 2); break;
    case MODE_FIRE_PURPLE: FireSplit(false, false, 3); break;

    case MODE_PACIFICA:
      pacifica_loop();
      break;

    case MODE_FIRE:
      Fire2012();
      break;

    case MODE_FIRESPLIT:
      FireSplit(false, false, 0);
      break;

    case MODE_FIRESPLIT_REVERSE:
      FireSplit(true, false, 0);
      break;

    case MODE_FIRESPLIT_REVERSE_COLORS:
      FireSplit(false, true, 0);
      break;

    case MODE_WHITE:
      White();
      break;

    case MODE_RED:
      Red();
      break;
    case MODE_GREEN:
      Green();
    break;
    case MODE_BLUE:
      Blue();
    break;
    case MODE_PURPLE:
      Purple();
    break;
    case MODE_PINK:
      Pink();
    break;
    case MODE_YELLOW:
      Yellow();
    break;
    case MODE_CYAN:
      Cyan();
    break;

    case MODE_RAINBOW:
      Rainbow();
      break;

    case MODE_RAINBOW_GLITTER:
      RainbowWithGlitter();
      break;

    case MODE_CONFETTI:
      Confetti();
      break;

    case MODE_SINELON:
      Sinelon();
      break;

    case MODE_BPM:
      Bpm();
      break;

    case MODE_JUGGLE:
      Juggle();
      break;


  }
  EVERY_N_MILLISECONDS(20) { gHue++; }
  FastLED.show();
}
