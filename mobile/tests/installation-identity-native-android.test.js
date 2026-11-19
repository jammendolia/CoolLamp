import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../android/app/src/main/java/com/coollamp/controller/LampNetworkPlugin.java',import.meta.url),'utf8');
const method=source.slice(source.indexOf('@PluginMethod public void homeInstallationIdentity'),source.indexOf('@PluginMethod public void credential'));

test('Android Home installation identity is stable, opaque and backed by a non-exportable P-256 key',()=>{
 assert.match(method,/KeyStore\.getInstance\("AndroidKeyStore"\)/);
 assert.match(method,/KeyPairGenerator\.getInstance\(KeyProperties\.KEY_ALGORITHM_EC,"AndroidKeyStore"\)/);
 assert.match(method,/new ECGenParameterSpec\("secp256r1"\)/);
 assert.match(method,/KeyProperties\.PURPOSE_SIGN/);
 assert.match(method,/\.setDigests\(KeyProperties\.DIGEST_SHA256\)/);
 assert.match(method,/certificate\.getPublicKey\(\)\.getEncoded\(\)/);
 assert.match(method,/MessageDigest\.getInstance\("SHA-256"\)/);
 assert.doesNotMatch(method,/getKey\(|getPrivateKey\(|privateKey|PKCS8|signHomeProof/);
});

test('Android Home installation identity returns only the approved public descriptor',()=>{
 for(const field of ['version','installationId','credentialKeyId','credentialGeneration','displayName','publicKeyThumbprint','keyState'])
  assert.match(method,new RegExp('(?:put|result\\.put)\\("'+field+'"'));
 assert.match(method,/"This Android phone"/);
 assert.match(method,/"active"/);
 assert.match(source,/randomOpaqueId\(SecureRandom random\)[\s\S]*new byte\[16\]/);
 assert.match(source,/installationId\.equals\(credentialKeyId\)/);
 assert.doesNotMatch(method,/serial|ANDROID_ID|Build\.|bluetooth|macAddress|advertising/i);
});

test('Android Home installation identity treats partial or corrupt state as recovery, never silent rotation',()=>{
 assert.match(method,/hasMetadata!=hasKey/);
 assert.match(method,/if\(hasMetadata\)[\s\S]*new JSONObject\(saved\)/);
 assert.match(method,/if\(hasMetadata\)[\s\S]*return;[\s\S]*KeyPairGenerator/);
 assert.match(source,/verifiedHomeIdentity[\s\S]*metadata\.length\(\)!=7/);
 assert.match(source,/thumbprint\.equals\(lowerHex\(MessageDigest\.getInstance\("SHA-256"\)\.digest\(encoded\)\)\)/);
 assert.match(method,/HOME_IDENTITY_RECOVERY/);
 assert.match(method,/home-identity-recovery/);
 assert.match(method,/home-identity-unavailable/);
 assert.doesNotMatch(method,/deleteEntry|preferences\.edit\(\)\.clear|remove\(HOME_IDENTITY_RECORD\)/);
});
