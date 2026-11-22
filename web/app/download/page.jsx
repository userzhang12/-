import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ArrowDownToLine, ArrowUpRight, AudioLines, Box, ChevronDown, Clapperboard, Laptop, ScanLine, Video } from 'lucide-react';
import SceneStory from './scene-story';
import { releaseManifest } from './manifest.mjs';
import './download.css';
import './scene-story.css';

export const metadata = {
  title: '镜序 · 商品短剧制作工作台',
  description: '镜序面向商家与内容团队，帮助你从商品资料、剧本和分镜制作带配音的竖屏短剧。',
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

const workflow = [
  { icon: Box, title: '录入并确认商品', body: '添加商品资料、卖点和实拍图。先核对要展示的规格和优惠，再开始做剧本。' },
  { icon: Clapperboard, title: '编辑剧本和分镜', body: '在时间轴上逐镜调整台词、画面和提示词。商品什么时候出现，由你决定。' },
  { icon: AudioLines, title: '试听、审核与渲染', body: '先听台词、确认首帧，再生成动态片段。某一镜需要返工，可以单独重做。' },
  { icon: Video, title: '导出竖屏成片', body: '检查配音、字幕与镜头衔接，再将成片导出为 1080 × 1920 MP4。' },
];

const questions = [
  ['现在怎样开始使用？', '镜序目前采用邀请制。拿到邀请码后，打开工作台即可用邮箱注册并加入工作空间。已有账号可以直接登录。'],
  ['一定要安装 Windows 客户端吗？', '可以先用网页版。正式安装包发布后，Windows 客户端和网页版可以登录同一个工作空间。'],
  ['关闭网页后，生成任务会停止吗？', '已提交的云端任务会继续运行。重新打开工作台后，可以查看进度和已生成的结果。'],
  ['镜头不满意，需要整条重做吗？', '可以调整并重算单个镜头。其他已审核的镜头可继续保留。重算涉及模型调用时，请先查看项目预算。'],
];

export default async function Download() {
  const root = downloadRoot();
  const release = root ? await currentRelease(root) : null;
  const installer = release && new URL('stable/' + release.file, root).href;
  const workbench = '/workbench';

  return <div className="download-site">
    <header className="site-header">
      <div className="site-container site-nav">
        <a href="/download" className="site-brand"><span><ScanLine size={21}/></span>镜序</a>
        <nav aria-label="官网导航">
          <a href="#product">产品</a><a href="#workflow">制作流程</a><a href="#windows">客户端下载</a><a href="#questions">常见问题</a>
        </nav>
        <a className="site-action nav-action" href={workbench}>打开工作台 <ArrowUpRight size={15}/></a>
      </div>
    </header>

    <main>
      <SceneStory workbench={workbench}/>

      <section className="site-preview-band" id="preview">
        <div className="site-container">
          <div className="site-section-heading workbench-preview-heading"><div><h2>进入真实的制作工作台</h2><p>查看完整分镜、竖屏预览和可编辑的台词与提示词。</p></div><a className="site-action secondary-action" href={workbench + '?page=script&project=sample'}>打开示例项目 <ArrowUpRight size={16}/></a></div>
          <figure className="site-workbench-figure"><img src="/official-workbench.webp" alt="镜序实际分镜工作台，包含镜头列表、竖屏预览、台词试听和时间轴" loading="lazy"/><figcaption>镜序分镜工作台 · 示例项目</figcaption></figure>
        </div>
      </section>

      <section id="workflow" className="site-container site-section">
        <div className="site-section-heading"><h2>从一件商品到一条成片</h2></div>
        <ol className="site-steps">{workflow.map(({ icon: Icon, title, body }) =>
          <li key={title}><span className="site-step-icon"><Icon size={21}/></span><h3>{title}</h3><p>{body}</p></li>)}</ol>
      </section>

      <section id="windows" className="site-container site-section site-download">
        <div><span className="site-step-icon"><Laptop size={22}/></span><h2>下载镜序客户端</h2><p>Windows 10 / 11 · x64{release ? ' · v' + release.version : ''}</p></div>
        <div className="site-download-info">
          {installer ? <a className="site-action primary-action" href={installer}><ArrowDownToLine size={17}/> 下载 Windows 版</a> : <p className="download-status">Windows 安装包待发布。现在可以使用网页版。</p>}
          {release ? <>
            <p>发布于 {release.published} · {(release.bytes / 1024 / 1024).toFixed(1)} MB</p>
            <details><summary>查看版本说明和安装包校验值</summary><p className="release-notes">{release.notes}</p><code>SHA-256 {release.sha256}</code></details>
          </> : <a className="download-text-link" href={workbench}>打开网页版 <ArrowUpRight size={15}/></a>}
        </div>
      </section>

      <section id="questions" className="site-container site-section site-faq">
        <div className="site-section-heading"><h2>常见问题</h2></div>
        <div>{questions.map(([question, answer]) => <details key={question}>
          <summary>{question}<ChevronDown size={17}/></summary><p>{answer}</p>
        </details>)}</div>
      </section>
    </main>

    <footer className="site-footer"><div className="site-container">
      <a href="/download" className="site-brand"><span><ScanLine size={19}/></span>镜序</a>
      <nav aria-label="页脚导航"><a href="#product">产品首页</a><a href="#windows">下载</a><a href="#questions">使用帮助</a><a href={workbench}>打开工作台</a></nav>
    </div></footer>
  </div>;
}
