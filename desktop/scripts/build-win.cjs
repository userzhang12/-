const fs = require('node:fs/promises');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { endpoint, workbenchEndpoint } = require('../policy.cjs');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const slug = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;

async function main() {
  const channel = process.env.JINGXU_RELEASE_CHANNEL || 'stable';
  if (!slug.test(version) || !['stable', 'beta'].includes(channel) ||
      (channel === 'beta') !== version.includes('-beta.')) {
    throw new Error('正式版使用 X.Y.Z，内测版使用 X.Y.Z-beta.N');
  }
  const appUrl = workbenchEndpoint(process.env.JINGXU_APP_URL).href;
  const releaseRoot = endpoint(process.env.JINGXU_RELEASE_ROOT);
  releaseRoot.pathname = releaseRoot.pathname.replace(/\/?$/, '/');
  const feed = new URL(channel + '/', releaseRoot).href;
  const publisher = process.env.JINGXU_SIGNER_NAME?.trim();
  if (!publisher || !(process.env.WIN_CSC_LINK || process.env.CSC_LINK)) {
    throw new Error('Windows 正式构建需要代码签名证书与证书发布者名称');
  }

  const configPath = path.join(root, 'distribution.json');
  await fs.writeFile(configPath, JSON.stringify({ appUrl, channel }), { flag: 'wx' });
  try {
    await build({
      projectDir: root,
      targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
      publish: 'never',
      config: {
        appId: channel === 'beta' ? 'studio.jingxu.desktop.beta' : 'studio.jingxu.desktop',
        productName: channel === 'beta' ? '镜序内测版' : '镜序',
        artifactName: 'jingxu-setup-${version}-${arch}.${ext}',
        detectUpdateChannel: false,
        directories: { output: 'dist' },
        files: ['main.cjs', 'preload.cjs', 'policy.cjs', 'distribution.json', 'package.json'],
        win: {
          executableName: 'jingxu',
          icon: 'icon.ico',
          target: ['nsis'],
          forceCodeSigning: true,
          signtoolOptions: { publisherName: publisher, signingHashAlgorithms: ['sha256'] },
        },
        nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
        publish: [{ provider: 'generic', url: feed, channel: 'latest' }],
      },
    });
  } finally {
    await fs.unlink(configPath);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
