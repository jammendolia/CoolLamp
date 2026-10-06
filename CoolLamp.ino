/// @file CoolLamp.ino
/// @brief LED effects for an ESP32-C3 lamp with a rotary encoder.

#define FASTLED_ALLOW_INTERRUPTS 0
#include <ESP32RotaryEncoder.h>
#include <FastLED.h>
#include "LampConfig.h"
#include "LampGeometry.h"
#include "LampControl.h"
#include "LampPlayback.h"
#include "LampSync.h"
#include "LampGroupScenes.h"
#include "LampBluetooth.h"
#include "LampUpdate.h"
#include "LampGestures.h"
#include "LampAudio.h"
#include "LampFactoryReset.h"
#include "LampVu.h"
#include "LampFountain.h"
#include "AudioAnalysis.h"
#include <new>
SET_LOOP_TASK_STACK_SIZE(4096);

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
#define MODE_CUSTOM 29
#define MODE_DROPLETS 30
#define MODE_LIGHTNING 31
#define MODE_TIDE 32
#define MODE_FIREFLIES 33
#define MODE_HEARTBEAT 34
#define MODE_STARS 35
#define MODE_BREATHING 36
#define MODE_BLOBS 37
#define MODE_DROPLETS_OUTWARD 38
#define MODE_SOUND_GLOW 39
#define MODE_SOUND_METER 40
#define MODE_SPECTRUM_RISE 41
#define MODE_BASS_LAUNCH 42
#define MODE_SPECTRAL_EMBERS 43
#define MODE_BEAT_BLOOM 44
#define MODE_BAND_FOUNTAIN 45
#define MODE_VU_METER 46
#define MODE_RAINBOW_EMBERS 47
#define MODE_MAX MODE_RAINBOW_EMBERS
static_assert(LAMP_AUDIO_SCK > 4 && LAMP_AUDIO_WS > 4 && LAMP_AUDIO_SD > 4, "Preserve prototype GPIO0–4");
uint32_t effectClockMs = 0;
uint16_t lampBeat16(uint16_t bpm, uint32_t base = 0);
uint8_t lampBeat8(uint16_t bpm, uint32_t base = 0);
uint16_t lampBeatSin16(uint16_t bpm, uint16_t low, uint16_t high, uint32_t base = 0, uint16_t phase = 0);
uint8_t lampBeatSin8(uint16_t bpm, uint8_t low, uint8_t high, uint32_t base = 0, uint8_t phase = 0);
uint16_t lampBeatSin88(uint16_t bpm, uint16_t low, uint16_t high, uint32_t base = 0, uint16_t phase = 0);

CRGB* leds = nullptr;
CRGB* originalFrame = nullptr;
CRGB emergencyFrames[2];
uint8_t* fireHeat = nullptr;
uint8_t* splitHeat = nullptr;
uint8_t emergencyHeat[2];
uint8_t Mode = MODE_FIRE;
uint8_t Brightness = 100;
uint8_t gHue = 0;
bool PowerOn = true;
uint32_t lampRenderedFrames = 0, lampMaxRenderUs = 0;

void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0); // USB diagnostic replies must never stall rendering.
  delay(3000); // Allow time for boot recovery before driving the strip.

  if(!recoverLampFactoryReset()) {
    Serial.println("Factory reset recovery could not save settings; retrying.");
    delay(2000);ESP.restart();return;
  }

  beginLampAudio();
  loadLampSettings();
  loadLampGeometry();
  loadLampRotation();
  loadLampColors();
  loadLampVuColors();
  loadLampFountainColors();
  beginLampSync();
  activeLedCount = lampSettings.ledCount;
  // Reserve only the configured strip length; leave RAM for Wi-Fi TLS buffers.
  leds = new (std::nothrow) CRGB[2 * NUM_LEDS]{};
  if (!leds) { activeLedCount = 1; leds = emergencyFrames; }
  originalFrame = leds + NUM_LEDS;
  fireHeat = new (std::nothrow) uint8_t[2 * NUM_LEDS]{};
  if (!fireHeat) { activeLedCount = 1; fireHeat = emergencyHeat; }
  splitHeat = fireHeat + NUM_LEDS;
  splitHeat[0] = 200;
  if (NUM_LEDS > 1) splitHeat[lampSplitCount(NUM_LEDS, lampMidpoint)] = 200;
  Brightness = lampSettings.brightness;
  Mode = lampSettings.startupMode <= lampAvailableEffectCount() ? lampSettings.startupMode : MODE_FIRE;

  FastLED.addLeds<LED_TYPE, DATA_PIN, COLOR_ORDER>(leds, NUM_LEDS)
      .setCorrection(TypicalLEDStrip);
  FastLED.setMaxPowerInVoltsAndMilliamps(5, lampSettings.milliAmps);
  FastLED.setBrightness(Brightness);

  // HW-040 biases A/B; bias the switch internally even when its R1 is unpopulated.
  rotaryEncoder.setEncoderType(EncoderType::SW_FLOAT);
  rotaryEncoder.setBoundaries(1, lampAvailableEffectCount(), true);
  // Poll events in loop() instead of changing lamp state from a timer task.
  rotaryEncoder.begin(false);
  rotaryEncoder.setEncoderValue(Mode);
  beginLampUpdater();
  beginLampNetwork();
}

