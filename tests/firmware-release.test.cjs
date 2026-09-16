const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {manifestFor,parseVersion} = require('../tools/package-firmware.cjs');
function image(version='1.2.0') {
  const b=Buffer.alloc(512); b[0]=0xe9;b.writeUInt16LE(5,12);b.writeUInt32LE(0xabcd5432,32);
  b.write('COOLLAMP-PUBLIC-'+version+'\0',300);return b;
}
test('release manifest binds exact firmware bytes, version, board and partition',()=>{
  const b=image(),lines=manifestFor(b,'1.2.0').trim().split('\n');
  assert.deepEqual(lines.slice(0,5),['COOLLAMP-OTA-1','1.2.0','esp32c3','dual-ota-2031616','512']);
  assert.equal(lines[5],crypto.createHash('sha256').update(b).digest('hex'));
});
test('packaging rejects local, mismatched, oversized, merged and wrong-chip images',()=>{
  assert.throws(()=>manifestFor(image(),'1.2.1'));
  const local=image();local.write('COOLLAMP-LOCAL-',400);assert.throws(()=>manifestFor(local,'1.2.0'));
  for(const [offset,value] of [[0,0],[12,0],[32,0]]){const b=image();b[offset]=value;assert.throws(()=>manifestFor(b,'1.2.0'));}
  assert.throws(()=>manifestFor(Buffer.alloc(2031617),'1.2.0'));
  assert.throws(()=>manifestFor(Buffer.alloc(100),'1.2.0'));
});
test('versions must be canonical bounded stable versions',()=>{
  assert.deepEqual(parseVersion('1.10.3'),[1,10,3]);
  for(const v of ['1.2','01.2.3','1.2.3-beta','65536.0.0','1.2.3\n','1.2.3;echo'])assert.throws(()=>parseVersion(v));
});
