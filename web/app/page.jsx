'use client';

import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Storyboard, { storyboardStill, timecode } from './storyboard';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, Box, Check,
  CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clapperboard, Clock3, Coins,
  Frame, Images, Layers3, LayoutGrid, ListVideo, Menu, MoreHorizontal,
  Plus, ScanLine, Settings2, Sparkles, TrendingUp, UploadCloud, Video, X,
} from 'lucide-react';

const sampleNames = ['深夜厨房的秘密', '重逢引发误会', '意想不到的线索', '交换条件', '商品自然登场', '实拍细节展示', '试一试再说', '出乎意料的反转', '包装细节', '解开心结', '回到餐桌', '故事的回响'];
const sampleDesc = ['女主推开厨房门，发现桌面上多了一件熟悉的东西。一个不寻常的细节，让她停下了脚步。', '两人在厨房相遇，因桌上的便签引发一场误会。', '女主翻开便签，意外发现背面还有一行字。', '两人决定亲手验证，误会开始松动。', '商品随剧情自然登场，以实拍画面展示真实包装。', '切换至商品特写，展示标签和包装细节。'];
const sample = {
  id: 'sample', name: '反转厨房 · 植入短剧', facts: [{ id: 'sample', label: '商品资料', value: '琥珀色玻璃瓶，厨房料理场景。此资料仅用于工作台演示。', source: '示例资料', confirmed: true }],
  audience: '微信视频号 · 家庭日常', assets: [], budget: 4950, committed: 1860, spent: 0, jobs: [], metrics: [],
  script: { trope: '家庭误会 · 反转', beats: sampleNames.map((title, i) => ({
    id: String(i + 1).padStart(2, '0'), title, start: i * 10, end: (i + 1) * 10,
    description: sampleDesc[i] || '延续情绪变化，推动短剧继续发展。',
    dialogue: i === 0 ? '等等……这个是谁放在这儿的？' : '', prompt: '暖光现代厨房，写实短剧，人物表情自然。',
    motion: '镜头缓慢推进，保留环境和人物的相对位置。', hook: i === 0 ? '悬念钩子' : '情绪推进',
    size: ['特写', '中景', '近景', '过肩', '中景', '特写'][i % 6],
    dynamic: [0, 3, 4, 7].includes(i), product: [4, 5, 8, 10].includes(i), approved: false, asset_ids: [],
  })) },
};
const steps = [
  { label: '商品录入', icon: Box, key: 'product' }, { label: '资产管理', icon: Images, key: 'assets' },
  { label: '剧本分镜', icon: ListVideo, key: 'script' }, { label: '生成渲染', icon: Video, key: 'render' },
  { label: '成片导出', icon: ArrowDownToLine, key: 'export' },
];
const pageTitle = { product: '商品录入', assets: '资产管理', script: '分镜工作台', render: '生成渲染', export: '成片导出', projects: '项目总览', trends: '热梗素材库', usage: '费用与用量', operations: '平台运营', settings: '工作空间设置', metrics: '投放数据', help: '使用说明' };
const kindNames = { script: '剧本生成', frame: '首帧生成', clip: '片段渲染', export: '成片合成' };
const stateNames = { queued: '排队中', running: '处理中', done: '已完成', failed: '失败', uncertain: '待核对' };
const yuan = value => '¥' + ((value || 0) / 100).toFixed(2);

async function api(url, options = {}) {
  const body = options.body;
  const result = await fetch('/api' + url, {
    ...options,
    headers: body instanceof FormData || !body ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData || !body ? body : JSON.stringify(body),
  });
  if (!result.ok) {
    const error = await result.json().catch(() => ({}));
    throw new Error(typeof error.detail === 'string' ? error.detail : '请求失败，请稍后再试');
  }
  return result.json();
}

function percent(value, denominator) {
  return denominator ? (100 * value / denominator).toFixed(1) + '%' : '—';
}

function Logo() {
  return <div className="brand"><span className="brand-icon"><ScanLine size={22} strokeWidth={2.1}/></span><div><strong>镜序</strong><small>JINGXU STUDIO</small></div></div>;
}

