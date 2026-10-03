void renderGroupScene(uint32_t now) {
  const auto visual=lampGroupVisual();
  for(uint16_t i=0;i<NUM_LEDS;++i){
    const auto c=LampGroupScenes::pixel(visual,LampGroupScenes::height(i,NUM_LEDS,lampMidpoint),now);
    leds[i]=CRGB(c.r,c.g,c.b);
  }
}
