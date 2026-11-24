import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, link, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { unsignedManifest } from '../web/app/(site)/manifest.mjs';

const [bundle, releaseRoot] = process.argv.slice(2);
if (!bundle || !releaseRoot) throw new Error('用法: node release/install-unsigned.mjs 安装包目录 发布根目录');

const source = resolve(bundle);
const destination = resolve(releaseRoot, 'unsigned');
if (source === destination) throw new Error('构建目录必须与发布目录分开');

const manifest = unsignedManifest(JSON.parse(await readFile(join(source, 'release.json'), 'utf8')));
const installer = join(source, manifest.file);
const published = join(destination, manifest.file);

async function verify(file) {
  const info = await stat(file);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (!info.isFile() || info.size !== manifest.bytes || hash.digest('hex') !== manifest.sha256)
    throw new Error('安装包大小或 SHA-256 校验失败');
}

await mkdir(destination, { recursive: true });
const lock = join(destination, '.publish-lock');
await mkdir(lock);
try {
  const current = await readFile(join(destination, 'release.json'), 'utf8')
    .then(data => unsignedManifest(JSON.parse(data)), error => {
      if (error.code !== 'ENOENT') throw error;
      return null;
    });
  const versions = (value) => value.version.split('.').map(BigInt);
  if (current) {
    const old = versions(current);
    const next = versions(manifest);
    const part = next.findIndex((value, index) => value !== old[index]);
    if (part >= 0 && next[part] < old[part]) throw new Error('已发布版本不能降级');
    if (part === -1 && current.sha256 !== manifest.sha256) throw new Error('同一版本不能更换安装包内容');
  }
  const temporary = join(destination, randomUUID());
  try {
    await copyFile(installer, temporary);
    await verify(temporary);
    try { await link(temporary, published); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await verify(published);
    }
    await copyFile(join(source, 'release.json'), temporary + '.json');
    await rename(temporary + '.json', join(destination, 'release.json'));
  } finally {
    await rm(temporary, { force: true });
    await rm(temporary + '.json', { force: true });
  }
} finally {
  await rm(lock, { recursive: true, force: true });
}
console.log(`已发布未签名正式版 v${manifest.version}`);