export default function Workbench() {
  const [page, setPage] = useState('script');
  const [project, setProject] = useState(sample);
  const [projects, setProjects] = useState([]);
  const [trendList, setTrends] = useState([]);
  const [operations, setOperations] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [session, setSession] = useState(null);
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [active, setActive] = useState('01');
  const [modal, setModal] = useState('');
  const modalTrigger = useRef(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [filter, setFilter] = useState('all');
  const [form, setForm] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [voicePreview, setVoicePreview] = useState(null);
  const [invite, setInvite] = useState('');
  const current = project.script?.beats.find(b => b.id === active) || project.script?.beats[0];
  const isSample = project.id === 'sample';

  useEffect(() => {
    api('/session').then(setSession).catch(error => { if (error.message.includes('登录')) { setRequiresLogin(true); setModal('login'); } });
    api('/projects').then(setProjects).catch(() => {});
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (isSample) return;
    const stream = new EventSource('/api/projects/' + project.id + '/events');
    stream.onmessage = event => setProject(JSON.parse(event.data));
    // Also refresh through the snapshot endpoint if streaming is buffered by a proxy.
    const timer = setInterval(() => api('/projects/' + project.id).then(setProject).catch(() => {}), 3500);
    return () => { stream.close(); clearInterval(timer); };
  }, [project.id, isSample]);
  useEffect(() => {
    if (page === 'trends') api('/trends').then(setTrends).catch(error => setToast(error.message));
    if ((page === 'usage' || page === 'settings') && session?.admin) api('/workspace').then(setWorkspace).catch(error => setToast(error.message));
    if (page === 'operations') api('/operations').then(setOperations).catch(error => setToast(error.message));
    if (page === 'projects') api('/projects').then(setProjects).catch(error => setToast(error.message));
  }, [page, session]);

  function go(next) { setPage(next); setMobile(false); }
  function open(name, data = {}) {
    if (!modal) modalTrigger.current = document.activeElement;
    setForm(data);
    setFieldErrors({});
    setFormError('');
    setModal(name);
  }
  function change(key, value) {
    setForm(previous => ({ ...previous, [key]: value }));
    setFieldErrors(previous => ({ ...previous, [key]: undefined }));
    setFormError('');
  }
  function file(name, download = false) { return '/api/projects/' + project.id + '/media/' + name + (download ? '?download=true' : ''); }
  async function perform(task, success) {
    setBusy(true);
    try { await task(); if (success) setToast(success); return true; }
    catch (error) { if (modal && modal !== 'preview') setFormError(error.message); else setToast(error.message); return false; }
    finally { setBusy(false); }
  }
  async function load(id, target = 'script') {
    const next = id === 'sample' ? sample : await api('/projects/' + id);
    setProject(next); setActive('01'); setFilter('all'); go(target);
  }
  async function action(name, body, message) {
    if (isSample) { open('create'); setToast('请新建项目以使用生成和编辑功能'); return false; }
    return perform(async () => {
      await api('/projects/' + project.id + '/actions/' + name, { method: 'POST', body });
      setProject(await api('/projects/' + project.id));
    }, message);
  }

  const projectPanel = steps.some(s => s.key === page) || page === 'metrics';
  const shots = project.script?.beats || [];
  const readyCount = shots.filter(shot => shot.approved && shot.clip).length;
  const canExport = !isSample && shots.length > 0 && readyCount === shots.length;
  const exporting = project.jobs.some(job => job.kind === 'export' && ['queued', 'running'].includes(job.state));
  const navigation = [{ key: 'projects', icon: LayoutGrid }, { key: 'script', icon: Clapperboard }, { key: 'assets', icon: Layers3 }, { key: 'trends', icon: TrendingUp }];
  const management = [{ key: 'usage', icon: Coins }, { key: 'settings', icon: Settings2 }, ...(session?.operator ? [{ key: 'operations', icon: LayoutGrid }] : [])];
  const modalNames = { create: '新建项目', fact: '添加商品资料', source: '导入商品链接', upload: '上传素材', edit: '编辑分镜', refine: '定向修订分镜', trend: '添加热梗', trendSource: '导入热点来源', csv: '导入投放数据', settle: '结算任务费用', quota: '调整工作空间额度', login: '登录镜序', register: '邀请码注册', preview: '镜头预览' };
  function field(key, label, placeholder, textarea = false, type = 'text') {
    const id = 'field-' + key;
    const error = fieldErrors[key];
    const props = {
      id, name: key, placeholder, value: form[key] ?? '',
      onChange: event => change(key, event.target.value),
      'aria-invalid': error ? true : undefined,
      'aria-describedby': error ? id + '-error' : undefined,
      'aria-required': modal === 'create' && ['name', 'product'].includes(key) ? true : undefined,
    };
    return <div className="field"><label htmlFor={id}>{label}</label>
      {textarea ? <textarea rows={4} {...props}/> : <input type={type} {...props}/>}
      {error && <span className="field-error" id={id + '-error'}>{error}</span>}
    </div>;
  }

  useEffect(() => () => {
    if (voicePreview) URL.revokeObjectURL(voicePreview.url);
  }, [voicePreview]);

  async function previewDialogue() {
    if (!current?.dialogue) return;
    await perform(async () => {
      const response = await fetch('/api/voice/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: current.dialogue }),
      });
      if (!response.ok) throw new Error('暂时无法合成台词');
      const audio = await response.blob();
      setVoicePreview({ url: URL.createObjectURL(audio), key: project.id + current.id + current.dialogue });
    });
  }

  async function save(event) {
    event.preventDefault();
    let done = false;
    setFormError('');
    if (modal === 'create') {
      const errors = {};
      for (const [key, name, limit] of [['name', '项目名称', 100], ['product', '商品资料', 2000], ['audience', '目标受众', 200]]) {
        const value = form[key]?.trim() || '';
        if (!value && key !== 'audience') errors[key] = '请填写' + name;
        else if (value.length > limit) errors[key] = name + '最多 ' + limit + ' 个字符';
      }
      setFieldErrors(errors);
      const first = Object.keys(errors)[0];
      if (first) {
        requestAnimationFrame(() => document.getElementById('field-' + first)?.focus());
        return;
      }
      done = await perform(async () => {
        const { audience, ...details } = form;
        const made = await api('/projects', { method: 'POST', body: audience?.trim() ? { ...details, audience } : details });
        setProjects(await api('/projects'));
        await load(made.id, 'product');
      }, '项目已创建');
    }
    if (modal === 'fact') done = await action('fact', form, '商品资料已添加');
    if (modal === 'source') done = await action('import-product', form, '请核对导入的商品资料');
    if (modal === 'edit') done = await action('edit', form, '分镜已保存');
    if (modal === 'refine') done = await action('refine', form, '修订任务已提交');
    if (modal === 'csv') done = await action('metrics', form, '投放数据已导入');
    if (modal === 'quota') done = await perform(async () => {
      await api('/operations/' + form.id + '/quota', { method: 'PATCH', body: { cents: Math.round(Number(form.amount) * 100) } });
      setOperations(await api('/operations'));
    }, '工作空间额度已更新');
    if (modal === 'settle') done = await action('settle', { job: form.job, cents: form.amount?.trim() ? Math.round(Number(form.amount) * 100) : null }, '已登记实际费用');
    if (modal === 'upload') done = await perform(async () => {
      if (!form.file) throw new Error('请选择图片');
      const body = new FormData();
      body.append('file', form.file); body.append('kind', form.kind || 'product'); body.append('view', form.view || '正面');
      await api('/projects/' + project.id + '/assets', { method: 'POST', body });
      setProject(await api('/projects/' + project.id));
    }, '素材已入库');
    if (modal === 'trend' || modal === 'trendSource') done = await perform(async () => {
      const body = modal === 'trend' ? { ...form, tags: (form.tags || '').split(/[,，]/).filter(Boolean).map(s => s.trim()) } : form;
      await api('/trends', { method: 'POST', body });
      setTrends(await api('/trends'));
    }, '热梗库已更新');
    if (modal === 'login' || modal === 'register') done = await perform(async () => {
      await api('/' + modal, { method: 'POST', body: form });
      setSession(await api('/session')); setRequiresLogin(false); setProjects(await api('/projects'));
      await load('sample', 'projects');
    }, '已进入工作空间');
    if (done) setModal('');
  }

  async function batch(name) {
    if (isSample) { open('create'); return; }
    const candidates = shots.filter(b => name === 'frame' ? !b.frame : b.approved && !b.clip);
    if (!candidates.length) { setToast(name === 'frame' ? '没有待生成首帧的镜头' : '请先审核首帧，或查看已有片段'); return; }
    await perform(async () => {
      let count = 0;
      const failures = [];
      for (const beat of candidates) {
        try { await api('/projects/' + project.id + '/actions/' + name, { method: 'POST', body: { id: beat.id } }); count++; }
        catch (error) { failures.push(error.message); }
      }
      setProject(await api('/projects/' + project.id));
      setToast('已提交 ' + count + ' 个镜头' + (failures.length ? ' · ' + failures[0] : ''));
    });
  }
  function assetAction() { open(isSample ? 'create' : 'upload'); }

  return <div className="app-shell">
    <aside className={'sidebar' + (mobile ? ' mobile-open' : '')}>
      <Logo/>
      <button className="workspace" onClick={() => go('settings')}><span className="workspace-icon"><Layers3 size={17}/></span><span><b>{session?.name || '镜序工作室'}</b><small>制作工作空间</small></span><ChevronDown size={14}/></button>
      <div className="nav-group"><p>创作空间</p>{navigation.map(({ key, icon: Icon }) =>
        <button key={key} className={page === key ? 'nav-item selected' : 'nav-item'} onClick={() => go(key)}><Icon size={17}/>{pageTitle[key]}</button>)}</div>
      <div className="nav-group second"><p>管理</p>{management.map(({ key, icon: Icon }) =>
        <button key={key} className={page === key ? 'nav-item selected' : 'nav-item'} onClick={() => go(key)}><Icon size={17}/>{pageTitle[key]}</button>)}</div>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={() => go('help')}><CircleHelp size={17}/>帮助与文档<ArrowUpRight size={14} className="push"/></button>
        <div className="account"><div className="avatar">{session?.email && session.email !== 'demo' ? session.email[0].toUpperCase() : '镜'}</div><div><b>{session?.email && session.email !== 'demo' ? session.email.split('@')[0] : '镜序创作者'}</b><small>{session?.admin ? '工作空间管理员' : '创作成员'}</small></div><button className="icon-button push" aria-label="账户选项" onClick={() => go('settings')}><MoreHorizontal size={18}/></button></div>
      </div>
    </aside>
    <div className="main">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="菜单" onClick={() => setMobile(!mobile)}><Menu size={20}/></button>
        <div className="breadcrumbs"><button onClick={() => go('projects')}>创作空间</button><ChevronRight size={14}/><b>{pageTitle[page]}</b></div>
        <div className="top-actions"><span className="system-status"><i/>{session?.live ? '供应商模式' : '演示模式'}</span><button className="button primary small" onClick={() => open(requiresLogin ? 'login' : 'create')}><Plus size={16}/>{requiresLogin ? '登录' : '新建项目'}</button></div>
      </header>
      <main className="main-content">
        {projectPanel && <><div className="project-heading"><div><button className="back" onClick={() => go('projects')}><ArrowLeft size={14}/> 所有项目</button><div className="heading-line"><h1>{project.name}</h1><span className="badge status-badge"><i/>{project.export ? '已导出' : isSample ? '示例项目' : '制作中'}</span></div><p className="project-meta"><span><Video size={15}/> 微信视频号</span><span><Frame size={15}/> 9:16 竖屏</span><span><Clock3 size={15}/> 120 秒</span></p></div>
          <div className="heading-actions"><button className="button" onClick={() => go('usage')}><Coins size={16}/> 费用明细</button><button className="button primary" onClick={() => go('export')}><ArrowDownToLine size={16}/> 成片导出</button></div></div>
          <div className="workflow" aria-label="制作步骤">{steps.map(({icon: Icon, ...step}) => {
            const activeStep = page === step.key;
            const completed = step.key === 'product' ? project.facts.some(f => f.confirmed) : step.key === 'assets' ? isSample || project.assets.length : step.key === 'script' ? shots.length : step.key === 'render' ? shots.length && shots.every(b => b.clip) : project.export;
            return <button key={step.key} className={(activeStep ? ' workflow-active' : '') + (completed ? ' workflow-complete' : '')} onClick={() => go(step.key)}><span className="step-icon"><Icon size={17}/></span><span className="step-label"><b>{step.label}</b></span>{completed && !activeStep && <CheckCircle2 className="step-check" size={14}/>}</button>;
          })}</div></>}

        {page === 'script' && <>
          <div className="section-heading"><div><h2>分镜工作台</h2><p>{project.pacing_issues?.length ? `节拍检查 · ${project.pacing_issues.length} 个三秒窗口待复核，首处 ${timecode(project.pacing_issues[0].start)}` : shots.length ? `${shots.length} 个镜头 · ${project.script.trope || '短剧制作'}` : '确认商品资料后生成剧本与分镜'}</p></div><button className="button" disabled={busy} onClick={() => action('script', {}, '剧本生成任务已提交')}><Sparkles size={16}/>{shots.length ? '生成新剧本' : '生成剧本'}</button></div>
          {shots.length ? <Storyboard project={project} current={current} select={setActive}
            filter={filter} setFilter={setFilter} file={file} isSample={isSample} busy={busy} currency={yuan}
            onEdit={() => isSample ? open('create') : open('edit', { ...current })}
            onFrame={() => action('frame', { id: current.id }, '首帧生成任务已提交')}
            onPreview={() => open('preview')} onVoice={previewDialogue} onBudget={() => go('usage')}
            voicePreview={voicePreview?.key === project.id + current.id + current.dialogue ? voicePreview.url : null}/> : <div className="panel blank"><Clapperboard size={32}/><h3>开始制作你的第一条短剧</h3><p>确认商品资料后，即可生成镜头、台词与提示词。</p><button className="button" onClick={() => go('product')}>查看商品资料 <ArrowRight size={16}/></button></div>}
        </>}

        {!projectPanel && <div className="section-heading general-heading"><div><h1>{pageTitle[page]}</h1><p>{({ projects: '打开已有短剧，或从一件商品开始创作。', trends: '管理适用于项目的热点与表达素材。', usage: '查看项目成本和工作空间额度。', operations: '监控工作空间的配额、用量和生成任务。', settings: '管理成员和工作空间访问权限。', help: '了解从商品录入到成片的制作流程。' })[page]}</p></div>{page === 'projects' && <button className="button primary" onClick={() => open(requiresLogin ? 'login' : 'create')}><Plus size={16}/>新建项目</button>}</div>}

        {page === 'projects' && <div className="card-grid">{[...projects, sample].map(item => <button key={item.id} className="panel project-card" onClick={() => perform(() => load(item.id))}>{item.id === 'sample' ? <div className="project-cover" style={{backgroundImage:'url(/still.webp)'}}/> : <div className="project-cover placeholder-cover"><Clapperboard size={30}/></div>}<div><h3>{item.name}</h3><p>{item.id === 'sample' ? '示例项目' : item.export ? '已导出' : '制作中'} <ChevronRight size={15}/></p></div></button>)}</div>}
        {page === 'product' && <><div className="section-heading"><div><h2>商品资料</h2><p>核对规格、宣传信息与优惠条件，确认后生成剧本。</p></div><div className="button-group"><button className="button" onClick={() => open(isSample ? 'create' : 'source')}>导入链接</button><button className="button" onClick={() => open(isSample ? 'create' : 'fact')}><Plus size={16}/>添加资料</button><button className="button primary" disabled={busy} onClick={async () => { if (await action('script', {}, '剧本生成任务已提交')) go('script'); }}><Sparkles size={16}/>生成剧本</button></div></div>
          <div className="panel data-panel">{project.facts.map(fact => <div className="data-row" key={fact.id}><div><h3>{fact.label}</h3><p>{fact.value}</p><small>来源 · {fact.source}</small></div>{fact.confirmed ? <span className="badge product-badge"><Check size={14}/>已确认</span> : <button className="button small" disabled={busy} onClick={() => action('confirm', {id:fact.id}, '资料已确认')}>确认资料</button>}</div>)}</div></>}

        {page === 'assets' && <><div className="section-heading"><div><h2>视觉资产</h2><p>上传商品的实际角度、角色定妆照与场景参考。</p></div><button className="button primary" onClick={assetAction}><UploadCloud size={16}/>上传素材</button></div>{project.assets.length ? <div className="card-grid">{project.assets.map(asset => <div className="panel asset-card" key={asset.id}><img src={file(asset.cutout)} alt={asset.view}/><div><b>{asset.view}</b><span className="badge still-badge">V{asset.version}</span><a href={file(asset.file, true)} className="icon-button push" aria-label="下载素材图"><ArrowDownToLine size={16}/></a></div></div>)}</div> : <div className="panel blank"><Images size={32}/><h3>还没有上传素材</h3><p>可以分别上传商品正面、侧面和细节图片。</p><button className="button" onClick={assetAction}><Plus size={15}/>添加素材</button></div>}</>}

        {page === 'render' && <><div className="section-heading"><div><h2>首帧审核与渲染</h2><p>先批准首帧，再生成对应的动态片段或静帧动效。</p></div><div className="button-group"><button className="button" disabled={busy} onClick={() => batch('frame')}><Images size={16}/>批量生成首帧</button><button className="button primary" disabled={busy} onClick={() => batch('clip')}><Video size={16}/>渲染已审核</button></div></div>
          <div className="panel data-panel">{shots.length ? shots.map(shot => <div className="data-row render-row" key={shot.id}><button className="render-thumb" style={{backgroundImage: shot.frame ? 'url('+file(shot.frame)+')' : undefined}} aria-label="查看镜头" onClick={() => { setActive(shot.id); open('preview'); }}>{!shot.frame && <Frame size={17}/>}</button><div className="flex"><h3>{shot.id} · {shot.title}</h3><small>{timecode(shot.start)}–{timecode(shot.end)} · {shot.product ? '商品实拍' : shot.dynamic ? '动态' : '静帧'}</small></div><span className={'badge ' + (shot.approved ? 'product-badge' : 'still-badge')}>{shot.clip ? '已渲染' : shot.approved ? '已审核' : shot.frame ? '待审核' : '待生成'}</span><div className="button-group">{shot.frame && !shot.approved && <button className="button small" disabled={busy} onClick={() => action('approve', {id:shot.id}, '首帧已审核')}>审核通过</button>}<button className="button small" disabled={busy} onClick={() => action(shot.approved ? 'clip' : 'frame', {id:shot.id}, '生成任务已提交')}>{shot.clip ? '重算片段' : shot.approved ? '渲染片段' : shot.frame ? '重算首帧' : '生成首帧'}</button></div></div>) : <div className="blank">请先生成剧本</div>}</div></>}

        {page === 'export' && <><div className="section-heading"><div><h2>成片导出</h2><p>导出 1080 × 1920 · 120 秒 MP4。</p></div><button className="button" onClick={() => go('metrics')}><TrendingUp size={16}/>投放数据</button></div><div className="panel blank">{project.export ? <><video className="export-video" src={file(project.export)} controls/><h3>成片已生成</h3><p className="mono">{project.export}</p><button className="button primary" onClick={() => perform(async () => { const {url} = await api('/projects/' + project.id + '/download'); window.location.assign(url); })}><ArrowDownToLine size={16}/>下载 MP4</button></> : <><Video size={33}/><h3>{readyCount} / {shots.length || 12} 个镜头已生成</h3><p>{isSample ? '新建项目后可以生成并导出成片。' : !canExport ? '审核并渲染全部镜头后，即可合成。' : '已完成所有镜头，可以开始合成。'}</p><div className="button-group">
          {!canExport && <button className="button" onClick={() => isSample ? open('create') : go(shots.length ? 'render' : 'product')}>{isSample ? '新建项目' : shots.length ? '前往审核与渲染' : '前往商品资料'}</button>}
          <button className="button primary" disabled={busy || !canExport || exporting} onClick={() => action('export', {}, '成片合成任务已提交')}><Sparkles size={16}/>{exporting ? '合成中…' : '合成成片'}</button></div></>}</div></>}

        {page === 'metrics' && <><div className="section-heading"><div><h2>投放数据</h2><p>按导出版本汇总观看、点击与成交。</p></div><button className="button primary" onClick={() => open(isSample ? 'create' : 'csv')}><UploadCloud size={16}/>导入 CSV</button></div><div className="panel data-panel">{project.metrics.length ? project.metrics.map(row => <div className="data-row" key={row.version+row.date}><div><h3>{row.date}</h3><small>{row.version}</small></div><p>3 秒留存 {percent(row.retained_3s, row.impressions)} · 中段留存 {percent(row.mid_views, row.impressions)} · 点击 {row.clicks} · 成交 {row.orders}</p></div>) : <div className="blank"><TrendingUp size={30}/><h3>还没有投放记录</h3><p>请使用成片文件名关联 CSV 数据。</p></div>}</div></>}

        {page === 'trends' && <><div className="button-group toolbar"><button className="button" onClick={() => open('trendSource')}>导入授权源</button><button className="button primary" onClick={() => open('trend', {date:new Date().toISOString().slice(0,10)})}><Plus size={16}/>添加热梗</button></div><div className="panel data-panel">{trendList.length ? trendList.map(item => <div className="data-row" key={item.text}><div><h3>{item.text}</h3><p>{item.source} · {item.tags.join(' / ')}</p></div><small>到期 {item.expires}</small></div>) : <div className="blank"><TrendingUp size={30}/><h3>还没有热点素材</h3><p>可以手工添加，也可以同步已配置的授权来源。</p></div>}</div></>}

        {page === 'usage' && <><div className="stat-grid">{[['项目已结算', project.spent, Coins], ['项目占额', project.committed, Clock3], ['工作空间可用', workspace ? workspace.quota-workspace.spent-workspace.committed : 0, Box]].map(([label, amount, Icon]) => <div className="panel stat" key={label}><Icon size={18}/><p>{label}</p><strong>{yuan(amount)}</strong></div>)}</div><div className="section-heading"><div><h2>项目费用明细</h2><p>{project.name}</p></div></div><JobList project={project} session={session} onResume={id => action('resume', {job:id}, '已重新查询原订单')} onSettle={id => open('settle', {job:id})}/></>}
        {page === 'operations' && <div className="panel data-panel">{operations.map(item => <div className="data-row" key={item.id}><div><h3>{item.name}</h3><p>结算 {yuan(item.spent)} · 占额 {yuan(item.committed)} · 运行 {item.pending} · 待核对 {item.uncertain}</p></div><button className="button small" onClick={() => open('quota', {id:item.id,amount:(item.quota/100).toFixed(2)})}>额度 {yuan(item.quota)} · 调整</button></div>)}</div>}
        {page === 'settings' && <div className="panel data-panel"><div className="data-row"><div><h3>{session?.name || '镜序工作室'}</h3><p>{session?.email === 'demo' ? '本地演示工作空间' : session?.email || '尚未登录'}</p></div><div className="button-group">{!session || session.email === 'demo' ? <><button className="button" onClick={()=>open('login')}>登录</button><button className="button primary" onClick={()=>open('register')}>邀请码注册</button></> : <button className="button" onClick={()=>perform(async()=>{ await api('/logout',{method:'POST'}); window.location.reload(); })}>退出登录</button>}</div></div>{session?.admin && session.email !== 'demo' && <div className="data-row"><div><h3>邀请制作成员</h3><p>{invite ? '邀请码 · '+invite : '邀请码单次有效，24 小时后过期。'}</p></div><button className="button" disabled={busy} onClick={()=>perform(async()=>setInvite((await api('/workspace/invites',{method:'POST'})).code),'邀请码已生成')}>生成邀请码</button></div>}{workspace?.members?.map(member=><div className="data-row" key={member.email}><b>{member.email}</b><span className="badge still-badge">{member.admin?'管理员':'制作成员'}</span></div>)}</div>}
        {page === 'help' && <div className="panel data-panel">{steps.map((step,i) => <div className="data-row" key={step.key}><div><h3>{i+1}. {step.label}</h3><p>{['录入并确认商品信息。','上传角色、场景或商品参考。','生成并编辑 120 秒的短剧。','审核每个首帧后生成片段。','合成竖屏成片并下载。'][i]}</p></div><button className="button small" onClick={() => go(step.key)}>打开 <ArrowRight size={14}/></button></div>)}</div>}
        {['script','render','export'].includes(page) && !isSample && project.jobs.length > 0 && <div className="recent"><h3>最近生成任务</h3><JobList project={{...project,jobs:project.jobs.slice(-6)}} session={session} onResume={id => action('resume',{job:id},'已重新查询原订单')} onSettle={id => open('settle',{job:id})}/></div>}
      </main>
    </div>
    {toast && <div className="toast" role="status"><span>{toast}</span><button className="icon-button" aria-label="关闭通知" onClick={()=>setToast('')}><X size={16}/></button></div>}
    <Dialog.Root open={Boolean(modal || requiresLogin)} onOpenChange={opened => { if (!opened && !requiresLogin) setModal(''); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-backdrop"/>
        <Dialog.Content className={'modal panel' + (modal === 'preview' ? ' preview-modal' : '')}
          aria-describedby={undefined}
          onCloseAutoFocus={event => {
            if (modalTrigger.current?.isConnected) {
              event.preventDefault();
              modalTrigger.current.focus();
            }
            modalTrigger.current = null;
          }}
          onEscapeKeyDown={event => { if (requiresLogin) event.preventDefault(); }}
          onInteractOutside={event => { if (requiresLogin) event.preventDefault(); }}>
          <div className="panel-heading"><Dialog.Title asChild><h3>{modalNames[modal || 'login']}</h3></Dialog.Title>{!requiresLogin && <Dialog.Close className="icon-button" aria-label="关闭"><X size={20}/></Dialog.Close>}</div>
        {modal === 'preview' ? <div className="modal-body">{current?.clip ? <video className="export-video" src={file(current.clip)} controls autoPlay/> : isSample || current?.frame ? <img className="preview-image" src={isSample ? storyboardStill : file(current.frame)} alt={current?.title || '示例首帧'}/> : <p>该镜头尚未生成首帧。</p>}</div> :
          <form onSubmit={save} className="modal-body">
            {formError && <p role="alert" className="form-error">{formError}</p>}
            {modal === 'create' && <>{field('name','项目名称','例如：反转厨房')}{field('product','商品资料','填写商品特点、规格和来源',true)}{field('audience','目标受众','例如：视频号·家庭日常')}</>}
            {modal === 'fact' && <>{field('label','资料项','例如：容量')}{field('value','资料内容','例如：300 mL',true)}{field('source','信息来源','例如：实拍包装正面')}</>}
            {(modal === 'source' || modal === 'trendSource') && field('url','授权链接','https://')}
            {modal === 'upload' && <><label className="field">素材分类<select value={form.kind || 'product'} onChange={e=>change('kind',e.target.value)}><option value="product">商品</option><option value="character">角色</option><option value="scene">场景</option></select></label>{field('view','素材视角或名称','例如：正面')}<label className="field">上传图片<input type="file" accept="image/*" onChange={e=>change('file',e.target.files[0])}/></label></>}
            {modal === 'edit' && <>{field('title','镜头标题','')}{field('description','画面描述','',true)}{field('dialogue','台词','',true)}{field('prompt','首帧提示词','',true)}{field('motion','动态提示词','',true)}{field('hook','节拍钩子','')}<label className="check-field"><input type="checkbox" checked={!!form.dynamic} onChange={e=>change('dynamic',e.target.checked)}/>使用动态生成</label>{project.assets.map(asset=><label className="check-field" key={asset.id}><input type="checkbox" checked={form.asset_ids?.includes(asset.id)} onChange={e=>change('asset_ids',e.target.checked?[...(form.asset_ids||[]),asset.id]:(form.asset_ids||[]).filter(id=>id!==asset.id))}/>{asset.view} · V{asset.version}</label>)}</>}
            {modal === 'refine' && field('notes','修订意见','例如：让商品等到角色需要时再自然出现',true)}
            {modal === 'trend' && <>{field('text','热梗内容','')}{field('source','来源','')}{field('date','发布日期','',false,'date')}{field('expires','到期日期','',false,'date')}{field('tags','适用标签','家庭，职场')}</>}
            {modal === 'csv' && <>{field('csv','粘贴 CSV','version,date,impressions,retained_3s,mid_views,clicks,orders',true)}<label className="field">或读取 CSV 文件<input type="file" accept=".csv,text/csv" onChange={async e=>{ if(e.target.files[0]) change('csv',await e.target.files[0].text()); }}/></label></>}
            {modal === 'settle' && field('amount','实际费用（元）','0.00',false,'text')}{modal === 'quota' && field('amount','工作空间额度（元）','0.00',false,'text')}
            {(modal === 'login' || modal === 'register' || (!modal && requiresLogin)) && <>{field('email','邮箱','name@example.com',false,'email')}{field('password','密码','至少 10 个字符',false,'password')}{modal === 'register' && <>{field('code','邀请码','')}{field('workspace','工作空间名称','新建工作空间时填写')}</>}<button type="button" className="text-link" onClick={()=>{ setModal(modal==='register'?'login':'register'); }}>{modal==='register'?'返回登录':'使用邀请码注册'}</button></>}
            <div className="modal-actions">{modal === "edit" && <button type="button" className="button" onClick={()=>open("refine",{id:form.id})}><Sparkles size={15}/>自动修订本镜</button>}{!requiresLogin && <button className="button" type="button" onClick={()=>setModal('')}>取消</button>}<button className="button primary" type={requiresLogin && !modal ? 'button' : 'submit'} disabled={busy} onClick={requiresLogin && !modal ? ()=>setModal('login') : undefined}>{busy ? '处理中…' : requiresLogin && !modal ? '继续登录' : modal === 'login' ? '登录' : '确认'}</button></div>
          </form>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  </div>;
}

function JobList({ project, session, onResume, onSettle }) {
  return <div className="panel data-panel">{project.jobs.length ? [...project.jobs].reverse().map(job => <div className="data-row" key={job.id}><div><h3>{kindNames[job.kind]}</h3><small>{job.result?.message || new Date(job.created*1000).toLocaleString('zh-CN')}</small></div><div className="button-group"><span className={'badge '+(job.state==='done'?'product-badge':'still-badge')}>{stateNames[job.state]}</span><span className="mono">{yuan(job.spent || job.reserved)}</span>{job.state==='uncertain' && job.result?.order && <button className="button small" onClick={()=>onResume(job.id)}>查询订单</button>}{session?.live && session.admin && job.reserved > 0 && ['done','failed','uncertain'].includes(job.state) && <button className="button small" onClick={()=>onSettle(job.id)}>登记结算</button>}</div></div>) : <div className="blank"><Coins size={28}/><h3>暂无生成账目</h3><p>提交生成任务后，可在这里查看占额与结算。</p></div>}</div>;
}
