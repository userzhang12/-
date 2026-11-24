import Link from 'next/link';

export const metadata = {
  title: '隐私说明 · 镜序',
  description: '了解镜序如何处理账号、项目素材、生成任务和本地设置。',
};

export default async function PrivacyPage({ searchParams }) {
  const fromWorkbench = (await searchParams).from === 'workbench';
  return <main className="site-container site-privacy">
    <Link href={fromWorkbench ? "/workbench" : "/"}>{fromWorkbench ? "返回工作台" : "返回镜序官网"}</Link>
    <h1>隐私说明</h1>
    <section>
      <h2>账号与工作空间</h2>
      <p>镜序保存注册邮箱、工作空间信息和密码哈希，用于登录和权限验证。登录 Cookie 用于维持会话，退出登录会结束当前会话。服务使用请求来源和账户标识限制频繁登录等操作。启用邮件找回时，重置码会通过部署方配置的邮件服务发送。</p>
    </section>
    <section>
      <h2>项目与制作数据</h2>
      <p>你填写的商品资料、上传的图片、分镜、任务记录及生成的成片保存在工作空间内。获授权的成员可以访问其工作空间内的项目。生成的成片也可以下载到你的设备。</p>
    </section>
    <section>
      <h2>预览与供应商模式</h2>
      <p>邀请预览的制作任务由镜序服务器本地处理。启用供应商模式时，你提交的生成任务可能将所需的提示词、图片或台词发送给部署方配置的剧本、图片、视频或配音供应商。部署方也可以配置对象存储来保存素材和成片。</p>
    </section>
    <section>
      <h2>设备上的记录</h2>
      <p>工作台在当前浏览器或桌面客户端中保存最近项目和镜头的位置，以便继续制作。清理浏览器或客户端的站点数据会移除此设备上的记录。</p>
    </section>
    <section>
      <h2>数据请求</h2>
      <p>你可以在工作台的「帮助与客服 → 数据管理申请」提交获取或删除数据的申请，并查看结果。项目数据申请由空间管理员提交。提交申请后，部署管理员会核实范围与权限，再执行相应操作。若无法登录，请联系邀请你使用镜序的管理员。</p>
    </section>
  </main>;
}
