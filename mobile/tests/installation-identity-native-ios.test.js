import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../ios/App/App/LampNetworkPlugin.swift',import.meta.url),'utf8');

test('iOS exposes only stable public Home installation identity metadata',()=>{
 assert.match(source,/CAPPluginMethod\(name: "homeInstallationIdentity"/);
 assert.match(source,/@objc func homeInstallationIdentity\(_ call: CAPPluginCall\)/);
 for(const field of ['version','installationId','credentialKeyId','credentialGeneration','displayName','publicKeyThumbprint','keyState'])assert.match(source,new RegExp('"'+field+'"'));
 assert.match(source,/"This iPhone"/);assert.match(source,/"This iPad"/);
 assert.doesNotMatch(source,/homeInstallation(?:Sign|Proof)|signHomeInstallation|privateKeyData/);
});

test('iOS keeps the P-256 private key non-exportable and device-only',()=>{
 assert.match(source,/import CryptoKit/);
 assert.match(source,/kSecAttrKeyTypeECSECPrimeRandom/);
 assert.match(source,/kSecAttrKeySizeInBits as String: 256/);
 assert.match(source,/kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave/);
 assert.match(source,/kSecAttrAccessibleWhenUnlockedThisDeviceOnly, \[\.privateKeyUsage\]/);
 assert.match(source,/SecKeyCopyExternalRepresentation\(publicKey,/);
 assert.doesNotMatch(source,/SecKeyCopyExternalRepresentation\(privateKey,/);
 assert.match(source,/0x30, 0x59, 0x30, 0x13/);
 assert.match(source,/SHA256\.hash\(data: p256SubjectPublicKeyInfoHeader \+ point\)/);
});

test('iOS fresh-install and corruption handling never silently resurrect or rotate identity',()=>{
 assert.match(source,/UserDefaults\.standard/);
 assert.match(source,/let marker = defaults\.object\(forKey: homeIdentityFreshInstallMarker\)/);
 assert.match(source,/if marker == nil \{\s*try deleteHomeIdentityArtifacts\(\)/);
 assert.match(source,/defaults\.set\(true, forKey: homeIdentityFreshInstallMarker\)/);
 assert.match(source,/guard defaults\.bool\(forKey: homeIdentityFreshInstallMarker\) else \{\s*throw HomeInstallationIdentityFailure\.recovery/);
 assert.match(source,/return try readVerifiedHomeIdentity\(\)/);
 assert.match(source,/guard status == errSecSuccess, let data = item as\? Data, data\.count <= 2048 else \{\s*throw HomeInstallationIdentityFailure\.recovery/);
 assert.match(source,/guard status == errSecSuccess, item != nil else \{\s*throw HomeInstallationIdentityFailure\.recovery/);
});

test('iOS public identifiers are random distinct nonzero 128-bit values',()=>{
 assert.match(source,/SecRandomCopyBytes\(kSecRandomDefault, bytes\.count, &bytes\)/);
 assert.match(source,/count: 16/);
 assert.match(source,/value != String\(repeating: "0", count: 32\), value != excluding/);
 assert.match(source,/randomOpaqueId\(excluding: installationId\)/);
 assert.match(source,/value\.installationId != value\.credentialKeyId/);
 assert.match(source,/validLowerHex\(value\.publicKeyThumbprint, count: 64\)/);
});

test('iOS reports locked, recovery, and unavailable identity outcomes distinctly',()=>{
 assert.match(source,/home-identity-locked/);
 assert.match(source,/home-identity-recovery/);
 assert.match(source,/home-identity-unavailable/);
});
