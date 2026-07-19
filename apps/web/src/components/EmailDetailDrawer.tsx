import {
  EditOutlined,
  DownloadOutlined,
  EyeInvisibleOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  HistoryOutlined,
  PaperClipOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from "@ant-design/icons";
import type { EmailAttachmentDto, TaxonomyLabel } from "@mail-ai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Flex,
  Image,
  Input,
  List,
  Progress,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { api } from "../api/client.js";
import { SafeBody } from "./SafeBody.js";

interface Props {
  emailId: number | null;
  labels: TaxonomyLabel[];
  onClose: () => void;
}

export function EmailDetailDrawer({ emailId, labels, onClose }: Props) {
  const queryClient = useQueryClient();
  const { message, modal } = App.useApp();
  const [primaryLabel, setPrimaryLabel] = useState<string>();
  const [actionRequired, setActionRequired] = useState(false);
  const [suspectedPromotion, setSuspectedPromotion] = useState(false);
  const [note, setNote] = useState("");

  const detail = useQuery({
    queryKey: ["email", emailId],
    queryFn: () => api.email(emailId!),
    enabled: emailId !== null,
  });
  const content = useQuery({
    queryKey: ["email-content", emailId],
    queryFn: () => api.emailContent(emailId!),
    enabled: emailId !== null,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!detail.data) return;
    setPrimaryLabel(detail.data.primaryLabel ?? undefined);
    setActionRequired(detail.data.actionRequired);
    setSuspectedPromotion(detail.data.suspectedPromotion);
    setNote("");
  }, [detail.data]);

  const refreshClassificationQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["email", emailId] }),
      queryClient.invalidateQueries({ queryKey: ["emails"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      queryClient.invalidateQueries({ queryKey: ["labels"] }),
      queryClient.invalidateQueries({ queryKey: ["taxonomy-status"] }),
    ]);
  };

  const save = useMutation({
    mutationFn: () => api.patchClassification(emailId!, {
      primaryLabel: primaryLabel!,
      actionRequired,
      suspectedPromotion,
      ...(note.trim() ? { note: note.trim() } : {}),
    }),
    onSuccess: async (result) => {
      queryClient.setQueryData(["email", emailId], result);
      message.success("分类已保存到本地");
      await refreshClassificationQueries();
    },
    onError: (error) => message.error(error.message),
  });

  const reclassify = useMutation({
    mutationFn: () => api.reclassify(emailId!),
    onSuccess: async (result) => {
      queryClient.setQueryData(["email", emailId], result);
      message.success("重新分类完成");
      await refreshClassificationQueries();
    },
    onError: (error) => message.error(error.message),
  });

  const confirmReclassify = () => modal.confirm({
    title: "重新调用分类器？",
    content: "这会覆盖当前本地分类并留下历史记录，不会修改邮箱中的邮件。",
    okText: "重新分类",
    cancelText: "取消",
    onOk: () => reclassify.mutateAsync(),
  });

  const classificationReady = labels.length > 0;
  const confidence = detail.data?.confidence;

  return (
    <Drawer
      open={emailId !== null}
      onClose={onClose}
      width="min(760px, 96vw)"
      title={<span className="drawer-title">邮件详情</span>}
      destroyOnClose
      extra={(
        <Tooltip title={classificationReady ? "使用已确认分类体系重新判断" : "请先确认分类体系"}>
          <Button
            icon={<ReloadOutlined />}
            loading={reclassify.isPending}
            disabled={!classificationReady || detail.isLoading}
            onClick={confirmReclassify}
          >
            重新分类
          </Button>
        </Tooltip>
      )}
    >
      {detail.isLoading ? <div className="drawer-loading"><Spin /></div> : detail.error ? (
        <Alert type="error" showIcon message={detail.error.message} />
      ) : detail.data ? (
        <div className="detail-content">
          <Typography.Title level={3} className="detail-subject">{detail.data.subject || "（无主题）"}</Typography.Title>
          <Flex justify="space-between" align="flex-start" gap={12} wrap>
            <div className="detail-sender">
              <span className="sender-avatar">{(detail.data.fromName || detail.data.fromAddress || "?").slice(0, 1).toUpperCase()}</span>
              <div>
                <Typography.Text strong>{detail.data.fromName || "未知发件人"}</Typography.Text>
                <Typography.Text type="secondary">{detail.data.fromAddress || "无地址"}</Typography.Text>
              </div>
            </div>
            <Space size={6} wrap>
              <Tag color={detail.data.isUnread ? "blue" : "default"}>{detail.data.isUnread ? "未读" : "已读"}</Tag>
              <Typography.Text type="secondary">
                {detail.data.sentAt ? dayjs(detail.data.sentAt).format("YYYY-MM-DD HH:mm") : "时间未知"}
              </Typography.Text>
            </Space>
          </Flex>

          <section className="classification-panel">
            <Flex justify="space-between" align="center" wrap gap={10}>
              <Typography.Title level={5}><EditOutlined /> 本地分类</Typography.Title>
              {confidence != null && (
                <Space>
                  <Typography.Text type="secondary">置信度</Typography.Text>
                  <Progress
                    percent={Math.round(confidence * 100)}
                    size="small"
                    status={confidence < 0.75 ? "exception" : "success"}
                    style={{ width: 128 }}
                  />
                </Space>
              )}
            </Flex>
            {!classificationReady && (
              <Alert type="warning" showIcon message="分类体系尚未确认，当前只能查看邮件" />
            )}
            <div className="classification-form">
              <label>
                <span>主分类</span>
                <Select
                  showSearch
                  value={primaryLabel}
                  placeholder="选择一个主分类"
                  disabled={!classificationReady}
                  onChange={setPrimaryLabel}
                  options={labels.map((item) => ({ label: item.label, value: item.label }))}
                  optionFilterProp="label"
                />
              </label>
              <div className="classification-switches">
                <label><Switch checked={actionRequired} disabled={!classificationReady} onChange={setActionRequired} /><span>需要处理</span></label>
                <label><Switch checked={suspectedPromotion} disabled={!classificationReady} onChange={setSuspectedPromotion} /><span>疑似推广</span></label>
              </div>
              <label>
                <span>修改备注（可选）</span>
                <Input.TextArea value={note} disabled={!classificationReady} maxLength={500} rows={2} onChange={(event) => setNote(event.target.value)} placeholder="记录人工判断依据" />
              </label>
              <Flex justify="space-between" align="center" wrap gap={12}>
                <Typography.Text type="secondary">{detail.data.reason || "尚无分类依据"}</Typography.Text>
                <Button type="primary" disabled={!classificationReady || !primaryLabel} loading={save.isPending} onClick={() => save.mutate()}>保存分类</Button>
              </Flex>
            </div>
            <Space size={[6, 6]} wrap className="classification-meta">
              {detail.data.needsReview && <Tag color="orange">待复核</Tag>}
              {detail.data.actionRequired && <Tag color="gold">待处理</Tag>}
              {detail.data.sourceLabels.map((label) => <Tag key={label}>{label}</Tag>)}
              {detail.data.modelVersion && <Tag bordered={false}>模型：{detail.data.modelVersion}</Tag>}
              {detail.data.processedAt && <Tag bordered={false}>分类于 {dayjs(detail.data.processedAt).format("YYYY-MM-DD HH:mm")}</Tag>}
            </Space>
          </section>

          <Divider orientation="left"><EyeInvisibleOutlined /> 安全正文</Divider>
          <Alert
            className="body-safety-note"
            type="info"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message="外链图片默认显示"
            description="这里只渲染服务端清洗后的文本与 HTML；脚本、表单和可点击链接不会执行，外链图片仍可手动隐藏。"
          />
          {content.error && <Alert type="error" showIcon message={content.error.message} />}
          <SafeBody
            text={content.data?.bodyText ?? detail.data.bodyText}
            html={content.data?.bodyHtml ?? detail.data.bodyHtml}
            loading={content.isLoading}
            remoteImageCount={content.data?.remoteImageCount ?? detail.data.remoteImageCount}
            inlineImageCount={content.data?.inlineImageCount ?? detail.data.inlineImageCount}
          />

          <Collapse
            key={detail.data.id}
            ghost
            className="detail-collapse"
            defaultActiveKey={detail.data.attachments.length > 0 ? ["attachments"] : []}
            items={[
            {
              key: "attachments",
              label: <span><PaperClipOutlined /> 附件（{detail.data.attachments.length}）</span>,
              children: (
                <List
                  className="attachment-list"
                  size="small"
                  dataSource={detail.data.attachments}
                  locale={{ emptyText: "无附件" }}
                  renderItem={(item) => (
                    <List.Item
                      className="attachment-item"
                      extra={(
                        <Space size={4}>
                          {isPreviewableAttachment(item) && (
                            <Button
                              type="link"
                              href={api.attachmentUrl(detail.data.id, item.index, true)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              新页面预览
                            </Button>
                          )}
                          <Button
                            type="link"
                            icon={<DownloadOutlined />}
                            href={api.attachmentUrl(detail.data.id, item.index)}
                          >
                            下载
                          </Button>
                        </Space>
                      )}
                    >
                      <List.Item.Meta
                        avatar={<AttachmentVisual emailId={detail.data.id} attachment={item} />}
                        title={isPreviewableAttachment(item) ? (
                          <Typography.Link
                            href={api.attachmentUrl(detail.data.id, item.index, true)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {item.filename || "未命名附件"}
                          </Typography.Link>
                        ) : item.filename || "未命名附件"}
                        description={`${displayContentType(item)}${item.size === null ? "" : ` · ${formatBytes(item.size)}`}`}
                      />
                    </List.Item>
                  )}
                />
              ),
            },
            {
              key: "technical",
              label: "邮件技术信息",
              children: (
                <Descriptions column={1} size="small">
                  <Descriptions.Item label="Mailbox">{detail.data.mailbox}</Descriptions.Item>
                  <Descriptions.Item label="UIDVALIDITY / UID">{detail.data.uidValidity} / {detail.data.uid}</Descriptions.Item>
                  <Descriptions.Item label="Message-ID">{detail.data.messageId || "—"}</Descriptions.Item>
                  <Descriptions.Item label="IMAP flags">{detail.data.flags.length ? detail.data.flags.join(", ") : "无"}</Descriptions.Item>
                </Descriptions>
              ),
            },
            {
              key: "history",
              label: <span><HistoryOutlined /> 分类历史（{detail.data.history.length}）</span>,
              children: detail.data.history.length ? (
                <Timeline items={detail.data.history.map((item) => ({
                  children: <div><Typography.Text strong>{actorName(item.actor)}</Typography.Text><br /><Typography.Text type="secondary">{dayjs(item.createdAt).format("YYYY-MM-DD HH:mm:ss")}{item.note ? ` · ${item.note}` : ""}</Typography.Text></div>,
                }))} />
              ) : <Typography.Text type="secondary">尚无修改记录</Typography.Text>,
            },
            ]}
          />
        </div>
      ) : null}
    </Drawer>
  );
}

function actorName(actor: string): string {
  return ({ ai: "AI 分类", rule: "本地规则分类", manual: "人工修改", "bulk-confirm": "批量确认" }[actor] ?? actor);
}

function AttachmentVisual({ emailId, attachment }: { emailId: number; attachment: EmailAttachmentDto }) {
  const [failed, setFailed] = useState(false);
  const kind = attachmentKind(attachment);
  if (kind === "image" && !failed) {
    const source = api.attachmentUrl(emailId, attachment.index, true);
    return (
      <Image
        className="attachment-thumbnail"
        src={source}
        alt={attachment.filename || "图片附件缩略图"}
        width={72}
        height={56}
        preview={{ src: source, mask: "点击预览" }}
        onError={() => setFailed(true)}
      />
    );
  }
  if (kind === "pdf") return <FilePdfOutlined className="attachment-file-icon attachment-pdf-icon" />;
  if (kind === "image") return <FileImageOutlined className="attachment-file-icon" />;
  return <FileOutlined className="attachment-file-icon" />;
}

function attachmentKind(attachment: EmailAttachmentDto): "pdf" | "image" | "file" {
  const filename = attachment.filename?.toLowerCase() ?? "";
  if (attachment.contentType.toLowerCase() === "application/pdf" || filename.endsWith(".pdf")) return "pdf";
  if (/^image\/(?:png|jpe?g|gif|webp)$/i.test(attachment.contentType) || /\.(?:png|jpe?g|gif|webp)$/i.test(filename)) return "image";
  return "file";
}

function displayContentType(attachment: EmailAttachmentDto): string {
  const kind = attachmentKind(attachment);
  if (kind === "pdf") return "PDF 文档";
  if (kind === "image") return "图片";
  return attachment.contentType;
}

function isPreviewableAttachment(attachment: EmailAttachmentDto): boolean {
  const kind = attachmentKind(attachment);
  return kind === "pdf" || kind === "image";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
