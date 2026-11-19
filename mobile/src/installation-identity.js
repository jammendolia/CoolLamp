const OPAQUE_ID = /^(?!0{32}$)[a-f0-9]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const encoder = new TextEncoder();

function failure(message, code) {
  return Object.assign(Error(message), { code, identityFailure: true });
}

function plainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactFields(value, fields) {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw failure('This phone returned an invalid access identity.', 'identity-invalid');
  }
}

function boundedText(value) {
  return typeof value === 'string' && value === value.trim() && value.length > 0 &&
    encoder.encode(value).length <= 64 && !/[\u0000-\u001f\u007f]/.test(value);
}

function frozenCopy(value) {
  return Object.freeze({ ...value });
}

export function validateInstallationIdentity(raw) {
  if (!plainRecord(raw)) throw failure('This phone returned an invalid access identity.', 'identity-invalid');
  exactFields(raw, [
    'version', 'installationId', 'credentialKeyId', 'credentialGeneration',
    'displayName', 'publicKeyThumbprint', 'keyState'
  ]);
  if (raw.version !== 1 || !OPAQUE_ID.test(raw.installationId) ||
      !OPAQUE_ID.test(raw.credentialKeyId) || raw.installationId === raw.credentialKeyId ||
      raw.credentialGeneration !== 1 || !boundedText(raw.displayName) ||
      !DIGEST.test(raw.publicKeyThumbprint) || raw.keyState !== 'active') {
    throw failure('This phone returned an invalid access identity.', 'identity-invalid');
  }
  return frozenCopy(raw);
}

export class NativeInstallationIdentity {
  constructor({ native, isNative = false } = {}) {
    this.native = native;
    this.isNative = isNative === true;
    this.current = null;
    this.inFlight = null;
  }

  async ensure({ signal } = {}) {
    if (signal?.aborted) throw Object.assign(Error('Access check stopped.'), { cancelled: true });
    if (!this.isNative || typeof this.native?.homeInstallationIdentity !== 'function') {
      throw failure('Open CoolLamp on your phone to manage access.', 'native-required');
    }
    if (this.current) return this.current;
    if (!this.inFlight) {
      this.inFlight = Promise.resolve()
        .then(() => this.native.homeInstallationIdentity())
        .then(validateInstallationIdentity)
        .then(identity => {
          if (this.current && (this.current.installationId !== identity.installationId ||
              this.current.publicKeyThumbprint !== identity.publicKeyThumbprint ||
              this.current.credentialKeyId !== identity.credentialKeyId ||
              this.current.credentialGeneration !== identity.credentialGeneration)) {
            throw failure('This phone needs to be added again. Remove and reinstall CoolLamp, then ask a Home owner to invite this phone again.', 'identity-recovery');
          }
          this.current = identity;
          return identity;
        })
        .catch(error => {
          if (error?.identityFailure || error?.cancelled) throw error;
          if (error?.code === 'home-identity-recovery') {
            throw failure('This phone needs to be added again. Remove and reinstall CoolLamp, then ask a Home owner to invite this phone again.', 'identity-recovery');
          }
          if (error?.code === 'home-identity-locked') {
            throw failure('Unlock your phone, then try again.', 'identity-locked');
          }
          throw failure('This phone’s saved access could not be opened. Unlock your phone and try again.', 'identity-unavailable');
        })
        .finally(() => { this.inFlight = null; });
    }
    const identity = await this.inFlight;
    if (signal?.aborted) throw Object.assign(Error('Access check stopped.'), { cancelled: true });
    return identity;
  }
}
