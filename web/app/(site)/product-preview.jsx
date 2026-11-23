'use client';

import { motion, useReducedMotion } from 'motion/react';

export default function ProductPreview() {
  const reduceMotion = useReducedMotion();

  return <motion.figure
    className="site-preview"
    initial={false}
    animate={reduceMotion === false ? { y: [12, 0] } : { y: 0 }}
    transition={{ duration: 0.45, ease: 'easeOut' }}
  >
    <img className="site-preview-desktop" src="/official-workbench.webp" width="1120" height="747"
      alt="镜序分镜编辑界面，显示镜头列表、竖屏画面、镜头详情和时间轴" fetchPriority="high"/>
    <div className="site-preview-portrait">
      <img src="/workspace-hero.webp" alt="示例短剧中，人物在暖光厨房里回头"/>
    </div>
    <figcaption>镜序分镜界面与竖屏画面示例</figcaption>
  </motion.figure>;
}
