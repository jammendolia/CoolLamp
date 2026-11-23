//FASTLED's built in rainbow function

void Rainbow()
{
  // FastLED's built-in rainbow generator
  fill_rainbow( leds, NUM_LEDS, gHue, 7);
}

// Stable legacy IDs share the family entry while retaining native kernels.
void renderLegacyEffect(uint8_t mode)
{
  switch (mode) {
    case 1: pacifica_loop(); break;
    case 14: Rainbow(); break;
    case 15: RainbowWithGlitter(); break;
    case 16: case 18: case 20: renderLegacyDots(mode); break;
    case 19: Bpm(); break;
  }
}
