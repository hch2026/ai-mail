import { CloudSyncOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Flex, Space, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";

import { api, type SyncFailureDto, type SyncRunDto } from "../api/client.js";

export function SyncPanel({ accountId }: { accountId: string | undefined }) {
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["sync-status", accountId], queryFn: () => api.syncStatus(accountId), refetchInterval: 10_000 });
  const sync = useMutation({
    mutationFn: () => api.sync(accountId),
    onSuccess: async () => {
      message.success("同步任务已触发");
      await queryClient.invalidateQueries({ queryKey: ["sync-status", accountId] });
    },
    onError: (error) => message.error(error.message),
  });

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card variant="borderless">
        <Flex justify="space-between" align="center" wrap gap={12}>
          <div>
            <Typography.Title level={3}><CloudSyncOutlined /> 同步中心</Typography.Title>
            <Typography.Text type="secondary">后台服务独立于浏览器常驻运行，优先使用 IDLE。</Typography.Text>
          </div>
          <Button type="primary" icon={<ReloadOutlined />} loading={sync.isPending} onClick={() => sync.mutate()}>立即同步</Button>
        </Flex>
        <Descriptions className="sync-status" column={{ xs: 1, sm: 2, lg: 4 }}>
          <Descriptions.Item label="后台任务">{status.data?.running ? <Tag color="green">运行中</Tag> : <Tag>已停止</Tag>}</Descriptions.Item>
          <Descriptions.Item label="连接模式"><Tag color={status.data?.mode === "idle" ? "blue" : "orange"}>{status.data?.mode?.toUpperCase() || "—"}</Tag></Descriptions.Item>
          <Descriptions.Item label="Dry-run">{status.data?.dryRun ? <Tag color="purple">已启用</Tag> : <Tag>关闭</Tag>}</Descriptions.Item>
          <Descriptions.Item label="连续失败">{status.data?.consecutiveFailures ?? 0}</Descriptions.Item>
        </Descriptions>
      </Card>
      {status.error && <Alert type="error" showIcon message={status.error.message} />}
      <Card title="最近同步" variant="borderless">
        <Table<SyncRunDto>
          rowKey="id"
          size="small"
          loading={status.isLoading}
          dataSource={status.data?.recentRuns ?? []}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "开始时间", dataIndex: "startedAt", render: (value: string) => dayjs(value).format("MM-DD HH:mm:ss") },
            { title: "触发", dataIndex: "trigger" },
            { title: "模式", dataIndex: "mode" },
            { title: "状态", dataIndex: "status", render: (value: string) => <Tag color={value === "success" ? "green" : value === "failed" ? "red" : "default"}>{value}</Tag> },
            { title: "扫描", dataIndex: "scanned" },
            { title: "新增", dataIndex: "inserted" },
            { title: "分类", dataIndex: "classified" },
            { title: "失败", dataIndex: "failed" },
          ]}
        />
      </Card>
      <Card title="失败任务" variant="borderless">
        <Table<SyncFailureDto>
          rowKey="id"
          size="small"
          dataSource={status.data?.failures ?? []}
          pagination={{ pageSize: 10 }}
          locale={{ emptyText: "暂无失败任务" }}
          columns={[
            { title: "时间", dataIndex: "createdAt", render: (value: string) => dayjs(value).format("MM-DD HH:mm:ss") },
            { title: "阶段", dataIndex: "stage" },
            { title: "邮件 ID", dataIndex: "emailId", render: (value: number | null) => value ?? "—" },
            { title: "错误", dataIndex: "message", ellipsis: true },
            { title: "可重试", dataIndex: "retryable", render: (value: boolean) => value ? "是" : "否" },
          ]}
        />
      </Card>
    </Space>
  );
}
