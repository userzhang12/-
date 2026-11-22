import '@fontsource-variable/noto-sans-sc';
import './styles.css';
import './studio-effects.css';
import './studio-typography.css';
import './project-overview.css';

export const metadata = {
  title: '镜序 · 短剧工作台',
  description: '从商品资料到竖屏成片的短剧制作工作台。',
};

export default function RootLayout({ children }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
