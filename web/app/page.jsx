'use client';

import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import Storyboard, { storyboardStill, timecode } from './storyboard';
import StudioLighting, { SidebarMirror } from './studio-lighting';
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
const projectPages = new Set([...steps.map(step => step.key), 'metrics']);
const homeRoute = { page: 'projects', projectId: null, shot: '01', filter: 'all' };
const kindNames = { script: '剧本生成', frame: '首帧生成', clip: '片段渲染', portrait: '角色定妆', export: '成片合成' };
const stateNames = { queued: '排队中', running: '处理中', done: '已完成', failed: '失败', uncertain: '待核对' };
const sourceNames = { deepseek: 'DeepSeek API', ark_image: '火山方舟 · 生图', ark_video: '火山方舟 · 生视频', ark_reference: '火山方舟 · 尾帧导入', cloud_image: 'Cloudflare Workers AI · 免费额度', local: '本机处理', demo: '演示' };
const roleNames = { owner: '空间主账号', admin: '空间管理员', member: '创作成员' };
const yuan = value => '¥' + ((value || 0) / 100).toFixed(2);

function readRoute(search) {
  const params = new URLSearchParams(search);
  const page = params.get('page');
  const space = params.get('workspace');
  const workspaceId = space === 'demo' || /^[a-f0-9]{32}$/.test(space || '') ? space : null;
  const home = { ...homeRoute, workspaceId };
  if (!Object.hasOwn(pageTitle, page) || page === 'projects') return home;
  const id = params.get('project');
  const projectId = (projectPages.has(page) || page === 'usage') &&
    (id === 'sample' || /^[a-f0-9]{32}$/.test(id || '')) ? id : null;
  if (!projectId && projectPages.has(page)) return home;
  const shot = params.get('shot');
  const filter = params.get('filter');
  return { page, projectId, workspaceId, shot: projectId && /^\d{2}$/.test(shot || '') ? shot : '01',
    filter: projectId && ['dynamic', 'product'].includes(filter) ? filter : 'all' };
}

function routeUrl(route) {
  const params = new URLSearchParams();
  if (route.workspaceId) params.set('workspace', route.workspaceId);
  if (route.page !== 'projects') params.set('page', route.page);
  if (route.projectId) {
    params.set('project', route.projectId);
    if (route.shot !== '01') params.set('shot', route.shot);
    if (route.filter !== 'all') params.set('filter', route.filter);
  }
  return params.size ? '/?' + params : '/';
}

function scopedUrl(url, workspaceId) {
  if (!workspaceId) return url;
  return url + (url.includes('?') ? '&' : '?') + 'workspace=' + encodeURIComponent(workspaceId);
}

async function requestJson(url, options = {}) {
  const body = options.body;
  const result = await fetch('/api' + url, {
    ...options,
    headers: body instanceof FormData || !body ? {} : { 'Content-Type': 'application/json' },
    body: body instanceof FormData || !body ? body : JSON.stringify(body),
  });
  if (!result.ok) {
    const error = await result.json().catch(() => ({}));
    throw Object.assign(new Error(typeof error.detail === 'string' ? error.detail : '请求失败，请稍后再试'), { status: result.status });
  }
  return result.json();
}

function percent(value, denominator) {
  return denominator ? (100 * value / denominator).toFixed(1) + '%' : '—';
}

function Logo({ onHome, workspaceId }) {
  return <a className="brand" href={routeUrl({ ...homeRoute, workspaceId })} aria-label="镜序首页" onClick={event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onHome();
  }}><span className="brand-icon"><ScanLine size={22} strokeWidth={2.1}/></span><span><strong>镜序</strong><small>JINGXU STUDIO</small></span></a>;
}

