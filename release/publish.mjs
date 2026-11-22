import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { releaseManifest } from '../web/app/download/manifest.mjs';

const [channel, sourceRoot, destinationRoot] = process.argv.slice(2);
if (!['stable', 'beta'].includes(channel) || !sourceRoot || !destinationRoot)
  throw new Error('用法: node release/publish.mjs stable|beta 构建产物目录 发布目录');

function compareVersions(left, right) {
  const parts = version => version.split(/[-.]/).filter(part => part !== 'beta').map(BigInt);
  const a = parts(left);
  const b = parts(right);
  for (let index = 0; index < 4; index++) {
    const l = a[index] ?? 0n;
    const r = b[index] ?? 0n;
    if (l !== r) return l > r ? 1 : -1;
  }
  return 0;
}

async function writeAtomic(sourceFile, destinationFile) {
  const temporary = destinationFile + '.' + randomUUID() + '.tmp';
  try {
    await copyFile(sourceFile, temporary);
    await rename(temporary, destinationFile);
  } finally {
    await rm(temporary, { force: true });
  }
}

const source = resolve(sourceRoot, channel);
const destination = resolve(destinationRoot, channel);
if (source === destination) throw new Error('发布目录须与构建产物分开');
const manifest = releaseManifest(JSON.parse(await readFile(join(source, 'release.json'), 'utf8')), channel);
const installer = join(source, manifest.file);
const [sha256, sha512] = ['sha256', 'sha512'].map(name => createHash(name));
for await (const chunk of createReadStream(installer)) {
  sha256.update(chunk);
  sha512.update(chunk);
}
if (sha256.digest('hex') !== manifest.sha256 || (await stat(installer)).size !== manifest.bytes)
  throw new Error('安装包校验值或大小与发布清单不一致');
const latest = (await readFile(join(source, 'latest.yml'), 'utf8')).split(/\r?\n/);
const digest = sha512.digest('base64');
if (!latest.includes('version: ' + manifest.version) ||
    !latest.some(line => line.trim() === 'sha512: ' + digest) ||
    !latest.some(line => ['url: ', '- url: '].some(prefix => line.trim() === prefix + manifest.file))) {
  throw new Error('自动更新清单与安装包不匹配');
}
if (!(await stat(installer + '.blockmap')).size) throw new Error('差分更新文件为空');

await mkdir(destination, { recursive: true });
const lock = join(destination, '.publish-lock');
await mkdir(lock);
try {
  let current;
  try { current = releaseManifest(JSON.parse(await readFile(join(destination, 'release.json'), 'utf8')), channel); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (current && compareVersions(manifest.version, current.version) <= 0)
    throw new Error('已经发布的版本不可覆盖或降级，请增加版本号');
  for (const name of [manifest.file, manifest.file + '.blockmap', 'latest.yml', 'release.json'])
    await writeAtomic(join(source, name), join(destination, name));
} finally {
  await rm(lock, { recursive: true, force: true });
}
console.log(`已发布 ${channel} v${manifest.version}`);
