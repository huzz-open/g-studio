import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { uvExecutables, installUv } from '../scripts/generation/uv-download.mjs';
import { platformInfo } from '../scripts/generation/paths.mjs';

function wheel(name, content) {
  const filename = Buffer.from(name), data = Buffer.from(content);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length,18); local.writeUInt32LE(data.length,22); local.writeUInt16LE(filename.length,26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(data.length,20); central.writeUInt32LE(data.length,24); central.writeUInt16LE(filename.length,28);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10); end.writeUInt32LE(central.length+filename.length,12); end.writeUInt32LE(local.length+filename.length+data.length,16);
  return Buffer.concat([local,filename,data,central,filename,end]);
}
test('wheel extraction accepts only the exact native executable path', () => {
  const entries = uvExecutables(wheel('uv-0.9.7.data/scripts/uv.exe','native fixture'),true);
  assert.equal(entries.get('uv.exe').toString(),'native fixture');
  assert.throws(()=>uvExecutables(wheel('../../uv.exe','untrusted'),true),/missing/);
  assert.throws(()=>uvExecutables(Buffer.from('invalid'),true),/Invalid/);
  assert.equal(uvExecutables(wheel('uv-0.9.7.data/scripts/uv','unix fixture'),false).get('uv').toString(),'unix fixture');
});
test('mirror failure falls back to the checksummed GitHub release', async () => {
  const folder=mkdtempSync(join(tmpdir(),'g-uv-fallback-')), destination=join(folder,'tools/uv.exe'), urls=[];
  try {
    await installUv({info:platformInfo('win32','x64'),home:folder,destination,run:async()=>writeFileSync(destination,'verified fixture'),validate:existsSync}, {
      download:async(url)=>{urls.push(url);if(url.includes('tsinghua'))throw Error('mirror unavailable');},
      checksum:async()=> 'a'.repeat(64),
    });
    assert.match(urls[0],/tsinghua/);assert.match(urls[1],/github.com\/astral-sh\/uv/);
  } finally {rmSync(folder,{recursive:true,force:true});}
});
