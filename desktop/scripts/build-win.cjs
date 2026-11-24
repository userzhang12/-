const fs = require('node:fs/promises');
const path = require('node:path');
const { build, Platform, Arch } = require('electron-builder');
const { endpoint, workbenchEndpoint } = require('../policy.cjs');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const slug = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;

async function main() {
  const testBuild = process.argv.includes('--test');
  const unsigned = process.argv.includes('--unsigned');
  const manual = testBuild || unsigned;
  const channel = testBuild ? 'test' : unsigned ? 'unsigned' : process.env.JINGXU_RELEASE_CHANNEL || 'stable';
  if ((testBuild && unsigned) || !slug.test(version) ||
      (unsigned && version.includes('-beta.')) ||
      (!manual && (!['stable', 'beta'].includes(channel) || (channel === 'beta') !== version.includes('-beta.')))) {
    throw new Error('正式版使用 X.Y.Z，内测版使用 X.Y.Z-beta.N');
  }
  const appUrl = workbenchEndpoint(process.env.JINGXU_APP_URL).href;
  const distribution = {};
  if (!manual) {
    const releaseRoot = endpoint(process.env.JINGXU_RELEASE_ROOT);
    releaseRoot.pathname = releaseRoot.pathname.replace(/\/?$/, '/');
    const publisher = process.env.JINGXU_SIGNER_NAME?.trim();
    if (!publisher || !(process.env.WIN_CSC_LINK || process.env.CSC_LINK)) {
      throw new Error('Windows 正式构建需要代码签名证书与证书发布者名称');
    }
    distribution.publish = [{ provider: 'generic', url: new URL(channel + '/', releaseRoot).href, channel: 'latest' }];
    distribution.signing = {
      forceCodeSigning: true,
      signtoolOptions: { publisherName: publisher, signingHashAlgorithms: ['sha256'] },
    };
  }

  const configPath = path.join(root, 'distribution.json');
  await fs.writeFile(configPath, JSON.stringify({ appUrl, channel }), { flag: 'wx' });
  try {
    await build({
      projectDir: root,
      targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64),
      publish: 'never',
      config: {
        appId: channel === 'stable' ? 'studio.jingxu.desktop' : 'studio.jingxu.desktop.' + channel,
        productName: { test: '镜序测试版', beta: '镜序内测版', stable: '镜序', unsigned: '镜序' }[channel],
        artifactName: (testBuild ? 'jingxu-test-setup-' : unsigned ? 'jingxu-unsigned-setup-' : 'jingxu-setup-') + '${version}-${arch}.${ext}',
        detectUpdateChannel: false,
        directories: { output: testBuild ? 'dist-test' : unsigned ? 'dist-unsigned' : 'dist' },
        files: ['main.cjs', 'preload.cjs', 'policy.cjs', 'distribution.json', 'package.json'],
        win: {
          executableName: 'jingxu',
          icon: 'icon.ico',
          target: ['nsis'],
          ...(manual ? { signAndEditExecutable: false } : distribution.signing),
        },
        nsis: { oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true },
        publish: distribution.publish || null,
      },
    });
  } finally {
    await fs.unlink(configPath);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