void loop() {
  serviceLampNetwork();
  serviceLampBluetooth();
  serviceLampUpdater();
  serviceLampFactoryReset();
  serviceLampRotation();
  const uint8_t groupScene=lampGroupScene();
  const bool needsAudio=groupScene?(groupScene==2||LampSyncWire::sceneNeedsAudio(groupScene)):Mode>LAMP_BASE_EFFECT_COUNT;
  serviceLampAudio(PowerOn && needsAudio && !lampSyncFollowing(), lampUpdateOwnsResources() || lampSyncFollowing() || lampFactoryResetPending());
  bool renderNow = serviceLampKnob();
  if (renderLampCalibration()) return;
  if (lampIsUpdating()) { delay(1); return; }

  // No serial writes here: USB backpressure must never delay lamp controls.
  // Keep input polling responsive between frames, including while off.
  static uint32_t lastFrameMs = 0;
  const uint32_t now = millis();
  static bool wasPairing = false;
  static bool pairingFlashOn = false;
  const bool pairingNow = lampPairingOpen();
  const bool setupNow = lampSetupPulse();
  const bool identifying = lampIdentifyActive();
  static bool lastPairing = false;
  static bool lastFactory = false;
  const bool factoryNow=lampFactoryResetArmed()||lampFactoryResetPending();
  if (pairingNow || setupNow || identifying || lampFactoryResetArmed() || lampFactoryResetPending()) {
    const bool flashOn = (now / 400) % 2 == 0;
    if (!wasPairing || flashOn != pairingFlashOn || pairingNow != lastPairing || factoryNow != lastFactory) {
      pairingFlashOn = flashOn;
      FastLED.setBrightness(100);
      fill_solid(leds, NUM_LEDS, flashOn ? (lampFactoryResetArmed() || lampFactoryResetPending() ? CRGB(255,0,0) : pairingNow ? CRGB(0, 0, 255) : setupNow ? CRGB(255, 80, 0) : CRGB::White) : CRGB::Black);
      FastLED.show();
    }
    wasPairing = true;
    lastPairing = pairingNow;
    lastFactory = factoryNow;
    delay(1);
    return;
  }
  if (wasPairing) {
    wasPairing = false;
    fill_solid(leds, NUM_LEDS, CRGB::Black);
    renderNow = true;
  }
  FastLED.setBrightness(PowerOn ? Brightness : 0);
  if (!PowerOn) FastLED.show();
  if (!PowerOn || (!renderNow && now - lastFrameMs < 1000 / FRAMES_PER_SECOND)) {
    delay(1);
    return;
  }
  lastFrameMs = now;
  const uint32_t renderStarted = micros();

  static uint32_t effectBudget = 0, lastEffectTick = 0;
  const auto options = getLampEffectOptions(Mode);
  const uint32_t rate = options.speed <= 50 ? 32 + uint32_t(options.speed) * 224 / 50 : 256 + uint32_t(options.speed - 50) * 768 / 50;
  effectBudget = min(effectBudget + min(uint32_t(now - lastEffectTick), uint32_t(64)) * rate, uint32_t(16384));
  lastEffectTick = now;
  unsigned steps = min(effectBudget / 4096, uint32_t(4));
  effectBudget -= steps * 4096;
  if (renderNow && steps == 0) steps = 1;
  if (lampGroupScene() || Mode > LAMP_BASE_EFFECT_COUNT) steps = 1; // Audio follows real time, independently of speed.
  if (lampSyncFollowing()) {
    const uint32_t target = lampSyncEffectClock(effectClockMs) & ~uint32_t(15);
    const int32_t distance = int32_t(target - effectClockMs);
    steps = Mode > LAMP_BASE_EFFECT_COUNT ? 1 : distance > 0 ? min(uint32_t(distance) / 16, uint32_t(4)) : 0;
    if (distance < 0 || distance > 64 || Mode > LAMP_BASE_EFFECT_COUNT) { steps = 1; effectClockMs = target - 16; }
  }
  if(lampGroupScene())steps=1; // Group scenes use their own shared real-time clock.
  static uint8_t previousGroupScene=0;
  if(previousGroupScene!=lampGroupScene()){fill_solid(leds,NUM_LEDS,CRGB::Black);previousGroupScene=lampGroupScene();}
  for (unsigned step = 0; step < steps; ++step) {
  effectClockMs += 16;
  if(lampGroupScene()) { renderGroupScene(lampSyncRenderTime(now)); continue; }
  switch (Mode) {
    case MODE_SPECTRUM_RISE: case MODE_BASS_LAUNCH: case MODE_SPECTRAL_EMBERS: case MODE_BEAT_BLOOM: case MODE_BAND_FOUNTAIN:
    case MODE_VU_METER: case MODE_RAINBOW_EMBERS:
    case MODE_SOUND_GLOW: case MODE_SOUND_METER:
      renderAudioEffect(Mode, lampSyncRenderTime(now)); break;
    case MODE_DROPLETS: case MODE_DROPLETS_OUTWARD: case MODE_LIGHTNING: case MODE_TIDE: case MODE_FIREFLIES:
    case MODE_HEARTBEAT: case MODE_STARS: case MODE_BREATHING: case MODE_BLOBS:
      renderNewEffect(Mode, effectClockMs); break;
    case MODE_CUSTOM: fill_solid(leds, NUM_LEDS, CRGB::White); break;
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
  gHue = effectClockMs / 20;
  }
  const auto color = getLampColor(Mode);
  // Preserve the original frame for effects that fade or accumulate past pixels.
  const bool transform = !lampGroupScene() && Mode < 30 && color.enabled;
  ::memcpy(originalFrame, leds, NUM_LEDS * sizeof(CRGB));
  uint8_t frameBrightness=PowerOn?Brightness:0;
  if(!lampGroupScene() && Mode==MODE_SOUND_GLOW) {
    // Reserve the power for a full glow first. Limiting the already-modulated
    // frame can cancel changes in audio amplitude across the whole strip.
    soundGlowPalette(leds);
    frameBrightness=calculate_max_brightness_for_power_mW(frameBrightness,uint32_t(lampSettings.milliAmps)*5);
    ::memcpy(leds,originalFrame,NUM_LEDS*sizeof(CRGB));
  }
  if (transform) {
    for (int i = 0; i < NUM_LEDS; ++i) {
      // Hue-only rainbows become moving intensity bands with a single color.
      const uint8_t level = (Mode == MODE_RAINBOW || Mode == MODE_RAINBOW_GLITTER) ?
        leds[i].getLuma() : max(leds[i].r, max(leds[i].g, leds[i].b));
      const CRGB tint = options.dual ? blend(CRGB(color.r,color.g,color.b), CRGB(options.r,options.g,options.b), NUM_LEDS > 1 ? uint32_t(i)*255/(NUM_LEDS-1) : 128) : CRGB(color.r,color.g,color.b);
      leds[i] = CRGB(uint16_t(tint.r) * level / 255, uint16_t(tint.g) * level / 255, uint16_t(tint.b) * level / 255);
    }
  }
  if (!lampGroupScene() && options.intensity < 100) for (int i=0;i<NUM_LEDS;++i) leds[i].nscale8(uint16_t(options.intensity)*255/100);
  FastLED.show(frameBrightness);
  ::memcpy(leds, originalFrame, NUM_LEDS * sizeof(CRGB));
  ++lampRenderedFrames;
  lampMaxRenderUs = max(lampMaxRenderUs, uint32_t(micros() - renderStarted));
}
