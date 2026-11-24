'use client';

import { useEffect, useRef } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import {
  AudioLines, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Coins,
  Frame, Images, Maximize2, PanelRight, Play, Settings2, Sparkles, Video,
} from 'lucide-react';

export const storyboardStill = '/storyboard-still.webp';
export const timecode = t => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');

function shotType(shot) {
  return shot.product ? '商品' : shot.dynamic ? '动态' : '静帧';
}

function matchesFilter(filter, shot) {
  return filter === 'all' || (filter === 'product' ? shot.product : shot.dynamic && !shot.product);
}

function clipClass(shot) {
  return shot.product ? 'product-clip' : shot.dynamic ? 'moving-clip' : 'still-clip';
}

export default function Storyboard({ project, current, select, filter, setFilter, file, isSample,
  busy, onEdit, onFrame, onPreview, onVoice, voicePreview, onBudget, currency, budgetLabel }) {
  const shots = project.script.beats;
  const total = shots.at(-1).end;
  const filtered = shots.filter(shot => matchesFilter(filter, shot));
  const index = shots.indexOf(current);
  const still = isSample ? storyboardStill : current.frame ? file(current.frame) : null;
  const scope = useRef(null);
  const timeline = useRef(null);

  useEffect(() => {
    const viewport = scope.current;
    const row = viewport?.querySelector('[aria-current="true"]');
    if (row) {
      const top = row.offsetTop;
      if (top < viewport.scrollTop) viewport.scrollTop = top;
      if (top + row.offsetHeight > viewport.scrollTop + viewport.clientHeight)
        viewport.scrollTop = top + row.offsetHeight - viewport.clientHeight;
    }
    const track = timeline.current;
    const clip = track?.querySelector('[aria-pressed="true"]');
    if (clip) {
      const frame = track.getBoundingClientRect();
      const position = clip.getBoundingClientRect();
      if (position.left < frame.left) track.scrollLeft += position.left - frame.left - 12;
      if (position.right > frame.right) track.scrollLeft += position.right - frame.right + 12;
    }
  }, [current.id, filter]);

  function applyFilter(value) {
    setFilter(value);
    if (!matchesFilter(value, current)) {
      const first = shots.find(shot => matchesFilter(value, shot));
      if (first) select(first.id);
    }
  }

  function chooseShot(shot) {
    if (!matchesFilter(filter, shot)) setFilter('all');
    select(shot.id);
  }

  const stage = current.clip ? '片段预览' : isSample ? '示例首帧' : '首帧预览';
  const plan = project.script.visual;
  const scene = plan?.scenes.find(item => item.id === current.scene_id);
  const cast = plan?.characters.filter(person => current.character_ids?.includes(person.id)) || [];
  const previous = shots[index - 1];
  const entry = !current.product && previous?.scene_id === current.scene_id ? previous?.exit : '';
  const storedAssets = project.assets.filter(asset => current.asset_ids?.includes(asset.id));
  const used = project.spent + project.committed;
  const ratio = project.budget ? Math.min(1, used / project.budget) : 0;

  return <div className="studio-editor">
    <div className="studio-columns">
      <section className="studio-library" aria-label="分镜列表">
        <div className="studio-panel-top"><h3><Clapperboard size={16}/> 分镜列表</h3><span className="studio-count">{shots.length}</span></div>
        <div className="shot-filter"><select aria-label="筛选镜头" value={filter} onChange={event => applyFilter(event.target.value)}><option value="all">全部镜头</option><option value="dynamic">动态镜头</option><option value="product">商品镜头</option></select><ChevronDown size={13}/></div>
        <div className="studio-shots" ref={scope}>
          {filtered.map(shot => <button className="studio-shot" aria-current={current.id === shot.id ? 'true' : undefined} key={shot.id} onClick={() => select(shot.id)}>
            <span className={'mini-frame ' + clipClass(shot)}>{shot.frame && !isSample ? <img src={file(shot.frame)} alt=""/> : isSample && shot.id === '01' ? <img src={storyboardStill} alt=""/> : <span>{shot.id}</span>}</span>
            <span className="studio-shot-text"><strong>{shot.title}</strong><small>{shotType(shot)} <span>·</span> {timecode(shot.start)}</small></span>
            <ChevronRight size={14} className="shot-chevron"/>
          </button>)}
          {!filtered.length && <p className="studio-muted studio-empty">没有符合筛选条件的镜头</p>}
        </div>
        <div className="studio-list-foot">共 {filtered.length} 个镜头 <span>{timecode(total)}</span></div>
      </section>

      <section className="studio-monitor" aria-label="画面预览">
        <div className="studio-panel-top"><h3><Frame size={16}/> 画面预览</h3><span className="studio-format">9:16 <span>·</span> 1080 × 1920</span></div>
        <div className="studio-stage" style={still ? { '--stage-image': 'url(' + still + ')' } : undefined}>
          <div className="stage-caption"><i/> {stage}</div>
          <div className="portrait-frame">
            {current.clip ? <video key={current.clip} src={file(current.clip)} controls playsInline poster={still || undefined} aria-label="当前镜头片段"/> : still ? <img src={still} alt={current.title}/> : <div className="unrendered"><Images size={24}/>等待生成首帧</div>}
          </div>
          <span className="stage-shot">{current.id} <span>/</span> {String(shots.length).padStart(2, '0')}</span>
        </div>
        <div className="studio-player">
          <span className="studio-clock">{timecode(current.start)} <span>/ {timecode(total)}</span></span>
          <div className="transport"><button className="icon-button" aria-label="上一镜" disabled={index === 0} onClick={() => chooseShot(shots[index - 1])}><ChevronLeft size={18}/></button>
          <button className="icon-button preview-trigger" aria-label="预览镜头" disabled={!still && !current.clip} onClick={onPreview}><Play size={14} fill="currentColor"/></button>
          <button className="icon-button" aria-label="下一镜" disabled={index === shots.length - 1} onClick={() => chooseShot(shots[index + 1])}><ChevronRight size={18}/></button></div>
          <button className="icon-button" aria-label="放大预览" disabled={!still && !current.clip} onClick={onPreview}><Maximize2 size={16}/></button>
        </div>
      </section>

      <aside className="studio-inspector">
        <div className="studio-panel-top"><h3><PanelRight size={16}/> 镜头详情</h3><span className="studio-format">#{current.id}</span></div>
        <Tabs.Root defaultValue="shot" className="detail-tabs">
          <Tabs.List className="detail-tabs-list" aria-label="镜头详情分类">
            <Tabs.Trigger value="shot">镜头</Tabs.Trigger><Tabs.Trigger value="prompts">提示词</Tabs.Trigger><Tabs.Trigger value="assets">素材</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="shot" className="detail-content">
            <div className="shot-detail-title"><h3>{current.id} · {current.title}</h3></div>
            <div className="detail-meta"><span className={'shot-chip ' + clipClass(current)}>{shotType(current)}</span><span>{current.size}</span><span>{current.hook || '待校验'}</span></div>
            <p className="shot-description">{current.description}</p>
            <div className="dialogue"><div className="dialogue-header"><span><AudioLines size={14}/> 分镜台词</span>{current.dialogue && <button className="text-link" disabled={busy} onClick={onVoice}><Play size={12}/>试听普通话</button>}</div><p>{current.dialogue ? '「' + current.dialogue + '」' : '此镜无台词'}</p>{voicePreview && <audio className="voice-preview" aria-label="普通话配音试听" controls autoPlay src={voicePreview}/>}</div>
          </Tabs.Content>
          <Tabs.Content value="prompts" className="detail-content prompts-content">
            {scene && <>
              <h4>场景与光线</h4><p>{plan.setting}。{scene.name} · {scene.time} · {scene.light}。{scene.layout}</p>
              {cast.length > 0 && <><h4>本镜人物</h4>{cast.map(person => <p key={person.id}>{person.name} · {person.appearance} · {person.wardrobe}</p>)}</>}
              {entry && <><h4>承接上一镜</h4><p>{entry}</p></>}
            </>}
            <h4>首帧提示词</h4><p>{current.prompt || '暂未填写'}</p>
            <h4>动态提示词</h4><p>{current.motion || '暂未填写'}</p>
            {current.exit && <><h4>镜尾状态</h4><p>{current.exit}</p></>}
          </Tabs.Content>
          <Tabs.Content value="assets" className="detail-content">
            {storedAssets.length ? storedAssets.map(asset => <div className="inspector-asset" key={asset.id}><img src={file(asset.cutout)} alt=""/><span>{asset.view} · V{asset.version}</span></div>) : <p className="studio-muted">此镜头未绑定素材。可在「编辑分镜」中选择已有素材。</p>}
          </Tabs.Content>
        </Tabs.Root>
        {isSample ? <div className="studio-inspector-actions sample-actions"><p>这是只读示例。新建项目后可编辑和生成分镜。</p><button className="button primary" onClick={onEdit}>新建项目以编辑</button></div> :
          <div className="studio-inspector-actions"><button className="button" onClick={onEdit}><Settings2 size={15}/>编辑分镜</button><button className="button primary" disabled={busy} onClick={onFrame}><Sparkles size={15}/>{current.frame ? '重算首帧' : '生成首帧'}</button></div>}
        <button className="studio-budget" onClick={onBudget}><Coins size={15}/><span>{budgetLabel}</span><span className="budget-track"><i style={{width: ratio * 100 + '%'}}/></span><strong>{currency(used)}</strong><small>/ {currency(project.budget)}</small></button>
      </aside>
    </div>

    <section className="studio-timeline" aria-label="镜头时间轴">
      <div className="studio-panel-top"><h3><Clapperboard size={16}/> 镜头时间轴</h3><span className="studio-format">{shots.length} 个镜头 <span>·</span> {timecode(total)}</span></div>
      <div className="tracks">
        <div className="track-labels"><span/><span><Video size={14}/> 画面</span><span><AudioLines size={14}/> 配音</span></div>
        <div className="tracks-scroll" ref={timeline}>
          <div className="track-content">
            <div className="time-ruler" aria-hidden="true">{Array.from({length: 7}, (_, i) => <span key={i}>{timecode(Math.round(total * i / 6))}</span>)}</div>
            <div className="clip-track">{shots.map(shot => <button key={shot.id} type="button" className={'timeline-clip ' + clipClass(shot)} style={{flex: shot.end - shot.start}} aria-label={'时间轴：' + shot.title} aria-pressed={current.id === shot.id} onClick={() => chooseShot(shot)}><span>{shot.id}</span><span>{shot.title}</span></button>)}</div>
            <div className="audio-track" aria-label="台词分布">{shots.map(shot => <span key={shot.id} style={{flex: shot.end - shot.start}} className={shot.dialogue ? 'has-voice' : ''} title={shot.dialogue || undefined}>{shot.dialogue && <AudioLines size={13}/>}</span>)}</div>
            <div className="playhead" aria-hidden="true" style={{left: 'calc(12px + (100% - 24px) * ' + current.start / total + ')'}}/>
          </div>
        </div>
      </div>
    </section>
  </div>;
}