export default function Workbench() {
  const [route, setRoute] = useState({ ...homeRoute, workspaceId: null });
  const { page, projectId, workspaceId, shot: active, filter } = route;
  const currentRoute = useRef(route);
  const lastProjectId = useRef(null);
  const workspaceSurface = useRef(null);
  const sidebarSurface = useRef(null);
  const mobileToggle = useRef(null);
  const workspaceToggle = useRef(null);
  const workspacePicker = useRef(null);
  const [workspaceMenu, setWorkspaceMenu] = useState(false);
  const [snapshot, setProject] = useState(null);
  const [projects, setProjects] = useState(null);
  const [projectError, setProjectError] = useState(null);
  const [projectsError, setProjectsError] = useState('');
  const [trendList, setTrends] = useState([]);
  const [operations, setOperations] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [requiresLogin, setRequiresLogin] = useState(false);
  const [modal, setModal] = useState('');
  const modalTrigger = useRef(null);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [form, setForm] = useState({});
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [voicePreview, setVoicePreview] = useState(null);
  const [invite, setInvite] = useState('');
  const api = (url, options) => requestJson(scopedUrl(url, workspaceId), options);
  const project = projectId === 'sample' ? sample : snapshot?.id === projectId ? snapshot : null;
  const current = project?.script?.beats.find(b => b.id === active) || project?.script?.beats[0];
  const isSample = projectId === 'sample';

  function navigate(destination, mode = 'push') {
    const previous = currentRoute.current;
    const next = { workspaceId: previous.workspaceId, ...destination };
    if (next.workspaceId !== previous.workspaceId) {
      lastProjectId.current = null;
      setProject(null); setProjects(null); setWorkspace(null); setTrends([]); setOperations([]);
      setInvite(''); setVoicePreview(null); setToast(''); setProjectsError(''); setProjectError(null); setAuthError('');
      setSession(null); setAuthLoading(true); setModal('');
    }
    const url = routeUrl(next);
    if (url !== window.location.pathname + window.location.search) {
      window.history[mode === 'replace' ? 'replaceState' : 'pushState'](null, '', url);
      if (mode === 'push') window.scrollTo(0, 0);
    }
    currentRoute.current = next;
    if (next.projectId) lastProjectId.current = next.projectId;
    setRoute(next);
    setMobile(false);
    setWorkspaceMenu(false);
  }

  useEffect(() => {
    const restore = () => {
      const next = readRoute(window.location.search);
      navigate(next, 'replace');
      setModal(name => ['login', 'register'].includes(name) ? name : '');
    };
    restore();
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const fresh = () => !controller.signal.aborted && currentRoute.current.workspaceId === workspaceId;
    api('/session', { signal: controller.signal }).then(data => {
      if (fresh()) { setSession(data); setRequiresLogin(false); }
    }).catch(error => {
      if (!fresh()) return;
      if (error.status === 401) { setRequiresLogin(true); setModal('login'); }
      else if (error.status === 403 && workspaceId) {
        navigate({ ...homeRoute, workspaceId: null }, 'replace');
        setToast('这个工作空间不可用，已打开默认空间。');
      }
      else setAuthError(error.message);
    }).finally(() => { if (fresh()) setAuthLoading(false); });
    return () => controller.abort();
  }, [workspaceId]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4600);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!workspaceMenu) return;
    const dismiss = event => { if (!workspacePicker.current?.contains(event.target)) setWorkspaceMenu(false); };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [workspaceMenu]);
  useEffect(() => {
    if (!mobile) return;
    const narrow = window.matchMedia('(max-width: 850px)');
    const closeWhenWide = () => { if (!narrow.matches) setMobile(false); };
    const escape = event => { if (event.key === 'Escape') closeMobileMenu(); };
    closeWhenWide();
    if (narrow.matches) {
      const panel = sidebarSurface.current;
      (panel.querySelector('[aria-current]') || panel.querySelector('.nav-item'))?.focus();
    }
    narrow.addEventListener('change', closeWhenWide);
    window.addEventListener('keydown', escape);
    return () => { narrow.removeEventListener('change', closeWhenWide); window.removeEventListener('keydown', escape); };
  }, [mobile]);
  useEffect(() => {
    if (!session || !projectId || isSample) return;
    const controller = new AbortController();
    const url = '/projects/' + projectId;
    const update = next => {
      if (!controller.signal.aborted && currentRoute.current.projectId === projectId && currentRoute.current.workspaceId === workspaceId) setProject(next);
    };
    const refresh = () => api(url, { signal: controller.signal }).then(update);
    setProjectError(null);
    refresh().catch(error => {
      if (controller.signal.aborted || currentRoute.current.projectId !== projectId || currentRoute.current.workspaceId !== workspaceId) return;
      if (error.status === 401) { setSession(null); setRequiresLogin(true); open('login'); }
      else if (error.status === 403 || error.status === 404) {
        lastProjectId.current = null;
        navigate(homeRoute, 'replace');
        setToast('项目不可用，请在首页重新选择。');
      } else setProjectError({ id: projectId, message: error.message });
    });
    const stream = new EventSource(scopedUrl('/api' + url + '/events', workspaceId));
    stream.onmessage = event => update(JSON.parse(event.data));
    // Also refresh through the snapshot endpoint if streaming is buffered by a proxy.
    const timer = setInterval(() => refresh().catch(() => {}), 3500);
    return () => { controller.abort(); stream.close(); clearInterval(timer); };
  }, [projectId, isSample, session, workspaceId]);
  useEffect(() => {
    if (!session) return;
    const controller = new AbortController();
    const request = (url, apply, failed = error => setToast(error.message)) => api(url, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted && currentRoute.current.workspaceId === workspaceId) apply(data); })
      .catch(error => { if (!controller.signal.aborted && currentRoute.current.workspaceId === workspaceId) failed(error); });
    if (page === 'trends') request('/trends', setTrends);
    if ((page === 'usage' || page === 'settings') && session.admin) request('/workspace', setWorkspace);
    if (page === 'operations' && session.operator) request('/operations', setOperations);
    else if (page === 'operations') navigate(homeRoute, 'replace');
    if (page === 'projects') {
      setProjectsError('');
      request('/projects', setProjects, error => setProjectsError(error.message));
    }
    return () => controller.abort();
  }, [page, session, workspaceId]);

  function switchWorkspace(id) {
    if (id === session?.workspace) { setWorkspaceMenu(false); workspaceToggle.current?.focus(); return; }
    navigate({ ...homeRoute, workspaceId: id });
    requestAnimationFrame(() => {
      const target = window.matchMedia('(max-width: 850px)').matches ? mobileToggle : workspaceToggle;
      target.current?.focus();
    });
  }

  function go(next) {
    if (next === 'projects') { navigate(homeRoute); return; }
    const current = currentRoute.current;
    const id = projectPages.has(next) ? current.projectId || lastProjectId.current : next === 'usage' ? current.projectId : null;
    if (projectPages.has(next) && !id) {
      navigate(homeRoute);
      setToast('请先打开一个项目。');
      return;
    }
    navigate({ ...(id && id === current.projectId ? current : homeRoute), page: next, projectId: id });
  }
  function closeMobileMenu() {
    setMobile(false);
    setWorkspaceMenu(false);
    requestAnimationFrame(() => mobileToggle.current?.focus());
  }
  function setActive(shot) { navigate({ ...currentRoute.current, shot }, 'replace'); }
  function setFilter(filter) { navigate({ ...currentRoute.current, filter }, 'replace'); }
  function open(name, data = {}) {
    if (!modal) modalTrigger.current = document.activeElement;
    setForm(data);
    setFieldErrors({});
    setFormError('');
    setModal(name);
  }
  function openWorkspaceAction(name) {
    open(name);
    modalTrigger.current = workspaceToggle.current;
    setWorkspaceMenu(false);
  }
  function createInvitation() {
    return perform(async () => {
      const { code } = await api('/workspace/invites', { method: 'POST' });
      if (currentRoute.current.workspaceId === workspaceId) setInvite(code);
    }, '邀请码已生成');
  }
  function change(key, value) {
    setForm(previous => ({ ...previous, [key]: value }));
    setFieldErrors(previous => ({ ...previous, [key]: undefined }));
    setFormError('');
  }
  function file(name, download = false) { return scopedUrl('/api/projects/' + project.id + '/media/' + name + (download ? '?download=true' : ''), workspaceId); }
  async function perform(task, success) {
    setBusy(true);
    try { await task(); if (success && currentRoute.current.workspaceId === workspaceId) setToast(success); return true; }
    catch (error) {
      if (currentRoute.current.workspaceId === workspaceId) {
        if (modal && modal !== 'preview') setFormError(error.message); else setToast(error.message);
      }
      return false;
    }
    finally { setBusy(false); }
  }
  function load(id, target = 'script') {
    navigate({ ...homeRoute, projectId: id, page: target });
  }
  async function refreshProject(id) {
    const next = await api('/projects/' + id);
    if (currentRoute.current.projectId === id && currentRoute.current.workspaceId === workspaceId) setProject(next);
  }
  async function action(name, body, message) {
    if (!project) return false;
    if (isSample) { open('create'); setToast('请新建项目以使用生成和编辑功能'); return false; }
    const applied = await perform(async () => {
      await api('/projects/' + project.id + '/actions/' + name, { method: 'POST', body });
      await refreshProject(project.id);
    }, message);
    return applied && currentRoute.current.projectId === project.id && currentRoute.current.workspaceId === workspaceId;
  }

  const projectPanel = projectPages.has(page);
  const sidebarPage = projectPanel && page !== 'assets' ? 'script' : page;
  const pageError = authError || (!project && projectId && projectError?.id === projectId ? projectError.message : '');
  const pageLoading = authLoading || (Boolean(projectId) && !project && !pageError && !requiresLogin);
  const shots = project?.script?.beats || [];
  const fullDynamic = project?.render_settings?.full_dynamic === true;
  const renderedClip = shot => shot.approved && shot.clip && (!fullDynamic || shot.clip_dynamic);
  const readyCount = shots.filter(renderedClip).length;
  const canExport = !isSample && shots.length > 0 && readyCount === shots.length && (!fullDynamic || shots.every(shot => shot.clip_reviewed));
  const modelOptions = project?.render_models;
  const settings = project?.render_settings;
  const videoRates = modelOptions?.video[settings?.video]?.rates;
  const portraitReserve = Number.isInteger(videoRates?.['480p']) ? videoRates['480p'] * 4 + modelOptions.local_clip_cents : null;
  const usageStats = [
    ...(project ? [['项目已结算', project.spent, Coins], ['项目占额', project.committed, Clock3]] : []),
    ...(session?.admin ? [['工作空间可用', workspace ? workspace.quota - workspace.spent - workspace.committed : null, Box]] : []),
  ];
  function clipEstimate(shot) {
    const rate = videoRates?.[settings?.resolution];
    return Number.isInteger(rate) ? rate * (shot.end - shot.start) + modelOptions.local_clip_cents : 0;
  }
  const exporting = project?.jobs.some(job => job.kind === 'export' && ['queued', 'running'].includes(job.state));
  const navigation = [{ key: 'projects', icon: LayoutGrid }, { key: 'script', icon: Clapperboard }, { key: 'assets', icon: Layers3 }, { key: 'trends', icon: TrendingUp }];
  const management = [{ key: 'usage', icon: Coins }, { key: 'settings', icon: Settings2 }, ...(session?.operator ? [{ key: 'operations', icon: LayoutGrid }] : [])];
  const visualPlan = project?.script?.visual;
  const modalNames = { create: '新建项目', createWorkspace: '新建工作空间', joinWorkspace: '加入工作空间', direction: '创作要求', fact: '添加商品资料', source: '导入商品链接', upload: '上传素材', portrait: '生成角色定妆', portraitImport: '导入方舟尾帧', edit: '编辑分镜', refine: '定向修订分镜', trend: '添加热梗', trendSource: '导入热点来源', csv: '导入投放数据', settle: '结算任务费用', quota: '调整工作空间额度', login: '登录镜序', register: '邀请码注册', preview: '镜头预览' };
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
      const response = await fetch(scopedUrl('/api/voice/preview', workspaceId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: current.dialogue }),
      });
      if (!response.ok) throw new Error('暂时无法合成台词');
      const audio = await response.blob();
      if (currentRoute.current.workspaceId === workspaceId) setVoicePreview({ url: URL.createObjectURL(audio), key: project.id + current.id + current.dialogue });
    });
  }

  async function save(event) {
    event.preventDefault();
    let done = false;
    setFormError('');
    if (modal === 'createWorkspace' || modal === 'joinWorkspace') {
      await perform(async () => {
        const creating = modal === 'createWorkspace';
        const made = await api(creating ? '/workspaces' : '/workspaces/join', { method: 'POST', body: form });
        if (currentRoute.current.workspaceId === workspaceId) {
          switchWorkspace(made.id);
          setToast(creating ? '工作空间已创建' : '已加入工作空间');
        }
      });
      return;
    }
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
        if (currentRoute.current.workspaceId === workspaceId) load(made.id, 'product');
      }, '项目已创建');
    }
    if (modal === 'fact') done = await action('fact', form, '商品资料已添加');
    if (modal === 'direction') done = await action('direction', form, '创作要求已保存，下次生成时生效');
    if (modal === 'source') done = await action('import-product', form, '请核对导入的商品资料');
    if (modal === 'edit') done = await action('edit', form, '分镜已保存');
    if (modal === 'portrait' || modal === 'portraitImport') done = await action('portrait', form, '角色资产任务已提交');
    if (modal === 'refine') done = await action('refine', form, '修订任务已提交');
    if (modal === 'csv') done = await action('metrics', form, '投放数据已导入');
    if (modal === 'quota') done = await perform(async () => {
      await api('/operations/' + form.id + '/quota', { method: 'PATCH', body: { cents: Math.round(Number(form.amount) * 100) } });
      const updated = await api('/operations');
      if (currentRoute.current.workspaceId === workspaceId) setOperations(updated);
    }, '工作空间额度已更新');
    if (modal === 'settle') done = await action('settle', { job: form.job, cents: form.amount?.trim() ? Math.round(Number(form.amount) * 100) : null }, '已登记实际费用');
    if (modal === 'upload') done = await perform(async () => {
      if (!form.file) throw new Error('请选择图片');
      const body = new FormData();
      body.append('file', form.file); body.append('kind', form.kind || 'product'); body.append('view', form.view || '正面');
      await api('/projects/' + project.id + '/assets', { method: 'POST', body });
      await refreshProject(project.id);
    }, '素材已入库');
    if (modal === 'trend' || modal === 'trendSource') done = await perform(async () => {
      const body = modal === 'trend' ? { ...form, tags: (form.tags || '').split(/[,，]/).filter(Boolean).map(s => s.trim()) } : form;
      await api('/trends', { method: 'POST', body });
      const updated = await api('/trends');
      if (currentRoute.current.workspaceId === workspaceId) setTrends(updated);
    }, '热梗库已更新');
    if (modal === 'login' || modal === 'register') done = await perform(async () => {
      await api('/' + modal, { method: 'POST', body: form });
      setProject(null); setProjects(null); setWorkspace(null);
      try { setSession(await api('/session')); }
      catch (error) { if (error.status !== 403 || !workspaceId) throw error; switchWorkspace(null); }
      setRequiresLogin(false);
    }, '已进入工作空间');
    if (done && currentRoute.current.workspaceId === workspaceId) setModal('');
  }

  async function batch(name) {
    if (isSample) { open('create'); return; }
    if (name === 'clip' && fullDynamic) {
      const pending = shots.filter(shot => !renderedClip(shot));
      if (!pending.length) { setToast('全动态镜头已完成，可逐镜复核'); return; }
      if (pending.some(shot => !shot.approved || !shot.frame)) { setToast('请先审核所有待渲染镜头的首帧'); return; }
      const estimate = pending.reduce((total, shot) => total + clipEstimate(shot), 0);
      if (window.confirm(`提交 ${pending.length} 个动态镜头，预计共预留 ${yuan(estimate)}，实际费用以方舟账单为准。`)) {
        await action('render-all-dynamic', {}, '整批动态镜头已入队');
      }
      return;
    }
    const candidates = shots.filter(b => name === 'frame' ? !b.frame : b.approved && !b.clip);
    if (!candidates.length) { setToast(name === 'frame' ? '没有待生成首帧的镜头' : '请先审核首帧，或查看已有片段'); return; }
    await perform(async () => {
      let count = 0;
      const failures = [];
      for (const beat of candidates) {
        try { await api('/projects/' + project.id + '/actions/' + name, { method: 'POST', body: { id: beat.id } }); count++; }
        catch (error) { failures.push(error.message); }
      }
      await refreshProject(project.id);
      setToast('已提交 ' + count + ' 个镜头' + (failures.length ? ' · ' + failures[0] : ''));
    });
  }
  function assetAction() { open(isSample ? 'create' : 'upload'); }
  function selectPortraitRole(id) {
    const role = visualPlan?.characters.find(character => character.id === id);
    if (!role) { change('role', ''); return; }
    setForm({ role: id, name: role.name, description: `${visualPlan.setting}。${role.appearance}，穿${role.wardrobe}。` });
    setFormError('');
  }
  function renderShot(shot) {
    const estimate = clipEstimate(shot);
    if (fullDynamic && shot.approved && !window.confirm(`提交第 ${shot.id} 镜，预计预留 ${yuan(estimate)}。`)) return;
    return action(shot.approved ? 'clip' : 'frame', {id: shot.id}, '生成任务已提交');
  }
  function resolveCloud(job) {
    if (window.confirm('请先核对 Cloudflare 任务。确认后可重新提交，可能再次消耗免费额度。')) {
      return action('resolve-cloud', {job, confirmed: true}, '已结束待核对任务');
    }
  }

  return <div className="app-shell">
    <aside className={'sidebar' + (mobile ? ' mobile-open' : '')} id="workbench-sidebar" ref={sidebarSurface} aria-label="工作空间导航">
      <SidebarMirror activePage={sidebarPage}/>
      <Logo onHome={() => go('projects')} workspaceId={workspaceId}/>
      <div className="workspace-picker" ref={workspacePicker} onKeyDown={event => {
        if (event.key === 'Escape' && workspaceMenu) { event.stopPropagation(); setWorkspaceMenu(false); workspaceToggle.current?.focus(); }
      }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setWorkspaceMenu(false); }}>
        <button className="workspace" ref={workspaceToggle} aria-expanded={workspaceMenu} aria-controls="workspace-choices"
          onClick={() => setWorkspaceMenu(value => !value)}>
          <span className="workspace-icon"><Layers3 size={17}/></span><span><b title={session?.name}>{session?.name || '镜序工作室'}</b><small>切换工作空间</small></span><ChevronDown size={14}/>
        </button>
        {workspaceMenu && <div className="workspace-choices" id="workspace-choices">
          {session?.workspaces?.map(space => <button className="workspace-option" aria-current={space.id === session.workspace ? 'true' : undefined} key={space.id} onClick={() => switchWorkspace(space.id)}>
            <span><b>{space.name}</b><small>{roleNames[space.role]}</small></span>{space.id === session.workspace && <Check size={15}/>}
          </button>)}
          <div className="workspace-menu-actions">
            {session?.canCreateWorkspace && <button onClick={() => openWorkspaceAction('createWorkspace')}><Plus size={15}/>新建工作空间</button>}
            {session && session.email !== 'demo' && <button onClick={() => openWorkspaceAction('joinWorkspace')}><Layers3 size={15}/>使用邀请码加入</button>}
            <button onClick={() => go('settings')}><Settings2 size={15}/>工作空间设置</button>
          </div>
        </div>}
      </div>
      <div className="nav-group"><p>创作空间</p>{navigation.map(({ key, icon: Icon }) =>
        <button key={key} className={sidebarPage === key ? 'nav-item selected' : 'nav-item'} aria-current={sidebarPage === key ? (page === key ? 'page' : 'location') : undefined} onClick={() => go(key)}><Icon size={17}/>{pageTitle[key]}</button>)}</div>
      <div className="nav-group second"><p>管理</p>{management.map(({ key, icon: Icon }) =>
        <button key={key} className={page === key ? 'nav-item selected' : 'nav-item'} aria-current={page === key ? 'page' : undefined} onClick={() => go(key)}><Icon size={17}/>{pageTitle[key]}</button>)}</div>
      <div className="sidebar-bottom">
        <button className={page === 'help' ? 'nav-item selected' : 'nav-item'} aria-current={page === 'help' ? 'page' : undefined} onClick={() => go('help')}><CircleHelp size={17}/>帮助与文档<ArrowUpRight size={14} className="push"/></button>
        <div className="account"><div className="avatar">{session?.email && session.email !== 'demo' ? session.email[0].toUpperCase() : '镜'}</div><div><b>{session?.email && session.email !== 'demo' ? session.email.split('@')[0] : '镜序创作者'}</b><small>{roleNames[session?.role] || '创作成员'}</small></div><button className="icon-button push" aria-label="账户选项" onClick={() => go('settings')}><MoreHorizontal size={18}/></button></div>
      </div>
    </aside>
    {mobile && <button className="sidebar-scrim" aria-label="关闭导航" tabIndex={-1} onClick={closeMobileMenu}/>}
    <div className="main" ref={workspaceSurface} inert={mobile || undefined}>
      <StudioLighting surface={workspaceSurface} overview={page === 'projects'}/>
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label="菜单" aria-controls="workbench-sidebar" aria-expanded={mobile} ref={mobileToggle} onClick={() => setMobile(value => !value)}><Menu size={20}/></button>
        <div className="breadcrumbs"><button onClick={() => go('projects')}>创作空间</button><ChevronRight size={14}/><b>{pageTitle[page]}</b></div>
        <div className="top-actions">{session && <span className="system-status"><i/>{session.live ? '供应商模式' : '演示模式'}</span>}{page !== 'projects' && session && <button className="button primary small" onClick={() => open('create')}><Plus size={16}/>新建项目</button>}</div>
      </header>
      <main className="main-content">
        {pageLoading && <div className="panel blank" role="status">{authLoading ? '正在连接工作空间…' : '正在打开项目…'}</div>}
        {pageError && <div className="panel blank"><h2>暂时无法打开</h2><p role="alert">{pageError}</p><button className="button" onClick={() => window.location.reload()}>重试</button></div>}
        {!pageLoading && !pageError && !requiresLogin && <div className="workspace-view" key={(workspaceId || '') + ':' + page + ':' + (projectId || '')}>
        {projectPanel && <><div className="project-heading"><div><button className="back" onClick={() => go('projects')}><ArrowLeft size={14}/> 所有项目</button><div className="heading-line"><h1>{project.name}</h1><span className="badge status-badge"><i/>{project.export ? '已导出' : isSample ? '示例项目' : '制作中'}</span></div><p className="project-meta"><span><Video size={15}/> 微信视频号</span><span><Frame size={15}/> 9:16 竖屏</span><span><Clock3 size={15}/> 120 秒</span></p></div>
          <div className="heading-actions"><button className="button" onClick={() => go('usage')}><Coins size={16}/> 费用明细</button><button className="button primary" onClick={() => go('export')}><ArrowDownToLine size={16}/> 成片导出</button></div></div>
          <div className="workflow" aria-label="制作步骤">{steps.map(({icon: Icon, ...step}) => {
            const activeStep = page === step.key;
            const completed = step.key === 'product' ? project.facts.some(f => f.confirmed) : step.key === 'assets' ? isSample || project.assets.length : step.key === 'script' ? shots.length : step.key === 'render' ? shots.length && shots.every(b => b.clip) : project.export;
            return <button key={step.key} className={(activeStep ? ' workflow-active' : '') + (completed ? ' workflow-complete' : '')} onClick={() => go(step.key)}><span className="step-icon"><Icon size={17}/></span><span className="step-label"><b>{step.label}</b></span>{completed && !activeStep && <CheckCircle2 className="step-check" size={14}/>}</button>;
          })}</div>
          <label className="workflow-picker"><span>制作步骤</span><select value={page} onChange={event => go(event.target.value)}>
            {page === 'metrics' && <option value="metrics" disabled>投放数据</option>}
            {steps.map(step => <option key={step.key} value={step.key}>{step.label}</option>)}
          </select></label>
        </>}

        {page === 'script' && <>
          <div className="section-heading"><div><h2>分镜工作台</h2><p>{project.pacing_issues?.length ? `节拍检查 · ${project.pacing_issues.length} 个三秒窗口待复核，首处 ${timecode(project.pacing_issues[0].start)}` : shots.length ? `${shots.length} 个镜头 · ${project.script.trope || '短剧制作'}` : '确认商品资料后生成剧本与分镜'}</p></div><div className="button-group">
            {!isSample && <button className="button" onClick={() => open('direction', {direction: project.direction || '', product_start: project.product_start})}>创作要求</button>}
            <button className="button" disabled={busy} onClick={() => action('script', {}, '剧本生成任务已提交')}><Sparkles size={16}/>{shots.length ? '生成新剧本' : '生成剧本'}</button>
          </div></div>
          {shots.length ? <Storyboard project={project} current={current} select={setActive}
            filter={filter} setFilter={setFilter} file={file} isSample={isSample} busy={busy} currency={yuan}
            onEdit={() => isSample ? open('create') : open('edit', { ...current })}
            onFrame={() => action('frame', { id: current.id }, '首帧生成任务已提交')}
            onPreview={() => open('preview')} onVoice={previewDialogue} onBudget={() => go('usage')}
            voicePreview={voicePreview?.key === project.id + current.id + current.dialogue ? voicePreview.url : null}/> : <div className="panel blank"><Clapperboard size={32}/><h3>开始制作你的第一条短剧</h3><p>确认商品资料后，即可生成镜头、台词与提示词。</p><button className="button" onClick={() => go('product')}>查看商品资料 <ArrowRight size={16}/></button></div>}
        </>}

        {!projectPanel && <div className={'section-heading general-heading' + (page === 'projects' ? ' overview-header' : '')}>
          {page === 'projects' && <><span className="overview-light" aria-hidden="true"/><span className="overview-edge" aria-hidden="true"/></>}
          <div><h1>{pageTitle[page]}</h1><p>{({ projects: '打开已有短剧，或从一件商品开始创作。', trends: '管理适用于项目的热点与表达素材。', usage: '查看项目成本和工作空间额度。', operations: '监控工作空间的配额、用量和生成任务。', settings: '管理成员和工作空间访问权限。', help: '了解从商品录入到成片的制作流程。' })[page]}</p></div>{page === 'projects' && <button className="button primary" onClick={() => open('create')}><Plus size={16}/>新建项目</button>}</div>}

        {page === 'projects' && <>
          {projectsError ? <div className="panel blank"><h2>暂时无法加载项目</h2><p role="alert">{projectsError}</p><button className="button" onClick={() => window.location.reload()}>重试</button></div> :
            projects === null ? <div className="panel blank" role="status">正在加载项目…</div> :
              projects.length ? <div className="card-grid">{projects.map(item => <button key={item.id} className="panel project-card" data-spotlight onClick={() => load(item.id, item.has_script ? 'script' : 'product')}>
                <div className="project-cover placeholder-cover"><Clapperboard size={30}/></div><div><h3>{item.name}</h3><p>{item.export ? '已导出' : item.has_script ? '制作中' : '待生成剧本'}<ChevronRight size={15}/></p></div>
              </button>)}</div> : <div className="panel blank"><Clapperboard size={30}/><h2>还没有项目</h2><p>新建项目，从填写商品资料开始。</p></div>}
          <div className="section-heading"><h2>示例项目</h2></div>
          <div className="card-grid"><button className="panel project-card" data-spotlight onClick={() => load('sample')}><div className="project-cover" style={{backgroundImage:'url(/still.webp)'}}/><div><h3>{sample.name}</h3><p>查看示例分镜<ChevronRight size={15}/></p></div></button></div>
        </>}
        {page === 'product' && <><div className="section-heading"><div><h2>商品资料</h2><p>核对规格、宣传信息与优惠条件，确认后生成剧本。</p></div><div className="button-group"><button className="button" onClick={() => open(isSample ? 'create' : 'source')}>导入链接</button><button className="button" onClick={() => open(isSample ? 'create' : 'fact')}><Plus size={16}/>添加资料</button><button className="button primary" disabled={busy} onClick={async () => { if (await action('script', {}, '剧本生成任务已提交')) go('script'); }}><Sparkles size={16}/>生成剧本</button></div></div>
          <div className="panel data-panel">{project.facts.map(fact => <div className="data-row" key={fact.id}><div><h3>{fact.label}</h3><p>{fact.value}</p><small>来源 · {fact.source}</small></div>{fact.confirmed ? <span className="badge product-badge"><Check size={14}/>已确认</span> : <button className="button small" disabled={busy} onClick={() => action('confirm', {id:fact.id}, '资料已确认')}>确认资料</button>}</div>)}</div></>}

        {page === 'assets' && <><div className="section-heading"><div><h2>视觉资产</h2><p>上传商品的实际角度、角色定妆照与场景参考。</p></div><div className="button-group">
          {modelOptions && !isSample && <><button className="button" onClick={() => open('portraitImport')}>导入方舟尾帧</button><button className="button" disabled={portraitReserve === null} onClick={() => open('portrait')}>生成角色定妆</button></>}
          <button className="button primary" onClick={assetAction}><UploadCloud size={16}/>上传素材</button></div></div>
          {project.assets.length ? <div className="card-grid">{project.assets.map(asset => <div className="panel asset-card" key={asset.id}><img src={file(asset.cutout)} alt={asset.view}/><div><b>{asset.view}</b><span className="badge still-badge">V{asset.version}</span><a href={file(asset.file, true)} className="icon-button push" aria-label="下载素材图"><ArrowDownToLine size={16}/></a></div>
            {asset.source && <div><small>{asset.source}{asset.trusted_until ? ` · 有效期至 ${new Date(asset.trusted_until * 1000).toLocaleDateString('zh-CN')}` : ''}</small></div>}</div>)}</div> : <div className="panel blank"><Images size={32}/><h3>还没有上传素材</h3><p>可以分别上传商品正面、侧面和细节图片。</p><button className="button" onClick={assetAction}><Plus size={15}/>添加素材</button></div>}</>}

        {page === 'render' && <><div className="section-heading"><div><h2>首帧审核与渲染</h2><p>{fullDynamic ? '审核首帧、渲染视频，再逐镜复核画面和声音。' : '先审核首帧，再生成片段。'}</p></div><div className="button-group"><button className="button" disabled={busy} onClick={() => batch('frame')}><Images size={16}/>批量生成首帧</button><button className="button primary" disabled={busy} onClick={() => batch('clip')}><Video size={16}/>{fullDynamic ? '提交全动态渲染' : '渲染已审核'}</button></div></div>
          {project.render_models && <RenderModels project={project} busy={busy} save={body => action('render-models', body, '生成模型已保存')}/>}
          <div className="panel data-panel">{shots.length ? shots.map(shot => <div className="data-row render-row" key={shot.id}>
            <button className="render-thumb" style={{backgroundImage: shot.frame ? 'url('+file(shot.frame)+')' : undefined}} aria-label="查看镜头" onClick={() => { setActive(shot.id); open('preview'); }}>{!shot.frame && <Frame size={17}/>}</button>
            <div className="flex"><h3>{shot.id} · {shot.title}</h3><small>{timecode(shot.start)}–{timecode(shot.end)} · {fullDynamic ? (shot.product ? '商品动态' : '动态') : shot.product ? '商品实拍' : shot.dynamic ? '动态' : '静帧'}</small></div>
            <span className={'badge ' + (shot.approved ? 'product-badge' : 'still-badge')}>{renderedClip(shot) ? (fullDynamic ? (shot.clip_reviewed ? '视频已审核' : '待复核视频') : '已渲染') : shot.approved ? '首帧已审核' : shot.frame ? '待审核首帧' : '待生成'}</span>
            <div className="button-group">
              {shot.frame && !shot.approved && <button className="button small" disabled={busy} onClick={() => action('approve', {id:shot.id}, '首帧已审核')}>审核通过</button>}
              {fullDynamic && renderedClip(shot) && <button className="button small" onClick={() => { setActive(shot.id); open('preview'); }}>预览并复核</button>}
              <button className="button small" disabled={busy} onClick={() => renderShot(shot)}>{renderedClip(shot) ? '重算片段' : shot.approved ? '渲染片段' : shot.frame ? '重算首帧' : '生成首帧'}</button>
            </div></div>) : <div className="blank">请先生成剧本</div>}</div></>}

        {page === 'export' && <><div className="section-heading"><div><h2>成片导出</h2><p>导出 1080 × 1920 · 120 秒 MP4。</p></div><button className="button" onClick={() => go('metrics')}><TrendingUp size={16}/>投放数据</button></div><div className="panel blank">{project.export ? <><video className="export-video" src={file(project.export)} controls/><h3>成片已生成</h3><p className="mono">{project.export}</p><button className="button primary" onClick={() => perform(async () => { const {url} = await api('/projects/' + project.id + '/download'); window.location.assign(url); })}><ArrowDownToLine size={16}/>下载 MP4</button></> : <><Video size={33}/><h3>{readyCount} / {shots.length || 12} 个镜头已生成</h3><p>{isSample ? '新建项目后可以生成并导出成片。' : !canExport ? '审核并渲染全部镜头后，即可合成。' : '已完成所有镜头，可以开始合成。'}</p><div className="button-group">
          {!canExport && <button className="button" onClick={() => isSample ? open('create') : go(shots.length ? 'render' : 'product')}>{isSample ? '新建项目' : shots.length ? '前往审核与渲染' : '前往商品资料'}</button>}
          <button className="button primary" disabled={busy || !canExport || exporting} onClick={() => action('export', {}, '成片合成任务已提交')}><Sparkles size={16}/>{exporting ? '合成中…' : '合成成片'}</button></div></>}</div></>}

        {page === 'metrics' && <><div className="section-heading"><div><h2>投放数据</h2><p>按导出版本汇总观看、点击与成交。</p></div><button className="button primary" onClick={() => open(isSample ? 'create' : 'csv')}><UploadCloud size={16}/>导入 CSV</button></div><div className="panel data-panel">{project.metrics.length ? project.metrics.map(row => <div className="data-row" key={row.version+row.date}><div><h3>{row.date}</h3><small>{row.version}</small></div><p>3 秒留存 {percent(row.retained_3s, row.impressions)} · 中段留存 {percent(row.mid_views, row.impressions)} · 点击 {row.clicks} · 成交 {row.orders}</p></div>) : <div className="blank"><TrendingUp size={30}/><h3>还没有投放记录</h3><p>请使用成片文件名关联 CSV 数据。</p></div>}</div></>}

        {page === 'trends' && <><div className="button-group toolbar"><button className="button" onClick={() => open('trendSource')}>导入授权源</button><button className="button primary" onClick={() => open('trend', {date:new Date().toISOString().slice(0,10)})}><Plus size={16}/>添加热梗</button></div><div className="panel data-panel">{trendList.length ? trendList.map(item => <div className="data-row" key={item.text}><div><h3>{item.text}</h3><p>{item.source} · {item.tags.join(' / ')}</p></div><small>到期 {item.expires}</small></div>) : <div className="blank"><TrendingUp size={30}/><h3>还没有热点素材</h3><p>可以手工添加，也可以同步已配置的授权来源。</p></div>}</div></>}

        {page === 'usage' && <>{usageStats.length > 0 && <div className="stat-grid">{usageStats.map(([label, amount, Icon]) => <div className="panel stat" key={label}><Icon size={18}/><p>{label}</p><strong>{amount == null ? '—' : yuan(amount)}</strong></div>)}</div>}
          {project ? <><div className="section-heading"><div><h2>项目费用明细</h2><p>{project.name}</p></div></div><JobList project={project} session={session} onResume={id => action('resume', {job:id}, '已重新查询原订单')} onRetryStoryboard={id => action('script', {narrative_job:id}, '已提交原草稿重新拆镜')} onResolveScript={id => action('resolve-script', {job:id}, '已解除阻塞，可重新生成剧本')} onSettle={id => open('settle', {job:id})} onResolveCloud={resolveCloud}/></> :
            <div className="panel blank"><Coins size={28}/><h2>选择项目查看费用</h2><button className="button" onClick={() => go('projects')}>返回项目总览</button></div>}
        </>}
        {page === 'operations' && <div className="panel data-panel">{operations.map(item => <div className="data-row workspace-usage-row" key={item.id}>
          <div><h3>{item.name}</h3><p>运行 {item.pending} · 待核对 {item.uncertain}</p></div>
          <dl>{[['总额度', item.quota], ['可用', item.quota - item.spent - item.committed], ['冻结', item.committed], ['已结算', item.spent]].map(([label, amount]) =>
            <div key={label}><dt>{label}</dt><dd>{yuan(amount)}</dd></div>)}</dl>
          <button className="button small" onClick={() => open('quota', { id: item.id, amount: (item.quota / 100).toFixed(2) })}>调整额度</button>
        </div>)}</div>}
        {page === 'settings' && <div className="panel data-panel"><div className="data-row"><div><h3>{session?.name || '镜序工作室'}</h3><p>{session?.email === 'demo' ? '本地演示工作空间' : session?.email || '尚未登录'}</p></div><div className="button-group">{!session || session.email === 'demo' ? <><button className="button" onClick={()=>open('login')}>登录</button><button className="button primary" onClick={()=>open('register')}>邀请码注册</button></> : <button className="button" onClick={()=>perform(async()=>{ await api('/logout',{method:'POST'}); window.location.replace('/'); })}>退出登录</button>}</div></div>{session?.admin && session.email !== 'demo' && <div className="data-row"><div><h3>邀请制作成员</h3><p>{invite ? '邀请码 · '+invite : '邀请码单次有效，24 小时后过期。'}</p></div><button className="button" disabled={busy} onClick={createInvitation}>生成邀请码</button></div>}{workspace?.members?.map(member=><div className="data-row" key={member.email}><b>{member.email}</b><span className="badge still-badge">{roleNames[member.role]}</span></div>)}</div>}
        {page === 'help' && <div className="panel data-panel">{steps.map((step,i) => <div className="data-row" key={step.key}><div><h3>{i+1}. {step.label}</h3><p>{['录入并确认商品信息。','上传角色、场景或商品参考。','生成并编辑 120 秒的短剧。','审核每个首帧后生成片段。','合成竖屏成片并下载。'][i]}</p></div><button className="button small" onClick={() => go(step.key)}>打开 <ArrowRight size={14}/></button></div>)}</div>}
        {['script','assets','render','export'].includes(page) && !isSample && project.jobs.length > 0 && <div className="recent"><h3>最近生成任务</h3><JobList project={{...project,jobs:project.jobs.slice(-6)}} session={session} onResume={id => action('resume',{job:id},'已重新查询原订单')} onRetryStoryboard={id => action('script', {narrative_job:id}, '已提交原草稿重新拆镜')} onResolveScript={id => action('resolve-script', {job:id}, '已解除阻塞，可重新生成剧本')} onSettle={id => open('settle',{job:id})} onResolveCloud={resolveCloud}/></div>}
        </div>}
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
        {modal === 'preview' ? <div className="modal-body">
          {current?.clip && renderedClip(current) ? <video className="export-video" src={file(current.clip)} controls autoPlay/> : isSample || current?.frame ? <img className="preview-image" src={isSample ? storyboardStill : file(current.frame)} alt={current?.title || '示例首帧'}/> : <p>该镜头尚未生成首帧。</p>}
          {fullDynamic && current && renderedClip(current) && !current.clip_reviewed && <div className="modal-actions"><button className="button primary" disabled={busy} onClick={() => action('approve-clip', {id: current.id, clip: current.clip}, '动态片段已审核')}><Check size={16}/>画面和声音通过</button></div>}
        </div> :
          <form onSubmit={save} className="modal-body">
            {formError && <p role="alert" className="form-error">{formError}</p>}
            {modal === 'createWorkspace' && <>{field('name', '工作空间名称', '例如：生活短剧制作组')}<p className="form-note">新空间的制作额度为 ¥0，由平台运营调整。</p></>}
            {modal === 'joinWorkspace' && field('code', '工作空间邀请码', '粘贴管理员发给你的邀请码')}
            {modal === 'create' && <>{field('name','项目名称','例如：反转厨房')}{field('product','商品资料','填写商品特点、规格和来源',true)}{field('audience','目标受众','例如：视频号·家庭日常')}{field('direction','创作要求（可选）','例如：中国县城家庭短剧，夜里同一间客厅，商品在 60–70 秒出现。',true)}</>}
            {modal === 'direction' && field('direction','下次生成时使用','填写人物、故事背景、开场冲突或商品出现的时间。',true)}
            {(modal === 'direction' || modal === 'create') && <label className="field">商品首现<select value={form.product_start ?? ''} onChange={event => change('product_start', event.target.value === '' ? null : Number(event.target.value))}>
              <option value="">由剧情安排</option>{Array.from({length:12}, (_, index) => index * 10).map(start => <option value={start} key={start}>{timecode(start)}–{timecode(start + 10)}</option>)}
            </select></label>}
            {modal === 'fact' && <>{field('label','资料项','例如：容量')}{field('value','资料内容','例如：300 mL',true)}{field('source','信息来源','例如：实拍包装正面')}</>}
            {(modal === 'source' || modal === 'trendSource') && field('url','授权链接','https://')}
            {modal === 'upload' && <><label className="field">素材分类<select value={form.kind || 'product'} onChange={e=>change('kind',e.target.value)}><option value="product">商品</option><option value="character">角色</option><option value="scene">场景</option></select></label>{field('view','素材视角或名称','例如：正面')}<label className="field">上传图片<input type="file" accept="image/*" onChange={e=>change('file',e.target.files[0])}/></label></>}
            {modal === 'portrait' && <>{visualPlan?.characters.length > 0 && <label className="field">从剧本选角色<select value={form.role || ''} onChange={event => selectPortraitRole(event.target.value)}><option value="">手动填写</option>{visualPlan.characters.map(role => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>}
              {field('name','虚构角色名称','例如：婆婆')}{field('description','人物与场景','填写人物年龄、发型、服装、地域和光线',true)}<label className="check-field"><input type="checkbox" checked={!!form.confirmed} onChange={event => change('confirmed', event.target.checked)}/>确认提交 4 秒方舟定妆，预计预留 {yuan(portraitReserve)}</label></>}
            {modal === 'portraitImport' && <><p>使用当前方舟账号下已完成、带原始尾帧的任务。</p>{field('name','虚构角色名称','例如：婆婆')}{field('order','原始任务编号','cgt-…')}</>}
            {modal === 'edit' && <>{field('title','镜头标题','')}{field('description','画面描述','',true)}{field('dialogue','台词','',true)}{field('prompt','首帧提示词','',true)}{field('motion','动态提示词','',true)}{field('hook','节拍钩子','')}
              {modelOptions && !form.product && <label className="field">首帧用途<select value={form.frame_subject || ''} onChange={event => change('frame_subject', event.target.value)}><option value="">绑定参考图</option><option value="scene">无脸场景或道具</option><option value="character">写实角色</option></select></label>}
              {form.frame_subject === 'scene' && field('cloud_prompt','免费生图场景描述','只描述场景或道具，例如：深夜客厅，暖灯下的木桌，无人物无文字',true)}
              {!fullDynamic && <label className="check-field"><input type="checkbox" checked={!!form.dynamic} onChange={e=>change('dynamic',e.target.checked)}/>使用动态生成</label>}
              {project.assets.map(asset=><label className="check-field" key={asset.id}><input type="checkbox" checked={form.asset_ids?.includes(asset.id)} onChange={e=>change('asset_ids',e.target.checked?[...(form.asset_ids||[]),asset.id]:(form.asset_ids||[]).filter(id=>id!==asset.id))}/>{asset.view} · V{asset.version}</label>)}</>}
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

function RenderModels({ project, busy, save }) {
  const models = project.render_models;
  const choice = project.render_settings;
  const rates = models.video[choice.video]?.rates || {};
  const videoCents = rates[choice.resolution];
  return <section className="panel render-models" aria-labelledby="render-model-heading">
    <h3 id="render-model-heading">生成模型</h3>
    <div className="render-model-fields">
      <label className="field">首帧生图
        <select value={choice.image || ''} disabled={busy} onChange={event => save({image: event.target.value})}>
          {!choice.image && <option value="" disabled>请选择模型</option>}
          {Object.entries(models.image).map(([id, option]) => <option value={id} key={id} disabled={!option.available}>
            {option.label}{!option.available ? ` · ${option.unavailable_reason || '未上线 · 暂不可用'}` : id === 'reference' || id === 'cloudflare-flux' ? '' : ` · ${yuan(option.cents)}/张`}
          </option>)}
        </select>
      </label>
      <label className="field">动态视频
        <select value={choice.video || ''} disabled={busy} onChange={event => {
          const video = event.target.value;
          const resolution = choice.resolution in models.video[video].rates ? choice.resolution : '720p';
          save({video, resolution});
        }}>
          {!choice.video && <option value="" disabled>请选择模型</option>}
          {Object.entries(models.video).map(([id, option]) => <option value={id} key={id} disabled={!option.available}>
            {option.label}{!option.available && ' · 未上线 · 暂不可用'}
          </option>)}
        </select>
      </label>
      <label className="field">生成分辨率
        <select value={choice.resolution} disabled={busy || !choice.video} onChange={event => save({resolution: event.target.value})}>
          {Object.entries(rates).map(([size, cents]) => <option value={size} key={size}>{size} · {yuan(cents)}/秒</option>)}
        </select>
      </label>
    </div>
    <label className="check-field"><input type="checkbox" checked={choice.full_dynamic} disabled={busy} onChange={event => {
      const full_dynamic = event.target.checked;
      save(full_dynamic && '480p' in rates ? {full_dynamic, resolution: '480p'} : {full_dynamic});
    }}/>全动态成片 · 无字幕</label>
    {Number.isInteger(videoCents) && <p>10 秒动态镜头预留 {yuan(videoCents * 10 + models.local_clip_cents)}。实际费用以方舟账单为准。</p>}
    {choice.image === 'reference' && <p>在「资产管理」上传参考图，然后在「编辑分镜」里绑定素材。</p>}
    {choice.image === 'cloudflare-flux' && <p>在分镜中选择「无脸场景或道具」并填写场景描述。额度耗尽时可切换到绑定参考图。</p>}
    {choice.full_dynamic && <p>先逐镜测试场景、商品和角色。每个片段都通过画面和声音复核后即可导出。</p>}
  </section>;
}

function JobList({ project, session, onResume, onSettle, onResolveCloud, onResolveScript, onRetryStoryboard }) {
  return <div className="panel data-panel">{project.jobs.length ? [...project.jobs].reverse().map(job => {
    const receipt = job.result?.provider;
    const narrative = job.result?.narrative;
    const request = receipt?.request_id || job.result?.order;
    const details = [sourceNames[job.source], receipt?.model || job.model, job.resolution, Number.isInteger(receipt?.tokens) ? `${receipt.tokens} tokens` : null,
      job.result?.message || new Date(job.created * 1000).toLocaleString('zh-CN')].filter(Boolean);
    return <div className="data-row" key={job.id}>
      <div><h3>{kindNames[job.kind]}</h3><small>{details.join(' · ')}</small>{request && <p className="mono" style={{overflowWrap: 'anywhere'}}>回执 {request}</p>}{narrative && <details><summary>查看故事草稿 · {narrative.title}</summary><p style={{whiteSpace:'pre-wrap'}}>{narrative.story}</p></details>}</div>
      <div className="button-group">
        <span className={'badge ' + (job.state === 'done' ? 'product-badge' : 'still-badge')}>{stateNames[job.state]}</span>
        <span className="mono">{job.reserved > 0 ? `占额 ${yuan(job.reserved)}` : `已结算 ${yuan(job.spent)}`}</span>
        {job.state === 'uncertain' && job.result?.order && <button className="button small" onClick={() => onResume(job.id)}>查询订单</button>}
        {job.state === 'uncertain' && job.kind === 'script' && !job.result?.order && <button className="button small" onClick={() => onResolveScript(job.id)}>解除阻塞</button>}
        {job.state === 'failed' && narrative && <button className="button small" onClick={() => onRetryStoryboard(job.id)}>用此草稿重新拆镜</button>}
        {job.state === 'uncertain' && job.source === 'cloud_image' && <button className="button small" onClick={() => onResolveCloud(job.id)}>已核对，可重试</button>}
        {session?.live && session.admin && job.reserved > 0 && ['done', 'failed', 'uncertain'].includes(job.state) && <button className="button small" onClick={() => onSettle(job.id)}>登记结算</button>}
      </div>
    </div>;
  }) : <div className="blank"><Coins size={28}/><h3>暂无生成账目</h3><p>提交生成任务后，可在这里查看占额与结算。</p></div>}</div>;
}
