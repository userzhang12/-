# 镜序发布手册

## 云端服务

1. 在 Linux 服务器安装 Docker Engine 和 Compose，准备域名并将 DNS 指向服务器。开放 TCP 80/443，数据库和 API 端口保持在 Compose 网络内。
2. 从仓库根目录执行下面的初始化。使用随机十六进制数据库密码，避免它作为连接字符串的一部分时需要 URL 编码。单独生成下载签名密钥。将注册口令、供应商密钥及正式价格表写入服务端文件。

```bash
cp deploy/production.env.example deploy/production.env
cp deploy/service.env.example deploy/service.env
mkdir -p deploy/published
chmod 600 deploy/production.env deploy/service.env
docker compose --env-file deploy/production.env -f deploy/compose.yml up -d --build
```

3. 路由上，官网位于 `/`，网页版和客户端入口位于 `/workbench`，安装和更新静态文件位于 `/desktop/`。Caddy 管理 HTTPS，API 由同域反代。正式部署关闭匿名演示，使用安全 Cookie。可从 HTTPS 请求 `/api/health` 检验 API 和数据库。
4. 正式服务可设私有 S3 兼容对象存储。API 与 Worker 共用媒体卷作为处理缓存。多主机扩容前，需验证对象存储能够恢复单镜中间产物及成片。数据库和媒体的备份应加密，定期在隔离环境恢复验证。应用版本更新前先备份数据库，以便恢复到兼容版本。

```bash
umask 077
docker compose --env-file deploy/production.env -f deploy/compose.yml exec -T db \
  pg_dump -U jingxu -d jingxu -Fc > "jingxu-$(date +%F).dump"
```

供应商返回的远程媒体只从 `JINGXU_MEDIA_HOSTS` 列出的 HTTPS 域名下载。该变量写入 `deploy/service.env`，使用逗号分隔的完整主机名。正式环境启用方舟之前，先填入供应商实际使用的媒体域名并在内测环境核对图像、尾帧和视频下载。预览模式的本地渲染无需该配置。

## 暂无域名时的服务器本机验证

在 Ubuntu 24.04 服务器上安装 Git、Docker 和 Compose v2，然后运行：

```bash
sudo bash deploy/bootstrap-local.sh
```

脚本只绑定服务器的 `127.0.0.1:80/443`，保持登录要求，并使用本机证书完成 HTTPS 健康检查。首次运行会在 `deploy/` 下生成权限受限的数据库密码、下载签名密钥和工作空间注册码文件。重复执行会保留已有配置。购买域名并完成 A 记录后，运行 `sudo bash deploy/enable-domain.sh 网站域名 服务器公网IPv4`。脚本会核对 DNS、保留数据库和账号配置，再开启公网 HTTPS。

## Windows 安装包

免费签名的项目资料和 Codex 交接提示词见 [SignPath 申请稿](signpath-application.md)。

- 首版目标为 Windows 10/11 x64。客户端访问可信 HTTPS 工作台，模型、队列和 Python/FFmpeg 留在服务器。
- 在 GitHub 配置 `desktop-beta` 与 `desktop-stable` 两个 Environment。各自配置变量 `JINGXU_APP_URL=https://域名/workbench`、`JINGXU_RELEASE_ROOT=https://域名/desktop/`、`JINGXU_SIGNER_NAME=签名证书主体通用名称`。配置相应签名凭据 `WINDOWS_CSC_LINK` 与 `WINDOWS_CSC_KEY_PASSWORD`。当前流程要求可供 CI 使用的 Windows 代码签名证书；只支持硬件托管签名的证书需要接入其签名服务。
- 修改 `desktop/package.json` 和锁文件中的版本。正式版使用 `X.Y.Z`，内测版使用 `X.Y.Z-beta.N`。维护 `release/notes.md` 并在 GitHub Actions 手工触发 **Build signed Jingxu for Windows**。CI 检查客户端程序和安装器的 Authenticode 签名后，生成对应渠道的安装包、差分文件、更新清单和官网清单。
- 下载 CI 产物并解压到临时目录，用以下命令发布到服务器。发布工具校验摘要和版本，先写安装文件，再替换更新和下载清单。内测和正式版使用不同的安装标识，各自订阅对应目录。保留旧安装包用于手工回退；修复坏版本时以更高版本重新发布。

```bash
node release/publish.mjs beta /path/to/unpacked-artifact deploy/published
node release/publish.mjs stable /path/to/unpacked-artifact deploy/published
```

官网会显示正式版版本说明、安装包 SHA-256 和下载入口。首次安装前请核对 Windows 所显示的发布者。客户端启动时和运行期间定期检查更新，用户可选择下载及重启安装；下载任务进行时会提示等待。安装前应保存编辑内容。已提交的云端渲染在客户端退出后继续运行。

### 本地 Windows 测试包

在仓库根目录安装桌面端依赖，并设置工作台地址后构建。PowerShell 示例：

```powershell
npm --prefix desktop ci
$env:JINGXU_APP_URL = 'https://jingxu.shop/workbench'
npm --prefix desktop run build:win:test
```

测试安装包输出到 `desktop/dist-test/`，与正式版使用独立安装标识，关闭自动更新。测试包未签名，仅用于受控设备上的安装和功能验收。

