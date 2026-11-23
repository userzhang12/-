import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ArrowDown, ArrowDownToLine, ChevronDown, Clapperboard, FileText, Monitor, ScanLine } from 'lucide-react';
import HeroOcean from './hero-ocean';
import SharkIntro from './shark-intro';
import ProductPreview from './product-preview';
import { previewManifest, releaseManifest } from './manifest.mjs';

export const metadata = {
  title: '镜序 · AI 商品短剧制作软件',
  description: '镜序面向商家与内容团队，帮助你从商品资料、剧本和分镜制作带配音的竖屏短剧。',
};

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

async function currentPreview() {
  const directory = process.env.JINGXU_RELEASE_DIR;
  if (!directory) return null;
  try {
    const path = join(directory, 'preview');
    const manifest = previewManifest(JSON.parse(await readFile(join(path, 'release.json'), 'utf8')));
    const installer = await stat(join(path, manifest.file));
    return installer.isFile() && installer.size === manifest.bytes ? manifest : null;
  } catch {
    return null;
  }
}

const questions = [
  ['镜序支持哪些系统？', '首发客户端面向 Windows 10 和 Windows 11 的 x64 电脑。'],
  ['安装后需要注册账号吗？', '需要。镜序目前采用邀请制，用邮箱和邀请码注册后可以加入工作空间。'],
  ['成片可以导出成什么格式？', '可以导出适合短视频平台的 9:16 竖屏 MP4，包含配音和字幕。'],
];

export default async function Download() {
  const root = downloadRoot();
  const release = root ? await currentRelease(root) : null;
  const preview = root && !release ? await currentPreview() : null;
  const installer = release ? new URL('stable/' + release.file, root).href
    : preview ? new URL('preview/' + preview.file, root).href : null;
  const system = 'Windows 10 / 11 · x64' + (release || preview ? ' · v' + (release || preview).version : '');

  return <div className="download-site">
    <header className="site-header"><div className="site-container site-nav">
      <a href="#top" className="site-brand"><span><ScanLine size={22}/></span>镜序</a>
      <nav aria-label="官网导航"><a href="#product">产品介绍</a><a href="#questions">常见问题</a></nav>
      <a className="site-action nav-action" href="#windows"><ArrowDownToLine size={16}/> {installer ? '客户端下载' : '发布状态'}</a>
    </div></header>

    <main id="top">
      <section className="site-hero" aria-labelledby="site-title">
        <div className="site-hero-visual" aria-hidden="true">
          <div className="site-hero-stage">
            <HeroOcean/>
          </div>
        </div>
        <div className="site-shark-visual" aria-hidden="true">
          <div className="site-shark-stage"><SharkIntro/></div>
        </div>
        <div className="site-container site-hero-inner">
          <div className="site-hero-copy">
            <p className="site-kicker">镜序 · AI 商品短剧制作软件</p>
            <h1 id="site-title">从商品资料到<br/><em>带配音的竖屏短剧</em></h1>
            <p className="site-summary">生成剧本，逐镜调整台词和画面，合成带字幕的 9:16 成片。</p>
            <div className="site-hero-actions">
              {installer ? <a className="site-action primary-action" href={preview ? "#windows" : installer}><ArrowDownToLine size={18}/> {preview ? "获取 Windows 预览版" : "下载 Windows 版"}</a> :
                <a className="site-action primary-action" href="#windows"><ArrowDown size={17}/> Windows 版待发布</a>}
              <a className="site-action secondary-action" href="#product">了解制作流程</a>
            </div>
            <p className="site-system">{system}</p>
          </div>
          <div className="site-hero-preview"><ProductPreview/></div>
        </div>
      </section>

      <section className="site-container site-product" id="product" aria-labelledby="product-title">
        <figure className="site-product-image"><img src="/story-product.webp" alt="示例短剧画面，暖光下的琥珀色玻璃瓶" loading="lazy"/><figcaption>短剧示例 · 商品特写</figcaption></figure>
        <div className="site-product-copy">
          <h2 id="product-title">让商品自然进入剧情。</h2>
          <ul>
            <li><FileText size={19}/><div><h3>从商品资料生成剧本</h3><p>把卖点写进人物的行动和对话，让观众跟着故事认识商品。</p></div></li>
            <li><Clapperboard size={19}/><div><h3>按镜头调整故事</h3><p>台词、镜头和商品出场都可以逐镜修改。</p></div></li>
            <li><Monitor size={19}/><div><h3>导出竖屏成片</h3><p>将画面、配音和字幕合成 9:16 MP4，方便发布到短视频平台。</p></div></li>
          </ul>
        </div>
      </section>

      <section className="site-container" id="windows" aria-labelledby="download-title">
        <div className="site-download">
          <div><h2 id="download-title">下载镜序</h2><p>{system}</p></div>
          <div className="site-download-info">
            {release ? <><a className="site-action primary-action" href={installer}><ArrowDownToLine size={17}/> 下载 .exe 安装包</a>
              <p>发布于 {release.published} · {(release.bytes / 1024 / 1024).toFixed(1)} MB</p>
              <details id="release"><summary>版本说明和安装包校验值</summary><p className="release-notes">{release.notes}</p><code>SHA-256 {release.sha256}</code></details>
            </> : preview ? <>
              <p id="preview-notice">Windows 预览版可以直接下载。安装包未签名，Windows 可能显示「未知发布者」。安装后注册仍需私发的邀请码。</p>
              <a className="site-action primary-action" href={installer} aria-describedby="preview-notice"><ArrowDownToLine size={17}/> 下载预览版 .exe</a>
              <p>{(preview.bytes / 1024 / 1024).toFixed(1)} MB</p>
              <details id="release"><summary>安装包校验值</summary><code>SHA-256 {preview.sha256}</code></details>
            </> : <p className="download-status" id="release">正式 Windows 安装包待发布。</p>}
          </div>
        </div>
      </section>

      <section className="site-container site-faq" id="questions" aria-labelledby="questions-title">
        <h2 id="questions-title">常见问题</h2>
        <div>{questions.map(([question, answer]) => <details key={question}>
          <summary>{question}<ChevronDown size={17}/></summary><p>{answer}</p>
        </details>)}</div>
      </section>
    </main>

    <footer className="site-footer"><div className="site-container">
      <a href="#top" className="site-brand"><span><ScanLine size={19}/></span>镜序</a>
      <nav aria-label="页脚导航"><a href="#product">产品介绍</a><a href="#windows">客户端下载</a><a href="#questions">常见问题</a></nav>
    </div></footer>
  </div>;
}
