const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const words = ('acorn anchor apple apron arrow attic badge bamboo basket beach beacon berry blanket boat bottle bridge broom bucket button cactus candle canyon carpet castle cedar cherry cloud clover coast copper coral cotton crane creek crown daisy desert drum eagle feather fern field flute forest fountain fox garden gate globe grape grass guitar harbor hat hazel hill honey horse island jacket jar jewel kettle kite ladder lake lantern leaf lemon lion maple marble meadow melon mirror moon moss mountain mouse ocean olive orange otter owl panda peach pebble pencil pepper piano pillow pine planet plum pocket pond rabbit rain raven ribbon river robin rocket rope sail salmon sand scarf shell silver sky snow sock sparrow spoon spring squirrel star stone storm sunset table tiger toast tower train tree tulip turtle valley velvet violet walnut water whale wheat willow window winter wolf zebra').split(' ');
function generatePassword() {
  const chosen = new Set();
  while (chosen.size < 4) chosen.add(words[crypto.randomInt(words.length)]);
  return [...chosen].join('-');
}
function setupSecrets(destination) {
  if (fs.existsSync(destination)) return false;
  fs.writeFileSync(destination, '#pragma once\n// Private initial hotspot and web password. Do not commit this file.\n#define DEFAULT_ADMIN_PASSWORD "' + generatePassword() + '"\n', {flag:'wx'});
  return true;
}
if (require.main === module) {
  const created = setupSecrets(path.resolve(__dirname, '..', 'LampSecrets.h'));
  console.log(created ? 'Created LampSecrets.h with a random four-word initial password. Read that file when setting up your lamp.' : 'LampSecrets.h already exists; it was left unchanged.');
}
module.exports = {generatePassword, setupSecrets};