## 零签名费邀请预览

用独立的预览部署、数据库和域名。预览供真实 Windows 安装和基础流程验收。启用后 API 和 Worker 只用本地剧本模板、参考图、离线配音和 FFmpeg。启动时会检查并拒绝模型、远程配音、对象存储及远程资料源配置。现有服务器的存储、带宽和计算仍会消耗资源。

1. 在预览部署的 `deploy/service.env` 设置 `JINGXU_INVITE_PREVIEW=1`。从示例配置开始，保持付费模型、远程配音、S3、远程商品与热点来源，以及平台运营账号配置为空。使用独立数据卷和有效 HTTPS，再按本手册的部署步骤启动服务。
2. 在预览部署所在仓库执行下面的命令，起步发 5 个邀请码。每个码 24 小时内可用一次，每位测试者注册时会获得独立工作空间。已注册人数和未使用的有效码合计最多 10，工作空间初始额度为 5000 模拟分。

   ```bash
   sudo docker compose --env-file deploy/production.env -f deploy/compose.yml exec -T api python -m api.preview --count 5
   ```

3. 用预览域名作为 `JINGXU_APP_URL` 构建 Windows 测试包，先在干净的 Windows 电脑验证安装、登录和导出，再私下把安装包和独立邀请码交给测试者。测试包未签名，可能触发 Windows 的发布者提示。官网正式下载清单继续使用签名发布流程。
4. 想停止接受新测试者时，可撤销尚未使用的码。想结束已注册用户的试用，应停止独立预览环境的 API 和 Worker，保留数据卷。已分发的安装包仍留在用户设备上。

   ```bash
   sudo docker compose --env-file deploy/production.env -f deploy/compose.yml exec -T api python -m api.preview --revoke-unused
   ```

### 在官网开放预览包下载

验证在真实 Windows 上可以安装、登录和导出，并启用上面的邀请预览后，可把未签名测试包放到 Caddy 与 Web 共同挂载的发布目录。默认目录为 `deploy/published/preview/`，使用自定义 `JINGXU_RELEASE_STORAGE` 时在对应目录下创建 `preview/`。

从仓库根目录生成清单。若服务器没有 Node.js，可在构建安装包的电脑上生成 JSON，再一并上传。

```bash
node release/preview.mjs /path/to/jingxu-test-setup-0.1.0-x64.exe > preview-release.json
```

先将安装包放入 `preview/`，检查文件大小和 SHA-256，再将清单放入同一目录并命名为 `release.json`。官网在正式版尚未发布、清单和文件匹配时显示预览下载，并提示未签名、账号需邀请码。正式更新清单仅用于已签名的稳定版或内测版。撤下预览时移出清单及安装包，并保留已下载副本可能继续存在的预期。

## 发版验收

先将两个连续版本发到内测渠道，用干净 Windows 机器从安装、登录、上传、生成、下载一直走到自动升级。检查任务和账单在升级后仍可查到，并验证旧客户端能与新版 API 共存。等上述流程和实际供应商费用核对完，再晋升正式渠道。云端和 Windows 客户端可以独立发布，但需要保留旧版客户端所依赖的接口和更新文件。

如果服务器使用企业出站 TLS 代理，可以在构建时追加 `-f deploy/build-ca.compose.yml`，并设置 `JINGXU_BUILD_CA_FILE` 为经过确认的 CA bundle 绝对路径。证书验证保持开启，该文件只在依赖安装步骤挂载。

## 协助重置账号密码

用户可以在工作空间设置中修改自己的密码。忘记密码时，部署管理员先核实申请者身份，再在服务器的交互终端运行：

```bash
docker compose --env-file deploy/production.env -f deploy/compose.yml exec api python -m api.account USER_EMAIL
```

按提示输入并确认临时密码。密码输入不会回显，现有登录会话会失效。通过可信的私密渠道交付临时密码，让用户登录后立即修改。

如需启用自助找回，在 `deploy/service.env` 设置 `JINGXU_SMTP_HOST`、`JINGXU_SMTP_PORT` 和 `JINGXU_SMTP_FROM`。使用端口 465 的 TLS 或端口 587 的 STARTTLS。中继要求认证时同时设置 `JINGXU_SMTP_USER` 和 `JINGXU_SMTP_PASSWORD`。重新创建 API 容器后，登录页会出现「忘记密码」。用受控测试邮箱验证收件后再对用户开放。重置码 15 分钟有效，同一账号 2 分钟内只生成一次。

## 查看与处理数据管理申请

用户可从工作台的「帮助与客服」提交申请。项目申请由工作空间管理员提交。部署管理员可在受限的服务器终端查看待处理申请：

```bash
docker compose --env-file deploy/production.env -f deploy/compose.yml exec api python -m api.data_requests list
```

请求清单包含邮箱和项目标识，请通过私人渠道核实申请者、权限、处理范围和结果交付方式。对于删除请求，处理前核对正在运行的任务、对象存储和备份。完成实际处理后登记结果：

```bash
docker compose --env-file deploy/production.env -f deploy/compose.yml exec api python -m api.data_requests close REQUEST_ID completed
```

拒绝申请时用 `declined`。状态命令只记录处理结果。
