import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeInstallationIdentity, validateInstallationIdentity } from '../src/installation-identity.js';

const descriptor = Object.freeze({
  version: 1,
  installationId: '1'.repeat(32),
  credentialKeyId: '2'.repeat(32),
  credentialGeneration: 1,
  displayName: 'This iPhone',
  publicKeyThumbprint: '3'.repeat(64),
  keyState: 'active'
});

test('the native installation descriptor is strict, detached and contains no private material', () => {
  const value = validateInstallationIdentity({ ...descriptor });
  assert.deepEqual(value, descriptor);
  assert(Object.isFrozen(value));
  for (const bad of [
    { ...descriptor, privateKey: 'secret' },
    { ...descriptor, installationId: '0'.repeat(32) },
    { ...descriptor, credentialKeyId: descriptor.installationId },
    { ...descriptor, credentialGeneration: 2 },
    { ...descriptor, displayName: ' x\n' },
    { ...descriptor, publicKeyThumbprint: 'A'.repeat(64) },
    { ...descriptor, keyState: 'retired' }
  ]) assert.throws(() => validateInstallationIdentity(bad), error => error.code === 'identity-invalid');
});

test('browser and session storage never become a Home installation identity', async () => {
  const identity = new NativeInstallationIdentity({
    isNative: false,
    native: { homeInstallationIdentity: async () => descriptor }
  });
  await assert.rejects(identity.ensure(), error => error.code === 'native-required');
});

test('one native identity request is shared and later reads keep the same descriptor', async () => {
  let calls = 0;
  const identity = new NativeInstallationIdentity({
    isNative: true,
    native: { homeInstallationIdentity: async () => { calls += 1; return { ...descriptor }; } }
  });
  const [first, second] = await Promise.all([identity.ensure(), identity.ensure()]);
  assert.equal(calls, 1);
  assert.equal(first, second);
  assert.equal(await identity.ensure(), first);
  assert.equal(calls, 1);
});

test('locked native storage fails before any Home provider can be contacted', async () => {
  const identity = new NativeInstallationIdentity({
    isNative: true,
    native: { homeInstallationIdentity: async () => { throw Error('keychain locked'); } }
  });
  await assert.rejects(identity.ensure(), error => error.code === 'identity-unavailable' && /Unlock/.test(error.message));
});

test('native recovery and locked errors keep distinct actionable outcomes', async () => {
  const recovery = new NativeInstallationIdentity({ isNative: true, native: { homeInstallationIdentity: async () => { throw Object.assign(Error('native recovery'), { code: 'home-identity-recovery' }); } } });
  await assert.rejects(recovery.ensure(), error => error.code === 'identity-recovery' && /reinstall CoolLamp/.test(error.message));
  const locked = new NativeInstallationIdentity({ isNative: true, native: { homeInstallationIdentity: async () => { throw Object.assign(Error('native locked'), { code: 'home-identity-locked' }); } } });
  await assert.rejects(locked.ensure(), error => error.code === 'identity-locked' && /Unlock/.test(error.message));
});

test('a stopped identity read does not present access', async () => {
  const controller = new AbortController();
  const identity = new NativeInstallationIdentity({ isNative: true, native: { homeInstallationIdentity: async () => descriptor } });
  controller.abort();
  await assert.rejects(identity.ensure({ signal: controller.signal }), error => error.cancelled === true);
});
