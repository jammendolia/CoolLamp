const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const destination = path.resolve(__dirname, '..', 'LampSecrets.h');
if (fs.existsSync(destination)) {
  console.log('LampSecrets.h already exists; it was left unchanged.');
} else {
  const password = crypto.randomBytes(12).toString('hex');
  fs.writeFileSync(destination, '#pragma once\n// Private initial hotspot and web password. Do not commit this file.\n#define DEFAULT_ADMIN_PASSWORD "' + password + '"\n', {flag:'wx'});
  console.log('Created LampSecrets.h with a unique initial password. Read that file when setting up your lamp.');
}
