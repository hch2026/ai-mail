# 163 / QQ 多邮箱 IMAP 同步与分类器

当前运行入口支持 163 与 QQ 邮箱独立 IMAP 同步、独立分类体系和本地分类管理。两个邮箱共用查看、正文、附件、分类和删除代码，但同步游标、UIDVALIDITY、后台任务、分类体系及写权限按账户隔离。项目不提供永久清空、归档、标记已读或 SMTP 发信能力。

## 已实现

- 通过 TLS 连接 163 IMAP，邮箱锁强制以 `readOnly: true` 打开
- 首次按 UID 分页同步整个 `INBOX`
- 后续从数据库保存的最高 UID 增量同步
- 以 `(account, mailbox, UIDVALIDITY, UID)` 唯一识别邮件
- UIDVALIDITY 改变时创建独立邮箱纪元，不把复用的 UID 当成旧邮件
- 重启后继续使用 SQLite 游标，重复抓取也会由唯一键安全去重
- 保存发件人、主题、时间、flags、Message-ID、正文 part 标识和附件元数据
- 附件按需通过 BODY.PEEK 下载；PDF 显示文件图标，PNG/JPEG/GIF/WebP 可显示缩略图
- 同步阶段不读取正文；需要验证正文时只能通过 ImapFlow `download()` 的 `BODY.PEEK` 等效路径读取
- IMAP IDLE 优先，异常后指数退避并回退轮询
- SQLite 租约保证同一邮箱只有一个同步任务
- 授权码仅存在于服务端环境变量，错误、持久化失败记录和日志都会脱敏
- AI 返回值经过严格 Zod 校验，模型输出不符合结构时不会写入分类结果
- 每封邮件分类前通过数据库原子领取任务；并发同步、重复同步和进程重启不会重复调用模型
- 置信度低于 `0.75` 的结果保存为 `review`，记录模型、处理时间、置信度、原因和原始返回值
- 邮件内容以不可信数据区块传给模型，危险分隔符会转义，且请求不提供任何工具
- React 管理页面提供标签未读计数、邮件筛选、详情抽屉、人工分类、重新分类和分类历史
- 邮件正文以清洗后的文本和隔离 HTML 渲染，外链图片默认加载并可手动隐藏
- 批量删除只移动人工选中的邮件到服务器已存在的垃圾箱；移动前校验 UIDVALIDITY 和 UID，不执行永久 expunge

`DRY_RUN=true` 时批量删除只返回预计数量，不连接写邮箱。确认预演无误后可设置为 `false` 启用“移入垃圾箱”；同步、正文读取和分类仍保持只读。

## 配置

复制示例：

```bash
cp .env.example .env
```

163 必须填写：

```dotenv
MAIL_EMAIL=你的163邮箱地址
MAIL_AUTH_CODE=163邮箱设置中生成的客户端授权码
```

增加 QQ 邮箱时填写：

```dotenv
MAIL_QQ_ENABLED=true
MAIL_QQ_EMAIL=你的QQ邮箱地址
MAIL_QQ_AUTH_CODE=QQ邮箱设置中生成的授权码
MAIL_QQ_IMAP_HOST=imap.qq.com
MAIL_QQ_IMAP_PORT=993
MAIL_QQ_IMAP_SECURE=true
MAIL_QQ_WRITE_ENABLED=false
```

QQ 邮箱需要先在网页版“设置 → 账户”中开启 IMAP/SMTP 服务并生成授权码。项目只使用其中的 IMAP 能力，不会连接 SMTP。QQ 写操作默认关闭；完成只读同步、UIDVALIDITY 和删除预演验证后，才可把 `MAIL_QQ_WRITE_ENABLED` 改为 `true`。

不要填写网页登录密码。不要提交 `.env`；它已被 `.gitignore` 和 `.dockerignore` 排除。

如需使用模型分类器，另外填写：

```dotenv
AI_API_KEY=你的模型 API 密钥
AI_MODEL=支持 JSON Schema 输出的模型名
```

不填写时使用本地规则分类器。无论选择哪种分类器，都要先确认分类体系才会开始分类。

常用完整配置见 [.env.example](/Users/hch/Documents/ai163mail/.env.example)。163 默认连接参数为：

```dotenv
MAIL_IMAP_HOST=imap.163.com
MAIL_IMAP_PORT=993
MAIL_IMAP_SECURE=true
MAIL_MAILBOX=INBOX
DRY_RUN=true
```

要允许移动邮件到垃圾箱，分别设置 `MAIL_163_WRITE_ENABLED=true` 或 `MAIL_QQ_WRITE_ENABLED=true` 并重启服务。系统不会根据“广告”分类自动删除邮件；每次仍需人工选择并确认。

## 启动

要求 Node.js 20、pnpm 9：

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
pnpm dev
```

- Web：<http://localhost:5173>
- API：<http://localhost:3000>
- 健康检查：<http://localhost:3000/health>
- 本地 SQLite：`apps/server/data/mail.db`

网页关闭不会停止同步；Node 服务关闭后同步才会停止。

Docker 常驻运行：

```bash
docker compose up -d --build
docker compose logs -f server
```

Compose 使用 Docker 命名卷 `mail-data` 保存 SQLite，避免 macOS bind mount 与 SQLite WAL 文件锁冲突。不要同时运行 Docker 和本地 `pnpm dev`。容器使用 `restart: unless-stopped`；Docker Desktop 随系统登录启动后，容器会自动恢复。Docker 数据应通过 SQLite 在线备份导出，不要在容器运行时直接复制数据库文件。

## 当前 API

- `GET /health`
- `GET /api/accounts`（只返回服务商、显示名和写权限，不返回地址或授权码）
- `GET /api/dashboard`
- `GET /api/emails`
- `GET /api/emails/:id`
- `GET /api/emails/:id/attachments/:index`（按需下载，图片支持安全内联缩略图）
- `POST /api/emails/bulk-delete`（人工确认后移入垃圾箱；受 `DRY_RUN` 保护）
- `POST /api/emails/:id/reclassify`
- `PATCH /api/emails/:id/classification`
- `GET /api/labels`
- `GET /api/reviews`
- `POST /api/reviews/confirm`
- `POST /api/sync`
- `GET /api/sync/status`
- `GET /api/discovery/report`
- `POST /api/discovery/analyze`
- `GET /api/taxonomy/status`
- `POST /api/taxonomy/confirm`
- `POST /api/taxonomy/backfill/retry`

人工修改和复核只更新本地数据库；重新分类会通过只读 IMAP 会话读取必要数据。唯一的邮箱写操作是用户二次确认后的“移入垃圾箱”；归档、标记已读、永久清空和发信路由均不存在。

## 验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

重点测试覆盖：

- BODY.PEEK 等效读取前后 `isUnread` 保持不变
- 进程重启后从持久化最高 UID 继续，不重复插入
- UIDVALIDITY 变化后同 UID 被安全存入新纪元
- 授权码不出现在日志或数据库失败记录
- Zod 拒绝字段缺失、额外字段、非法标签及低置信度却未进入复核的模型结果
- 同一邮件的并发、重复和失败重试不会再次调用模型
- 提示词注入内容被视为不可信数据，不能闭合隔离区块，也不会获得工具
- 人工分类、显式重新分类和待处理筛选不会改变邮件未读状态
- 危险 HTML 被当作纯文本，外链图片不会加载
- 批量删除在 dry-run 下不写邮箱，正式执行前校验 UIDVALIDITY、UID 和可恢复垃圾箱
- 永久 expunge、归档、标记已读和发信接口不存在
