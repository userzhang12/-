'use client';

import { useEffect, useState } from 'react';
import { ArrowDownToLine, RefreshCw } from 'lucide-react';

export default function DesktopUpdate({ busy }) {
  const [state, setState] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const desktop = window.jingxuDesktop;
    if (!desktop) return;
    let active = true;
    desktop.status().then(value => { if (active) setState(value); }).catch(() => {});
    const unsubscribe = desktop.onStatus(value => { setState(value); setMessage(''); });
    return () => { active = false; unsubscribe(); };
  }, []);
  if (!state || state.channel === 'dev') return null;

  if (state.channel === 'test') {
    return <a className="button small" href="/download#windows" title="前往官网下载 Windows 安装包">
      <ArrowDownToLine size={15}/>预览版 v{state.version}
    </a>;
  }

  const actions = {
    available: ['download', '下载更新 ' + state.nextVersion],
    ready: ['install', '重启并更新'],
    current: ['check', '已是最新版'],
    error: ['check', '重试更新'],
    idle: ['check', '检查更新'],
  };
  const action = actions[state.phase];

  return <div className="desktop-updates">
    <button className="button small" disabled={!action || (busy && state.phase === 'ready')} onClick={async () => {
      try {
        const response = await window.jingxuDesktop[action[0]]();
        if (response?.blocked) setMessage('文件正在下载，请等下载完成后再安装。');
      } catch { setMessage('无法检查或安装更新，请稍后重试。'); }
    }} title={'客户端 v' + state.version + ' · ' + state.channel}>
      {state.phase === 'available' ? <ArrowDownToLine size={15}/> : <RefreshCw size={15}/>}
      {state.phase === 'checking' ? '检查更新…' : state.phase === 'downloading' ? '正在下载 ' + state.percent + '%' : action?.[1]}
    </button>
    {message && <p className="desktop-update-message" role="status">{message}</p>}
  </div>;
}
