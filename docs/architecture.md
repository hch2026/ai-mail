# 163 IMAP 只读同步与分类器架构

## 当前边界

`index.ts` 加载 IMAP 同步器、SQLite 仓储、分类器和本地分类管理 API。分类器必须读取到用户已确认的分类体系才会处理邮件；确认分类体系会启动历史回填，但所有邮箱连接仍为只读，邮箱写操作路由不存在。

```text
163 IMAP
  │ TLS + readOnly mailbox lock
  │ envelope / flags / bodyStructure
  ▼
SyncCoordinator
  ├─ IDLE
  ├─ poll fallback
  └─ exponential reconnect backoff
  ▼
SyncService ── SQLite lease ── MailRepository ── SQLite/WAL
    │                         ▲                 ▲
    │ confirmed taxonomy     │ atomic claim    │ local management API
    └─ ClassificationService ┴─ Zod validation └─ React three-pane UI
```

## 邮件身份与重启恢复

本地账号键为邮箱地址的 SHA-256，不保存邮箱登录地址明文。邮件唯一键是：

```text
(account_key, mailbox path, UIDVALIDITY, UID)
```

每个 UID 页面成功写入后更新 `mailboxes.highest_uid`。进程重启后从该 UID 继续搜索；即使上一进程在更新游标前中断，邮件 upsert 唯一键也会阻止重复插入。

UIDVALIDITY 变化表示服务器开启了新的 UID 纪元。系统会创建新的 `mailboxes` 行并从 UID 0 重新同步，旧纪元留在本地用于审计，因此相同 UID 不会错误覆盖旧邮件。

## 未读保护

- `getMailboxLock(..., { readOnly: true })` 强制只读打开邮箱。
- 同步只请求 envelope、flags、internalDate、size 和 bodyStructure，不请求正文。
- 独立正文读取能力使用 ImapFlow `download()`，其语义等效于 `BODY.PEEK[part]`，不会添加 `\\Seen`。
- IMAP 接口没有 flags 写入、MOVE、COPY、DELETE、APPEND 或 EXPUNGE 方法。
- `DRY_RUN` 只能为 `true`；配置为 `false` 时启动校验失败。

## 敏感信息

邮箱地址和授权码仅从 server 环境变量传入。ImapFlow 自身日志关闭；业务日志不记录配置对象。同步器会在异常进入 Pino 或 SQLite 失败表之前：

1. 精确替换当前授权码；
2. 脱敏 password/auth/token/secret/code 形式的键值；
3. 截断异常文本。

Pino 另外对 `MAIL_AUTH_CODE`、`pass`、`password`、Authorization 和 Cookie 字段进行结构化脱敏。

## 并发与长期运行

- SQLite `sync_locks` 租约保证同一账号只能有一个同步任务。
- 进程内重复触发共享同一个同步 Promise。
- IDLE 断线后使用带抖动的指数退避；连续失败达到阈值后进入轮询。
- 每次等待完成都会移除 AbortSignal 监听器，避免长期重连造成监听器泄漏。

## 分类安全与幂等

- AI 请求使用 system/user 角色隔离，邮件内容被标记为不可信数据，并转义可闭合隔离区块的尖括号。
- 模型没有工具定义，也没有邮箱、环境变量或数据库访问能力。
- JSON Schema 约束模型响应，返回后再由 Zod 严格校验；未知字段、非法标签和低置信度却未选择 `review` 的结果均被拒绝。
- `emails.classification_status = classifying` 是数据库原子领取标记。已有相同 taxonomy 的分类、正在处理的邮件和失败任务都不会被自动再次调用模型。
- 成功结果记录模型版本、处理时间、置信度、原因和模型原始 JSON；低于 `0.75` 的结果进入 `review`。
- 分类只写本地 SQLite，不调用任何 IMAP 写操作。

## React 管理页面

- 左侧展示全部邮件、未读、待处理、待复核和已确认分类标签的未读数。
- 中间邮件列表支持发件人、时间、未读、待处理、待复核及主分类筛选。
- 右侧详情抽屉可人工调整主分类与附加状态，或显式重新分类，并显示置信度、原因和修改历史。
- 正文仅渲染清洗后的纯文本，不创建链接、脚本或外链图片节点。
- 桌面端使用固定标签侧栏；窄屏使用覆盖式可收起侧栏，避免横向页面溢出。
