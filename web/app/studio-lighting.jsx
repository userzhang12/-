'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

export function SidebarMirror({ activePage }) {
  const mirror = useRef(null);

  useLayoutEffect(() => {
    const highlight = mirror.current;
    const panel = highlight.parentElement;
    const activeItem = panel.querySelector('.nav-item[aria-current]');
    let frame;

    function position() {
      if (!activeItem?.offsetHeight) {
        delete panel.dataset.mirrored;
        delete highlight.dataset.ready;
        if (frame) window.cancelAnimationFrame(frame);
        return;
      }
      highlight.style.setProperty('--mirror-x', `${activeItem.offsetLeft}px`);
      highlight.style.setProperty('--mirror-y', `${activeItem.offsetTop}px`);
      highlight.style.setProperty('--mirror-width', `${activeItem.offsetWidth}px`);
      highlight.style.setProperty('--mirror-height', `${activeItem.offsetHeight}px`);
      panel.dataset.mirrored = '';
      if (!highlight.hasAttribute('data-ready')) {
        if (frame) window.cancelAnimationFrame(frame);
        frame = window.requestAnimationFrame(() => { highlight.dataset.ready = ''; });
      }
    }

    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    for (const section of panel.querySelectorAll('.workspace-picker, .nav-group, .sidebar-bottom')) observer.observe(section);
    return () => { observer.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, [activePage]);

  return <div className="nav-mirror" ref={mirror} aria-hidden="true"><span key={activePage}/></div>;
}

const trailLife = 350;
const pulseLife = 460;

function drawPrism(context, points, pulse, now) {
  context.lineCap = 'round';
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1];
    const to = points[index];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    if (!length) continue;
    const fade = Math.max(0, 1 - (now - to.at) / trailLife) ** 2;
    const spread = Math.min(9, 3 + length * .15);
    const nx = -dy / length * spread;
    const ny = dx / length * spread;
    for (const [position, color, width] of [[-1, '163,127,255', 1.1], [0, '206,252,255', .8], [1, '71,237,247', 1.45]]) {
      context.strokeStyle = `rgba(${color},${fade * (position ? .66 : .82)})`;
      context.lineWidth = width;
      context.beginPath();
      context.moveTo(from.x + nx * position * .48, from.y + ny * position * .48);
      context.lineTo(to.x + nx * position, to.y + ny * position);
      context.stroke();
    }
    if (index % 4 === 0 && fade > .07) {
      context.fillStyle = `rgba(168,215,255,${fade * .8})`;
      context.fillRect(to.x - 1, to.y - 1, 2, 2);
    }
  }

  const head = points.at(-1);
  if (head) {
    const fade = Math.max(0, 1 - (now - head.at) / trailLife);
    context.strokeStyle = `rgba(132,241,255,${fade * .89})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(head.x, head.y - 7);
    context.lineTo(head.x + 7, head.y);
    context.lineTo(head.x, head.y + 7);
    context.lineTo(head.x - 7, head.y);
    context.closePath();
    context.stroke();
    context.strokeStyle = `rgba(176,137,255,${fade * .82})`;
    context.beginPath();
    context.arc(head.x, head.y, 12, .38, 1.33);
    context.moveTo(head.x + Math.cos(3.52) * 12, head.y + Math.sin(3.52) * 12);
    context.arc(head.x, head.y, 12, 3.52, 4.47);
    context.stroke();
  }

  if (pulse) {
    const progress = (now - pulse.at) / pulseLife;
    const spread = 1 - (1 - progress) ** 2;
    context.lineWidth = 1;
    for (const [radius, color] of [[12 + 30 * spread, '83,247,232'], [7 + 23 * spread, '172,144,255']]) {
      context.strokeStyle = `rgba(${color},${(1 - progress) ** 2 * .75})`;
      context.beginPath();
      context.arc(pulse.x, pulse.y, radius, 0, 2 * Math.PI);
      context.stroke();
    }
  }
}

export default function StudioLighting({ surface, overview }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const host = surface.current;
    const canvas = canvasRef.current;
    const preference = window.matchMedia('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)');
    let context = null;
    let width = 0;
    let height = 0;
    let raf = 0;
    let points = [];
    let pulse = null;
    let card = null;
    let cardPointer = null;

    function resize() {
      const ratio = Math.min(1.5, window.devicePixelRatio || 1);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      clearPointer();
    }

    function frame(now) {
      raf = 0;
      if (cardPointer && card?.isConnected) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--light-x', `${cardPointer.x - rect.left}px`);
        card.style.setProperty('--light-y', `${cardPointer.y - rect.top}px`);
      }
      cardPointer = null;
      points = points.filter(point => now - point.at < trailLife);
      if (pulse && now - pulse.at >= pulseLife) pulse = null;
      context.clearRect(0, 0, width, height);
      if (!points.length && !pulse) { delete canvas.dataset.tracing; return; }
      drawPrism(context, points, pulse, Math.max(now, points.at(-1)?.at || 0, pulse?.at || 0));
      canvas.dataset.tracing = '';
      raf = window.requestAnimationFrame(frame);
    }

    function followPointer(event) {
      if (!['mouse', 'pen'].includes(event.pointerType)) return;
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('.studio-stage, .export-video')) { clearPointer(); return; }
      const target = element?.closest('[data-spotlight]') || null;
      if (target !== card) {
        card?.removeAttribute('data-lit');
        card = target;
        card?.setAttribute('data-lit', 'true');
      }
      cardPointer = card ? { x: event.clientX, y: event.clientY } : null;
      const point = { x: event.clientX + 12, y: event.clientY + 12, at: performance.now() };
      const last = points.at(-1);
      if (last && (point.at - last.at > 135 || Math.hypot(point.x - last.x, point.y - last.y) > 155)) points = [];
      if (!last || !points.length || Math.hypot(point.x - last.x, point.y - last.y) >= 2) points = [...points.slice(-27), point];
      if (!raf) raf = window.requestAnimationFrame(frame);
    }

    function reflectClick(event) {
      if (!['mouse', 'pen'].includes(event.pointerType) || event.button !== 0 ||
          !(event.target instanceof Element && event.target.closest('[data-spotlight], .primary:not(:disabled)'))) return;
      pulse = { x: event.clientX, y: event.clientY, at: performance.now() };
      if (!raf) raf = window.requestAnimationFrame(frame);
    }

    function clearPointer() {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      points = [];
      pulse = null;
      card?.removeAttribute('data-lit');
      card = null;
      cardPointer = null;
      if (canvas.hasAttribute('data-tracing')) context?.clearRect(0, 0, width, height);
      delete canvas.dataset.tracing;
    }

    function stopTracking() {
      host.removeEventListener('pointermove', followPointer);
      host.removeEventListener('pointerdown', reflectClick);
      host.removeEventListener('pointerleave', clearPointer);
      window.removeEventListener('blur', clearPointer);
      window.removeEventListener('resize', resize);
      clearPointer();
    }

    function syncPreference() {
      if (!preference.matches) { stopTracking(); return; }
      context ??= canvas.getContext('2d');
      if (!context) return;
      resize();
      host.addEventListener('pointermove', followPointer, { passive: true });
      host.addEventListener('pointerdown', reflectClick, { passive: true });
      host.addEventListener('pointerleave', clearPointer);
      window.addEventListener('blur', clearPointer);
      window.addEventListener('resize', resize);
    }

    syncPreference();
    preference.addEventListener('change', syncPreference);
    return () => { preference.removeEventListener('change', syncPreference); stopTracking(); };
  }, [surface]);

  return <>
    <div aria-hidden="true" className={'studio-lighting' + (overview ? ' studio-lighting-overview' : '')}/>
    <canvas aria-hidden="true" className={'studio-prism' + (overview ? ' studio-prism-overview' : '')} ref={canvasRef}/>
  </>;
}
