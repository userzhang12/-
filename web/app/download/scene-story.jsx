'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, AudioLines, Clapperboard, Film, Frame, Layers3 } from 'lucide-react';

const shots = [
  { id: '01', title: '开场钩子', time: '00:00', image: '/workspace-hero.webp', alt: '女主在暖光厨房回头',
    dialogue: '等等……这个是谁放在这儿的？', direction: '让观众先看到人物的疑惑，商品在下一镜揭晓。' },
  { id: '03', title: '意外线索', time: '00:20', image: '/story-note.webp', alt: '桌面近景，人物翻开便签，旁边放着琥珀色玻璃瓶',
    dialogue: '背面还有一行字。', direction: '用翻便签的动作推进剧情，让商品自然留在画面里。' },
  { id: '06', title: '商品特写', time: '00:50', image: '/story-product.webp', alt: '暖色灯光照亮桌面上的琥珀色玻璃瓶',
    dialogue: '原来，你早就准备好了。', direction: '用特写交代商品外观，保留角色的画外音承接上一镜。' },
];

export default function SceneStory({ workbench }) {
  const section = useRef(null);
  const stage = useRef(null);
  const [active, setActive] = useState(shots[0].id);
  const current = shots.find(shot => shot.id === active) || shots[0];

  useEffect(() => {
    const root = section.current;
    const panel = stage.current;
    const preference = window.matchMedia('(min-width: 900px) and (min-height: 650px) and (prefers-reduced-motion: no-preference)');
    let frame;

    function paint() {
      frame = undefined;
      const top = Number.parseFloat(getComputedStyle(panel).top) || 0;
      const distance = root.offsetHeight - panel.offsetHeight;
      const progress = distance > 0 ? Math.max(0, Math.min(1, (top - root.getBoundingClientRect().top) / distance)) : 0;
      const rounded = progress.toFixed(4);
      root.style.setProperty('--story-progress', rounded);
      const move = Math.min(1, progress / .66);
      root.style.setProperty('--story-frame', (move * move * (3 - 2 * move)).toFixed(4));
      root.dataset.chapter = progress >= .43 ? 'detail' : 'intro';
      root.dataset.controls = progress >= .89 ? 'on' : 'off';
    }

    function schedule() {
      if (preference.matches && frame === undefined) frame = requestAnimationFrame(paint);
    }

    function adapt() {
      if (preference.matches) {
        root.dataset.motion = 'on';
        schedule();
      } else {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = undefined;
        delete root.dataset.motion;
        delete root.dataset.chapter;
        delete root.dataset.controls;
        root.style.removeProperty('--story-progress');
        root.style.removeProperty('--story-frame');
      }
    }

    adapt();
    preference.addEventListener('change', adapt);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      preference.removeEventListener('change', adapt);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, []);

  function revealPosition() {
    const root = section.current;
    const panel = stage.current;
    const pin = Number.parseFloat(getComputedStyle(panel).top) || 0;
    const start = window.scrollY + root.getBoundingClientRect().top - pin;
    return start + (root.offsetHeight - panel.offsetHeight) * .95;
  }

  function reveal(event) {
    if (!section.current.dataset.motion) return;
    event.preventDefault();
    document.getElementById('story-edit-title')?.focus({ preventScroll: true });
    window.scrollTo({ top: revealPosition(), behavior: 'smooth' });
  }

  function selectShot(id) {
    setActive(id);
    if (section.current.dataset.motion) {
      const endpoint = revealPosition();
      if (window.scrollY < endpoint) window.scrollTo({ top: endpoint, behavior: 'instant' });
    }
  }

  return <section id="product" className="scene-story" aria-labelledby="story-title" ref={section}>
    <div className="story-stage" ref={stage}>
      <div className="story-inner">
        <div className="story-intro">
          <p className="site-purpose">面向商家和内容团队的 AI 短剧工具</p>
          <h1 id="story-title">把商品拍成<br/><em>值得看完的故事。</em></h1>
          <p className="site-description">从商品资料到带配音和字幕的竖屏成片。台词、画面和商品出现的时机，都可以逐镜调整。</p>
          <div className="site-actions">
            <a className="site-action primary-action" href={workbench}>打开工作台 <ArrowRight size={17}/></a>
            <a className="site-action secondary-action" href="#story-controls" onClick={reveal}>看制作过程 <ArrowDown size={16}/></a>
          </div>
          <p className="site-invite">当前为邀请内测，注册需邀请码。</p>
        </div>

        <figure className="story-shot" data-alt-shot={active !== '01' || undefined}>
          <img className="story-hero-image" src={shots[0].image} alt={shots[0].alt} fetchPriority="high"/>
          {active !== '01' && <img className="story-selected-image" src={current.image} alt={current.alt}/>}
          <span className="story-frame-guides" aria-hidden="true"><i/><i/><i/><i/></span>
          <figcaption><Clapperboard size={15}/> 示例短剧《反转厨房》</figcaption>
        </figure>

        <div className="story-track" id="story-controls" role="group" aria-label="示例分镜时间轴">
          <div className="story-track-head"><span><Film size={15}/> 示例分镜</span><span>{current.time} / 02:00</span></div>
          <ol>{shots.map(shot => <li key={shot.id}>
            <button type="button" aria-pressed={active === shot.id} aria-controls="story-edit" onClick={() => selectShot(shot.id)}>
              <img src={shot.image} alt="" loading="lazy"/>
              <span className="story-track-label"><strong>{shot.title}</strong><small>{shot.time}</small></span>
            </button>
          </li>)}</ol>
        </div>

        <section className="story-edit" id="story-edit" aria-labelledby="story-edit-title">
          <div className="story-heading">
            <p className="story-context" role="status"><Frame size={15}/> 镜头 {current.id} <span>·</span> {current.title}</p>
            <h2 id="story-edit-title" tabIndex={-1}>拆开这一镜</h2>
            <p>选择下方的镜头，看看剧情如何推进、商品如何出场。</p>
          </div>
          <dl className="story-cues">
            <div className="story-cue dialogue-cue"><dt><AudioLines size={16}/> 分镜台词</dt><dd>「{current.dialogue}」</dd></div>
            <div className="story-cue product-cue"><dt><Layers3 size={16}/> 镜头安排</dt><dd>{current.direction}</dd></div>
          </dl>
          <a className="story-example-link" href={workbench + '?page=script&project=sample&shot=' + current.id}>
            在工作台查看这一镜 <ArrowUpRight size={15}/>
          </a>
        </section>
      </div>
    </div>
  </section>;
}
