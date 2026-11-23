# 镜序 · JINGXU STUDIO

面向微信视频号创作者的中文短剧工作台。商品资料经确认后进入资产管理、120 秒剧本、逐镜审核、渲染和 MP4 导出。项目保留任务进度、成本、素材版本和投放记录。

## 本地启动

需要 Node.js 20.9+、Python 3.11+、FFmpeg（含 libass）和中文字体（如 Noto Sans CJK SC）。一键脚本还需要 Bash 4.3+ 和 curl。推荐 Linux；Windows 可使用 WSL 2 的 Linux 环境。macOS 如果使用系统自带的旧版 Bash，可以改用新版 Bash 或按下面的三条命令分别启动。

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install -r api/requirements.txt
npm --prefix web ci
```

在仓库根目录分别启动以下命令。先启动 API，再启动 Worker。两者必须使用相同的环境变量。

```bash
python -m uvicorn api.main:app --host 0.0.0.0 --port 8000
python -m api.worker
npm --prefix web run dev -- --hostname 0.0.0.0 --port 3000
```

在浏览器访问端口 3000。默认示例可切换镜头并预览。新建真实项目后可试用完整生成流程。演示模式使用模板剧本、参考图、静帧动效和模拟费用。普通话配音随 Python 依赖安装，可在分镜台词区试听。默认使用离线 eSpeak NG 音色，只有无台词的镜头保留静音。合成时按实测音频时长对齐字幕。

## 供应商和工作空间

从 `.env.example` 建立环境变量配置，通过运行环境或受控的配置文件注入。启动时加载时应导出变量，例如在各服务启动前执行 `set -a; source .env; set +a`。正式环境使用 PostgreSQL（`DATABASE_URL=postgresql+psycopg://...`）、HTTPS、`JINGXU_SECURE_COOKIE=1`、私有 S3 兼容存储和随机的 `JINGXU_DOWNLOAD_KEY`。`API_ORIGIN` 默认为 `http://127.0.0.1:8000`，部署前端构建和运行时均可按拓扑设定。

- **账号与配额**。关闭演示模式。运营方用受控的 `JINGXU_WORKSPACE_CODE` 发放首个管理员注册权限，工作空间管理员在设置中生成一次性成员邀请。用量按空间汇总，初始累计配额由 `JINGXU_WORKSPACE_QUOTA_CENTS` 控制。真实供应商模式自动关闭匿名演示。将已验证归属的平台管理员邮箱填入 `JINGXU_OPERATOR_EMAILS` 后，使用独立且仅平台持有的 `JINGXU_OPERATOR_CODE` 注册，再访问运营面板并调整空间额度。
- **账单**。按实际账号的计价单位配置 `JINGXU_PRICES_CENTS`。金额为整数分，配置值应覆盖对应请求的上界。长视频单价 `dynamic_clip_sec` 要按至少每秒的保守成本填写，使 `static_clip + 10 × dynamic_clip_sec` 可覆盖 10 秒片段和配音。管理员按供应商账单登记结算。未知订单保留占额，有订单号时可继续查询原订单。超过预留的实际费用会记录到费用明细。
- **模型**。配置 DeepSeek 和火山引擎的 Key、实际已开通的图片模型及支持 10 秒图生视频的模型。可选的外部配音端点接受 `POST {"text":"…","language":"zh-CN"}` 并返回可由 FFmpeg 读取的音频字节。音频文件 `JINGXU_BGM_FILE` 可用于背景混音。
- **授权数据源**。商品链接配置为外部商品页到授权 HTTPS JSON 数据接口的映射，入库时按键值提取并等待确认。热点源返回包含 `text`、`source`、`date`、`expires` 和 `tags` 的 JSON 数组。Worker 每小时同步，管理员也可手工导入。
- **投放 CSV**。表头为 `version,date,impressions,retained_3s,mid_views,clicks,orders`。版本填写导出的 MP4 文件名。同成片版本和日期的重复行按最新值更新。

## 验证

隔离环境启动 API 与 Worker 后运行 `python tests/smoke.py`。测试会创建项目、上传实拍替代素材、审核和渲染 12 个片段、重算单镜、导出并通过 ffprobe 检查规格，以及验证 CSV 去重。用 `JINGXU_TEST_URL` 设置目标 API 地址。

`tests/isolation.py` 用于单独的 PostgreSQL 测试库，API 和测试进程使用相同的 `DATABASE_URL` 和测试注册口令，使用 `PYTHONPATH=. python tests/isolation.py` 运行。`tests/recovery.py` 使用空的本地数据目录，分别验证本地任务恢复、带订单号的恢复和未知订单占额。

真实成本验收需要授权素材、开通的模型与账单。配置完成后，逐条核对三条真实样片的商品外观、宣传信息、音视频质量和直接生成费用。

已安装依赖后，可用 `./scripts/start.sh` 统一加载环境配置并启动三个进程。在云环境重启后也可重新运行此命令。使用 `./scripts/start.sh --live` 会先检查付费模式所需的供应商配置和价格表格式，再启动服务。配置检查本身不发起付费调用。请通过环境设置或受控的本地配置文件提供密钥。

云端部署、Windows 签名构建和更新操作见 [发布手册](deploy/README.md)。本地启动后，访问 `/` 可查看官网及 Windows 下载，访问 `/workbench` 可打开工作台。
