import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { releaseManifest } from '../web/app/download/manifest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(join(root, 'desktop/package.json'), 'utf8'));
const [channel, notesPath, publishDir] = process.argv.slice(2);
if (!['stable', 'beta'].includes(channel) || !notesPath || !publishDir)
  throw new Error('用法: node release/prepare.mjs stable|beta 版本说明路径 输出目录');

const notes = (await readFile(notesPath, 'utf8')).trim();
const file = `jingxu-setup-${version}-x64.exe`;
const source = join(root, 'desktop/dist', file);
const latestPath = join(root, 'desktop/dist/latest.yml');
const latest = await readFile(latestPath, 'utf8');
if (!latest.split(/\r?\n/).includes(`version: ${version}`) ||
    !latest.split(/\r?\n/).some(line => line.trim() === `url: ${file}` || line.trim() === `- url: ${file}`)) {
  throw new Error('更新清单与安装包版本不一致');
}
const hash = createHash('sha256');
const integrity = createHash('sha512');
for await (const chunk of createReadStream(source)) {
  hash.update(chunk);
  integrity.update(chunk);
}
const sha512 = integrity.digest('base64');
if (!latest.split(/\r?\n/).some(line => line.trim() === `sha512: ${sha512}`)) {
  throw new Error('更新清单与安装包校验值不一致');
}
const { size: bytes } = await stat(source);
const manifest = releaseManifest({
  version, channel, file, bytes, sha256: hash.digest('hex'),
  published: new Date().toISOString().slice(0, 10), notes,
}, channel);
const destination = join(publishDir, channel);
await mkdir(destination, { recursive: true });
await copyFile(source, join(destination, file));
await copyFile(source + '.blockmap', join(destination, file + '.blockmap'));
await copyFile(latestPath, join(destination, 'latest.yml'));
await writeFile(join(destination, 'release.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${channel} ${version}: ${destination}`);
