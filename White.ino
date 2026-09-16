// Simply set the LEDs to white

void White() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 255;
    leds[i].g = 255;
    leds[i].b = 255;
  }
}

void Red() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 255;
    leds[i].g = 0;
    leds[i].b = 0;
  }
};

void Green() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 0;
    leds[i].g = 255;
    leds[i].b = 0;
  }
};

void Blue() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 0;
    leds[i].g = 0;
    leds[i].b = 255;
  }
};

void Purple() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 144;
    leds[i].g = 0;
    leds[i].b = 255;
  }
};

void Pink() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 255;
    leds[i].g = 35;
    leds[i].b = 85;
  }
};

void Yellow() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 255;
    leds[i].g = 255;
    leds[i].b = 0;
  }
};

void Cyan() {
  for (int i = 0; i < NUM_LEDS; i++) {
    leds[i].r = 0;
    leds[i].g = 255;
    leds[i].b = 255;
  }
};
