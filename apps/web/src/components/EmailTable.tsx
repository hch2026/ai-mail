import { ClockCircleOutlined, RightOutlined } from "@ant-design/icons";
import type { EmailListItemDto } from "@mail-ai/shared";
import { Progress, Table, Tag, Typography } from "antd";
import type { TableProps } from "antd";
import dayjs from "dayjs";

interface Props {
  items: EmailListItemDto[];
  loading: boolean;
  total: number;
  page: number;
  pageSize: number;
  selectedId?: number | null;
  onPageChange: (page: number, pageSize: number) => void;
  onOpen: (id: number) => void;
  selectable?: boolean;
  selectedIds?: React.Key[];
  onSelectionChange?: (ids: React.Key[]) => void;
}

export function EmailTable(props: Props) {
  const columns: TableProps<EmailListItemDto>["columns"] = [
    {
      key: "unread",
      width: 26,
      render: (_, item) => <span className={item.isUnread ? "message-unread-indicator" : "message-read-indicator"} aria-label={item.isUnread ? "未读" : "已读"} />,
    },
    {
      key: "sender",
      width: 190,
      ellipsis: true,
      render: (_, item) => (
        <div className="message-sender">
          <Typography.Text strong={item.isUnread}>{item.fromName || item.fromAddress || "未知发件人"}</Typography.Text>
          {item.fromName && <Typography.Text type="secondary">{item.fromAddress}</Typography.Text>}
        </div>
      ),
    },
    {
      key: "label",
      width: 142,
      render: (_, item) => item.primaryLabel
        ? <Tag className="primary-label-tag" color={labelColor(item.primaryLabel)}>{item.primaryLabel}</Tag>
        : <Tag bordered={false}>尚未分类</Tag>,
    },
    {
      key: "message",
      ellipsis: true,
      render: (_, item) => (
        <div className="message-summary">
          <Typography.Text strong={item.isUnread}>{item.subject || "（无主题）"}</Typography.Text>
          <Typography.Text type="secondary"> — {item.preview || "暂无邮件摘要"}</Typography.Text>
          <span className="message-flags">
            {item.actionRequired && <Tag color="gold">待处理</Tag>}
            {item.needsReview && <Tag color="orange">待复核</Tag>}
            {item.suspectedPromotion && <Tag color="magenta">疑似推广</Tag>}
          </span>
        </div>
      ),
    },
    {
      key: "confidence",
      width: 72,
      align: "center",
      render: (_, item) => item.confidence === null ? null : (
        <Progress
          type="circle"
          size={28}
          percent={Math.round(item.confidence * 100)}
          strokeWidth={9}
          format={(value) => <span className="confidence-value">{value}</span>}
          strokeColor={item.confidence < 0.75 ? "#f59e0b" : "#22a06b"}
        />
      ),
    },
    {
      key: "time",
      width: 112,
      align: "right",
      render: (_, item) => (
        <span className="message-time">
          {item.sentAt ? dayjs(item.sentAt).format(dayjs(item.sentAt).isSame(dayjs(), "year") ? "MM-DD HH:mm" : "YYYY-MM-DD") : "—"}
        </span>
      ),
    },
    { key: "open", width: 28, render: () => <RightOutlined className="row-arrow" /> },
  ];

  return (
    <Table
      className="gmail-table"
      rowKey="id"
      columns={columns}
      dataSource={props.items}
      loading={props.loading}
      showHeader={false}
      tableLayout="fixed"
      scroll={{ x: 900 }}
      rowClassName={(item) => [item.isUnread ? "unread-row" : "", props.selectedId === item.id ? "selected-row" : ""].filter(Boolean).join(" ")}
      onRow={(item) => ({ onClick: () => props.onOpen(item.id) })}
      {...(props.selectable
        ? {
            rowSelection: {
              ...(props.selectedIds ? { selectedRowKeys: props.selectedIds } : {}),
              onChange: (keys: React.Key[]) => props.onSelectionChange?.(keys),
              onCell: () => ({ onClick: (event: React.MouseEvent) => event.stopPropagation() }),
            },
          }
        : {})}
      locale={{ emptyText: <div className="mail-empty"><ClockCircleOutlined /><span>没有符合条件的邮件</span></div> }}
      pagination={{
        current: props.page,
        pageSize: props.pageSize,
        total: props.total,
        showSizeChanger: true,
        pageSizeOptions: [20, 30, 50, 100],
        showTotal: (total, range) => `${range[0]}–${range[1]} / 共 ${total} 封`,
        onChange: props.onPageChange,
      }}
    />
  );
}

function labelColor(label: string): string {
  const colors = ["blue", "cyan", "geekblue", "green", "purple", "volcano", "gold", "magenta"];
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return colors[hash % colors.length]!;
}
