import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArrowDownToLine, ArrowUpRight, Clapperboard, Cloud, Radar, ScanLine, ShieldCheck } from 'lucide-react';
import { releaseManifest } from './manifest.mjs';
import './download.css';

export const metadata = {
  title: '下载镜序 · AI 短剧制作工作台',
  description: '下载镜序 Windows 客户端，从商品资料、剧本、分镜到竖屏成片。',
};
export const dynamic = 'force-dynamic';

function downloadRoot() {
  try {
    const url = new URL(process.env.JINGXU_DOWNLOAD_ROOT || 'https://localhost/desktop/');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
    url.pathname = url.pathname.replace(/\/?$/, '/');
    return url;
  } catch {
    return null;
  }
}

async function currentRelease(root) {
  const directory = process.env.JINGXU_RELEASE_DIR;
  if (!directory && !process.env.JINGXU_DOWNLOAD_ROOT) return null;
  try {
    const data = directory ? JSON.parse(await readFile(join(directory, 'stable', 'release.json'), 'utf8')) :
      await fetch(new URL('stable/release.json', root), { signal: AbortSignal.timeout(4000), cache: 'no-store' }).then(response => {
        if (!response.ok) throw new Error('发布清单暂不可用');
        return response.json();
      });
    return releaseManifest(data, 'stable');
  } catch {
    return null;
  }
}

export default async function Download() {
  const root = downloadRoot();
  const release = root ? await currentRelease(root) : null;
  const installer = release && new URL('stable/' + release.file, root).href;
  const workbench = '/workbench';

  return <main className="download-site">
    <header className="site-header"><a href="/download" className="site-brand"><span><ScanLine size={22}/></span>镜序</a>
      <nav aria-label="官网导航"><a href="#windows">客户端下载</a><a href="#release">版本说明</a><a href={workbench}>打开网页版 <ArrowUpRight size={15}/></a></nav>
    </header>
    <div className="site-main">
      <section id="windows" className="download-hero">
        <div className="download-intro">
          <p className="site-platform"><span/> Windows 桌面客户端</p>
          <h1>在镜序，<br/><em>把商品拍成故事。</em></h1>
          <p className="download-description">从商品资料、剧本和分镜，到配音、渲染和竖屏成片。项目保存在云端，换一台电脑也能接着做。</p>
          <div className="download-actions">
            {installer ? <a className="download-button" href={installer}><ArrowDownToLine size={18}/> 下载 Windows 版</a> :
              <span className="download-button unavailable"><ArrowDownToLine size={18}/> 安装包待发布</span>}
            <a className="site-text-link" href={workbench}>打开网页版 <ArrowUpRight size={15}/></a>
          </div>
          <p className="system-requirements">Windows 10 / 11 · x64{release ? ' · v' + release.version : ''}</p>
        </div>
        <figure className="download-visual">
          <img src="/storyboard-still.webp" alt="微短剧示例画面：女主在厨房里转身"/>
          <figcaption><Clapperboard size={16}/> 镜序示例分镜 <span>9:16</span></figcaption>
        </figure>
      </section>
      <div className="site-details">
        <section className="site-feature"><Cloud size={21}/><h2>任务在云端继续</h2><p>退出客户端后，已提交的渲染仍可继续。重新登录后可以查看进度和成片。</p></section>
        <section className="site-feature"><ShieldCheck size={21}/><h2>签名安装包</h2><p>Windows 可核验安装包发布者。客户端会验证更新签名，用户可选择合适的时间安装。</p></section>
        <section className="site-feature"><Radar size={21}/><h2>同一个工作空间</h2><p>在网页版和客户端之间继续编辑项目，查看分镜、素材和费用。</p></section>
      </div>
      <section id="release" className="site-release"><div><h2>版本说明</h2>
        {release ? <p>v{release.version} · {release.published} · {(release.bytes / 1024 / 1024).toFixed(1)} MB</p> : <p>正式安装包发布后，这里会显示版本和校验信息。</p>}</div>
        {release && <><pre className="release-notes">{release.notes}</pre>
          <details><summary>安装包 SHA-256</summary><code>{release.sha256}</code></details></>}
      </section>
    </div>
  </main>;
}
