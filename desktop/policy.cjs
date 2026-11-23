function endpoint(value, allowLoopback = false) {
  const url = new URL(value);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLoopback && loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('地址必须使用可信的 HTTPS 服务');
  }
  return url;
}

function workbenchEndpoint(value, allowLoopback = false) {
  const url = endpoint(value, allowLoopback);
  if (url.pathname === '/' || /^\/download\/?$/.test(url.pathname)) url.pathname = '/workbench';
  return url;
}

function allowsNavigation(value, origin) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && url.origin === origin &&
      !url.username && !url.password;
  } catch {
    return false;
  }
}

function downloadName(value) {
  const basename = String(value || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .trim().replace(/[. ]+$/g, '');
  if (!basename) return 'jingxu-download';
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename)) return '_' + basename;
  return basename;
}

module.exports = { endpoint, workbenchEndpoint, allowsNavigation, downloadName };
