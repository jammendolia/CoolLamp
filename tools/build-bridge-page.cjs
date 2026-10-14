// Regenerate only the inline owner-page script; never install dependencies.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'bridge', 'BridgePage.js');
const headerPath = path.join(root, 'bridge', 'BridgePage.h');
const options = Object.freeze({ minify: true, target: 'es2022', format: 'iife', legalComments: 'none' });

function main() {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some(argument => argument !== '--check'))
    throw new Error('Usage: node tools/build-bridge-page.cjs [--check]');
  const checking = args.includes('--check');
  let esbuild;
  try {
    esbuild = require(path.join(root, 'mobile', 'node_modules', 'esbuild'));
  } catch {
    throw new Error('The installed mobile esbuild dependency is required; this tool never installs or downloads it.');
  }
  if (esbuild.version !== '0.28.2')
    throw new Error('Owner-page generation requires installed esbuild 0.28.2 to preserve deterministic output.');
  const readable = fs.readFileSync(sourcePath, 'utf8');
  const header = fs.readFileSync(headerPath, 'utf8');
  const scripts = [...header.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error('BridgePage.h must contain exactly one inline script.');
  const current = scripts[0];
  const script = esbuild.transformSync(readable, options).code;
  const replacement = '<script>\n' + script + '</script>';
  const generated = header.slice(0, current.index) + replacement + header.slice(current.index + current[0].length);
  const page = generated.match(/R"BRIDGEPAGE\(([\s\S]*?)\)BRIDGEPAGE"/);
  if (!page) throw new Error('BridgePage.h is missing its owner-page raw string.');
  const bytes = Buffer.byteLength(page[1], 'utf8') + 1;
  if (bytes > 32768) throw new Error('Generated owner page exceeds its 32 KiB flash bound.');
  if (checking) {
    if (current[1].trim() !== script.trim())
      throw new Error('BridgePage.h script differs from BridgePage.js; regenerate with node tools/build-bridge-page.cjs.');
    console.log(`PASS bridge page source check: ${bytes} flash bytes including NUL, esbuild ${esbuild.version}.`);
    return;
  }
  if (generated !== header) fs.writeFileSync(headerPath, generated, 'utf8');
  console.log(`Generated bridge owner page: ${bytes} flash bytes including NUL, esbuild ${esbuild.version}.`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
