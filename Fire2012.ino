// Fire2012 by Mark Kriegsman, July 2012
#include "LampFireEffects.h"
// as part of "Five Elements" shown here: http://youtu.be/knWiGsmgycY
////
// This basic one-dimensional 'fire' simulation works roughly as follows:
// There's a underlying array of 'heat' cells, that model the temperature
// at each point along the line.  Every cycle through the simulation,
// four steps are performed:
//  1) All cells cool down a little bit, losing heat to the air
//  2) The heat from each cell drifts 'up' and diffuses a little
//  3) Sometimes randomly new 'sparks' of heat are added at the bottom
//  4) The heat from each cell is rendered as a color into the leds array
//     The heat-to-color mapping uses a black-body radiation approximation.
//
// Temperature is in arbitrary units from 0 (cold black) to 255 (white hot).
//
// This simulation scales it self a bit depending on NUM_LEDS; it should look
// "OK" on anywhere from 20 to 100 LEDs without too much tweaking.
//
// I recommend running this simulation at anywhere from 30-100 frames per second,
// meaning an interframe delay of about 10-35 milliseconds.
//
// Looks best on a high-density LED setup (60+ pixels/meter).
//
//
// There are two main parameters you can play with to control the look and
// feel of your fire: COOLING (used in step 1 above), and SPARKING (used
// in step 3 above).
//
// COOLING: How much does the air cool as it rises?
// Less cooling = taller flames.  More cooling = shorter flames.
// Default 50, suggested range 20-100
#define COOLING  55

// SPARKING: What chance (out of 255) is there that a new spark will be lit?
// Higher chance = more roaring fire.  Lower chance = more flickery fire.
// Default 120, suggested range 50-200.
#define SPARKING 120

bool gReverseDirection = false;
void Fire2012()
{
  updateFireHeat(fireHeat, NUM_LEDS, COOLING, SPARKING);
  drawFireLane(fireHeat, NUM_LEDS, gReverseDirection ? NUM_LEDS - 1 : 0,
               gReverseDirection ? -1 : 1, false, 0);
}

void renderFireEffect(uint8_t mode) {
  struct Recipe { uint8_t flags, palette; };
  // Flags: bit0 reverses travel; bit1 reverses the ordinary heat palette.
  // Plain Fire owns its separate whole-strip history and direction setting.
  static constexpr Recipe recipes[] = {
    {0,0}, {0,0}, {1,0}, {2,0}, {0,1}, {0,2}, {0,3}
  };
  static_assert(MODE_FIRE == 4 && MODE_FIRE_PURPLE == 10 &&
    sizeof(recipes) == 2 * (MODE_FIRE_PURPLE - MODE_FIRE + 1),
    "Keep fire recipes aligned with unchanged effect IDs");
  if (mode < MODE_FIRE || mode > MODE_FIRE_PURPLE) return;
  if (mode == MODE_FIRE) { Fire2012(); return; }
  const auto& recipe = recipes[mode - MODE_FIRE];
  FireSplit(recipe.flags & 1, recipe.flags & 2, recipe.palette);
}
