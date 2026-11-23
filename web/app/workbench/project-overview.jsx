'use client';

import { useMemo, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  ArrowRight, ArrowUpRight, Clapperboard, FileText, Film, FolderOpen, Layers3,
  Plus, Search, X,
} from 'lucide-react';

const stages = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '制作中' },
  { value: 'exported', label: '已导出' },
];

function formatDate(seconds) {
  if (!Number.isFinite(seconds)) return '—';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit' }).format(seconds * 1000);
}

function ProjectRows({ items, load, media, query, filter }) {
  if (!items.length) return <div className="library-empty">
    <FolderOpen size={25}/>
    <h3>{query ? '没有匹配的项目' : filter === 'all' ? '还没有项目' : '此状态下没有项目'}</h3>
    <p>{query ? '试试其他项目名称。' : filter === 'all' ? '新建项目后，制作进度会显示在这里。' : '你可以切换状态查看其他项目。'}</p>
  </div>;

  return <ul className="project-list">{items.map(item => {
    const status = item.export ? '已导出' : item.has_script ? '制作中' : '待写剧本';
    return <li key={item.id}><button className="project-list-row" onClick={() => load(item.id, item.has_script ? 'script' : 'product')}>
      <span className="project-list-image">{item.thumbnail ? <img src={media(item.id, item.thumbnail)} alt="" loading="lazy"/> : <Clapperboard size={19}/>}</span>
      <span className="project-list-name"><strong>{item.name}</strong><span>更新于 {formatDate(item.updated)}</span></span>
      <span className={'project-list-status' + (item.export ? ' is-exported' : '')}><i/>{status}</span>
      <ArrowUpRight size={16} className="project-list-open"/>
    </button></li>;
  })}</ul>;
}

export default function ProjectOverview({ projects, error, workspaceName, sampleName, load, create, media }) {
  const [filter, setFilter] = useState('all');
  const [input, setInput] = useState('');
  const query = input.trim().toLowerCase();
  const items = projects || [];
  const selected = useMemo(() => (projects || []).filter(item =>
    (filter === 'all' || (filter === 'exported' ? item.export : !item.export)) &&
    (!query || item.name.toLowerCase().includes(query))), [projects, filter, query]);
  const metrics = [
    { label: '项目总数', value: items.length, icon: Layers3 },
    { label: '已有剧本', value: items.filter(item => item.has_script).length, icon: FileText },
    { label: '已导出', value: items.filter(item => item.export).length, icon: Film },
  ];

  return <div className="project-overview">
    <section className="overview-hero" aria-labelledby="overview-title">
      <div className="overview-hero-content">
        <p className="overview-space"><span/> {workspaceName || '镜序工作室'}</p>
        <h1 id="overview-title">项目总览</h1>
        <p className="overview-summary">管理商品、剧本与分镜，跟进短剧制作进度。</p>
        <div className="overview-actions"><button className="button primary" onClick={create}><Plus size={18}/>新建项目</button>
          <button className="button overview-secondary" onClick={() => load('sample')}>查看示例 <ArrowRight size={15}/></button></div>
      </div>
    </section>

    <div className="overview-metrics" role="group" aria-label="项目概况">
      {metrics.map(({ label, value, icon: Icon }) => <div className="overview-metric" key={label}>
        <span className="overview-metric-icon"><Icon size={19}/></span><div><span>{label}</span><strong>{projects ? value : '—'}</strong></div>
      </div>)}
    </div>

    <div className="overview-columns">
      <section className="project-library" aria-labelledby="library-title">
        <header className="overview-panel-head">
          <h2 id="library-title">我的项目</h2>
          <div className="project-search"><Search size={15} aria-hidden="true"/>
            <input aria-label="搜索项目" type="search" value={input} placeholder="搜索项目名称" onChange={event => setInput(event.target.value)}/>
            {input && <button type="button" aria-label="清除搜索" onClick={() => setInput('')}><X size={15}/></button>}</div>
        </header>
        {error ? <div className="library-empty"><h3>暂时无法加载项目</h3><p role="alert">{error}</p><button className="button" onClick={() => window.location.reload()}>重试</button></div> :
          projects === null ? <p className="library-empty" role="status">正在加载项目…</p> :
          <Tabs.Root value={filter} onValueChange={setFilter}>
            <Tabs.List className="project-filters" aria-label="按制作状态筛选">
              {stages.map(stage => <Tabs.Trigger value={stage.value} key={stage.value}>{stage.label}</Tabs.Trigger>)}
            </Tabs.List>
            {stages.map(stage => <Tabs.Content value={stage.value} key={stage.value} className="project-tab-content">
              {stage.value === filter && <ProjectRows items={selected} load={load} media={media} query={query} filter={filter}/>}
            </Tabs.Content>)}
          </Tabs.Root>}
      </section>

      <section className="overview-sample" aria-labelledby="sample-title">
        <header className="overview-panel-head"><h2 id="sample-title">示例项目</h2><Clapperboard size={17}/></header>
        <button className="overview-sample-card" onClick={() => load('sample')}>
          <div className="sample-image"><img src="/still.webp" alt=""/><span>12 镜头 · 120 秒</span></div>
          <span className="overview-sample-info"><strong>{sampleName}</strong><small>查看剧本、分镜与台词试听</small></span>
          <span className="sample-open" aria-hidden="true"><ArrowUpRight size={17}/></span>
        </button>
      </section>
    </div>
  </div>;
}
