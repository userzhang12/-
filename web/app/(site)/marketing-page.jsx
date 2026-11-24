import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ArrowDown, ArrowDownToLine, ChevronDown, Clapperboard, Clock3, FileText, Film, Images, Monitor, ScanLine } from 'lucide-react';
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
  ['安装后需要注册账号吗？', '需要。预览版可以直接下载安装，首次注册时需填写邮箱、密码和单次邀请码。已有镜序账号可以直接登录。'],
  ['邀请预览和正式供应商模式有什么区别？', '邀请预览使用服务器本地制作流程和测试点数。剧本使用模板，画面根据参考素材合成。实际可用的模型以当前工作空间为准。'],
  ['安装包显示未知发布者怎么办？', '当前未签名的预览包可能触发 Windows 提示。请确认来自镜序官网，并查对下载区的 SHA-256。'],
  ['已安装的客户端需要重新下载吗？', '工作台由服务器提供，关闭并重开现有客户端即可加载网页改动。更换预览版 EXE 时，需要从官网下载并安装对应版本。'],
  ['忘记密码怎么办？', '登录页启用邮件找回时，可以通过注册邮箱收取一次性重置码。未开通邮件找回的工作空间请联系邀请人或部署管理员。'],
  ['成片可以导出成什么格式？', '可以导出适合短视频平台的 9:16 竖屏 MP4，包含配音和字幕。'],
];

const workflow = [
  { icon: FileText, title: '录入商品资料', copy: '逐条确认商品规格、卖点和宣传依据，再提交生成。' },
  { icon: Images, title: '管理参考素材', copy: '上传商品、角色和场景图片，为镜头绑定相应素材。' },
  { icon: Clapperboard, title: '编辑分镜与台词', copy: '逐镜调整画面、提示词和对白，试听普通话配音。' },
  { icon: Film, title: '审核并导出', copy: '检查首帧和片段后，合成 1080 × 1920 的竖屏 MP4。' },
];

export default async function Download() {
  const root = downloadRoot();
  const release = root ? await currentRelease(root) : null;
  const preview = root && !release ? await currentPreview() : null;
  const installer = release ? new URL('stable/' + release.file, root).href
    : preview ? new URL('preview/' + preview.file, root).href : null;
  const version = release || preview;
  const system = 'Windows 10 / 11 · x64';
  const versionLabel = version ? (preview ? '邀请预览版 ' : 'Windows 版 ') + version.version : '';

  return <div className="download-site">
    <header className="site-header"><div className="site-container site-nav">
      <a href="#top" className="site-brand"><span><ScanLine size={22}/></span>镜序</a>
      <nav aria-label="官网导航"><a href="#product">产品介绍</a><a href="#workflow">制作流程</a><a href="#questions">常见问题</a></nav>
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
              <a className="site-action secondary-action" href="#workflow">了解制作流程</a>
            </div>
            <p className="site-system">{system}{versionLabel && ' · ' + versionLabel}</p>
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

      <section className="site-workflow-wrap" id="workflow" aria-labelledby="workflow-title">
        <div className="site-container site-workflow">
          <h2 id="workflow-title">从一份商品资料开始制作</h2>
          <ol className="site-workflow-grid">
            {workflow.map(({ icon: Icon, title, copy }) => <li key={title}>
              <Icon size={23} aria-hidden="true"/><h3>{title}</h3><p>{copy}</p>
            </li>)}
          </ol>
          <div className="site-workflow-aside"><Clock3 size={20} aria-hidden="true"/>
            <div><h3>离开页面也能找回任务</h3><p>在任务中心查看生成进度，打开最近项目继续编辑。预览账号用测试点数查看用量。</p></div>
          </div>
        </div>
      </section>

      <section className="site-container site-install" id="windows" aria-labelledby="download-title">
        <div className="site-download">
          <div className="site-download-main">
            <h2 id="download-title">下载镜序</h2>
            <p>{system}</p>
            {version && <dl className="site-release-details">
              <div><dt>版本</dt><dd>{version.version}{preview ? ' 邀请预览' : ''}</dd></div>
              <div><dt>大小</dt><dd>{(version.bytes / 1024 / 1024).toFixed(1)} MiB</dd></div>
              {release && <div><dt>发布于</dt><dd>{release.published}</dd></div>}
            </dl>}
            {installer ? <>
              <a className="site-action primary-action" href={installer} aria-describedby={preview ? 'preview-notice' : undefined}>
                <ArrowDownToLine size={18}/> {preview ? '下载预览版 .exe' : '下载 Windows .exe'}
              </a>
              {preview && <p id="preview-notice">此预览包未签名，Windows 可能显示「未知发布者」。注册需要单独发放的邀请码。</p>}
              <details id="release"><summary>{release ? '版本说明和 SHA-256' : '查看 SHA-256 校验值'}</summary>
                {release && <p className="release-notes">{release.notes}</p>}
                <code>{version.sha256}</code>
              </details>
            </> : <p className="download-status" id="release">当前没有可下载的 Windows 安装包。</p>}
          </div>
          <div className="site-install-guide">
            <h3>安装后如何开始</h3>
            <ol>
              <li>下载安装包，在 Windows 上运行 .exe。</li>
              <li>打开镜序。已有账号可直接登录，新账号使用邀请码注册。</li>
              <li>新建第一个项目，录入并确认商品资料。</li>
            </ol>
            <a href="#questions">查看安装与账号问题</a>
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
      <nav aria-label="页脚导航"><a href="#product">产品介绍</a><a href="#windows">客户端下载</a><a href="#questions">常见问题</a><a href="/privacy">隐私说明</a></nav>
    </div></footer>
  </div>;
}
