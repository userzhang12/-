import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';
import { previewManifest, unsignedManifest } from '../web/app/(site)/manifest.mjs';

const [installer] = process.argv.slice(2);
const file = installer && basename(installer);
const match = /^jingxu-(test|unsigned)-setup-(\d+\.\d+\.\d+)-x64\.exe$/.exec(file || '');
if (!match) throw new Error('用法: node release/preview.mjs jingxu-test-setup-版本-x64.exe 或 jingxu-unsigned-setup-版本-x64.exe');

const handle = await open(installer, 'r');
try {
  const info = await handle.stat();
  const header = Buffer.alloc(64);
  const { bytesRead } = await handle.read(header, 0, header.length, 0);
  if (!info.isFile() || bytesRead !== header.length || header.toString('ascii', 0, 2) !== 'MZ')
    throw new Error('文件不是 Windows 安装包');
  const offset = header.readUInt32LE(60);
  const signature = Buffer.alloc(4);
  if (offset < 64 || offset > info.size - 4 ||
      (await handle.read(signature, 0, signature.length, offset)).bytesRead !== 4 ||
      !signature.equals(Buffer.from([80, 69, 0, 0])))
    throw new Error('Windows 安装包的 PE 头无效');
  const hash = createHash('sha256');
  for await (const data of createReadStream(installer)) hash.update(data);
  const unsigned = match[1] === 'unsigned';
  const validate = unsigned ? unsignedManifest : previewManifest;
  const manifest = validate({
    channel: unsigned ? 'unsigned' : 'preview', version: match[2], file, sha256: hash.digest('hex'), bytes: info.size,
  });
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await handle.close();
}
