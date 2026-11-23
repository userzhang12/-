export const versionPattern = /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/;

export function releaseManifest(value, channel) {
  if (!value || !['stable', 'beta'].includes(channel) || value.channel !== channel ||
      !versionPattern.test(value.version) || (channel === 'beta') !== value.version.includes('-beta.') ||
      value.file !== `jingxu-setup-${value.version}-x64.exe` ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0 ||
      typeof value.notes !== 'string' || value.notes.length > 12000 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.published)) {
    throw new Error('发布清单格式无效');
  }
  return value;
}

export function previewManifest(value) {
  if (!value || value.channel !== 'preview' || !/^\d+\.\d+\.\d+$/.test(value.version) ||
      value.file !== `jingxu-test-setup-${value.version}-x64.exe` ||
      !/^[a-f0-9]{64}$/.test(value.sha256) ||
      !Number.isSafeInteger(value.bytes) || value.bytes <= 0) {
    throw new Error('预览版清单格式无效');
  }
  return value;
}
