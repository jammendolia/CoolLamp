void RainbowWithGlitter()
{
  // built-in FastLED rainbow, plus some random sparkly glitter
  Rainbow();
  addGlitter(80);
}
void addGlitter( fract8 chanceOfGlitter)
{
  if( random8() < chanceOfGlitter) {
    leds[ random16(NUM_LEDS) ] += CRGB::White;
  }
}
