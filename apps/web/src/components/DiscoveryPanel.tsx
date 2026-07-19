import {
  CheckCircleOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { EmailCluster, TaxonomyLabel } from "@mail-ai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Flex,
  Input,
  InputNumber,
  List,
  Modal,
  Progress,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { api } from "../api/client.js";

export function DiscoveryPanel({ accountId }: { accountId: string | undefined }) {
  const queryClient = useQueryClient();
  const [draftLabels, setDraftLabels] = useState<TaxonomyLabel[]>([]);
  const report = useQuery({
    queryKey: ["discovery-report", accountId],
    queryFn: () => api.discoveryReport(accountId),
    retry: false,
  });
  const status = useQuery({
    queryKey: ["taxonomy-status", accountId],
    queryFn: () => api.taxonomyStatus(accountId),
    refetchInterval: (query) => query.state.data?.state === "backfilling" ? 3_000 : false,
  });
  useEffect(() => {
    if (report.data?.status === "draft") setDraftLabels(report.data.report.suggestedTaxonomy);
    else if (status.data?.labels.length) setDraftLabels(status.data.labels);
  }, [report.data, status.data?.labels]);

  const editable = report.data?.status === "draft";
  const labelsValid = draftLabels.length >= 8 && draftLabels.length <= 18 &&
    draftLabels.every((item) => item.label.trim() && item.description.trim()) &&
    new Set(draftLabels.map((item) => item.label.trim())).size === draftLabels.length;

  const analyze = useMutation({
    mutationFn: () => api.analyzeDiscovery(accountId),
    onSuccess: async (result) => {
      queryClient.setQueryData(["discovery-report", accountId], result);
      setDraftLabels(result.report.suggestedTaxonomy);
      await queryClient.invalidateQueries({ queryKey: ["taxonomy-status"] });
      message.success("邮箱画像和分类建议已生成");
    },
    onError: (error) => message.error(error.message),
  });
  const confirm = useMutation({
    mutationFn: () => api.confirmTaxonomy(report.data!.id, draftLabels, accountId),
    onSuccess: async () => {
      message.success("分类体系已确认，历史邮件回填已开始");
      await queryClient.invalidateQueries({ queryKey: ["taxonomy-status"] });
      await queryClient.invalidateQueries({ queryKey: ["discovery-report"] });
    },
    onError: (error) => message.error(error.message),
  });
  const retryBackfill = useMutation({
    mutationFn: () => api.retryBackfill(accountId),
    onSuccess: async () => {
      message.success("历史回填已重新启动");
      await queryClient.invalidateQueries({ queryKey: ["taxonomy-status"] });
    },
    onError: (error) => message.error(error.message),
  });

  const updateLabel = (index: number, patch: Partial<TaxonomyLabel>) => {
    setDraftLabels((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
  };
  const requestConfirmation = () => {
    Modal.confirm({
      title: "确认采用这套分类体系？",
      content: "确认后才会开始对全部历史邮件重新分类。不会移动、删除、归档或修改未读状态。",
      okText: "确认并开始回填",
      cancelText: "继续调整",
      onOk: async () => confirm.mutateAsync(),
    });
  };

  const clusterColumns = [
    { title: "邮件簇", dataIndex: "name", ellipsis: true },
    { title: "数量", dataIndex: "count", width: 80 },
    { title: "建议分类", dataIndex: "suggestedPrimaryLabel", width: 180 },
    {
      title: "置信度",
      dataIndex: "confidence",
      width: 130,
      render: (value: number) => <Progress percent={Math.round(value * 100)} size="small" />,
    },
    { title: "依据", dataIndex: "reason", ellipsis: true },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Card variant="borderless">
        <Flex justify="space-between" align="center" wrap gap={16}>
          <div>
            <Typography.Title level={3}><ExperimentOutlined /> 分类体系发现</Typography.Title>
            <Typography.Text type="secondary">先分析真实邮件簇并生成建议；只有你明确确认后才会历史回填。</Typography.Text>
          </div>
          <Button type="primary" icon={<ReloadOutlined />} loading={analyze.isPending} onClick={() => analyze.mutate()}>
            {report.data ? "重新分析邮箱" : "生成邮箱画像"}
          </Button>
        </Flex>
        <Descriptions className="sync-status" column={{ xs: 1, sm: 2, lg: 4 }}>
          <Descriptions.Item label="流程状态"><Tag color={status.data?.state === "active" ? "green" : "blue"}>{status.data?.state ?? "读取中"}</Tag></Descriptions.Item>
          <Descriptions.Item label="分类体系版本">{status.data?.activeVersionId ?? "尚未确认"}</Descriptions.Item>
          <Descriptions.Item label="历史回填">{status.data?.backfill ? `${status.data.backfill.classified}/${status.data.backfill.total}` : "未开始"}</Descriptions.Item>
          <Descriptions.Item label="新增建议">{status.data?.pendingSuggestions.length ?? 0}</Descriptions.Item>
        </Descriptions>
        {status.data?.state === "backfilling" && status.data.backfill && (
          <Progress percent={status.data.backfill.total ? Math.round(status.data.backfill.classified / status.data.backfill.total * 100) : 0} status="active" />
        )}
        {status.data?.state === "backfill-failed" && (
          <Alert
            type="error"
            showIcon
            message="历史回填中断"
            description="已完成结果会保留，可从剩余邮件继续。"
            action={<Button danger loading={retryBackfill.isPending} onClick={() => retryBackfill.mutate()}>重试回填</Button>}
          />
        )}
      </Card>

      {!report.data ? (
        <Card variant="borderless"><Empty description="尚未生成邮箱画像"><Button type="primary" onClick={() => analyze.mutate()}>开始只读分析</Button></Empty></Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}><Card variant="borderless"><Typography.Text type="secondary">历史邮件</Typography.Text><Typography.Title>{report.data.report.totalEmails}</Typography.Title></Card></Col>
            <Col xs={24} md={8}><Card variant="borderless"><Typography.Text type="secondary">时间范围</Typography.Text><Typography.Title level={4}>{formatRange(report.data.report.dateRange.from, report.data.report.dateRange.to)}</Typography.Title></Card></Col>
            <Col xs={24} md={8}><Card variant="borderless"><Typography.Text type="secondary">发现邮件簇</Typography.Text><Typography.Title>{report.data.report.clusters.length}</Typography.Title></Card></Col>
          </Row>

          <Card title="建议分类体系（确认前可修改）" variant="borderless" extra={<Tag>{draftLabels.length} 个主分类</Tag>}>
            <Alert type="info" showIcon message="来源平台会作为叠加标签；需要处理是独立状态，不占用主分类。" style={{ marginBottom: 14 }} />
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              {draftLabels.map((item, index) => (
                <div className="taxonomy-editor-row" key={`${index}-${item.label}`}>
                  <Input disabled={!editable} value={item.label} aria-label={`分类名称 ${index + 1}`} onChange={(event) => updateLabel(index, { label: event.target.value })} />
                  <Input disabled={!editable} value={item.description} aria-label={`分类描述 ${index + 1}`} onChange={(event) => updateLabel(index, { description: event.target.value })} />
                  <InputNumber value={item.estimatedCount} readOnly controls={false} />
                  <Button danger type="text" aria-label="删除建议分类" icon={<DeleteOutlined />} disabled={!editable || draftLabels.length <= 8} onClick={() => setDraftLabels((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
                </div>
              ))}
              <Flex justify="space-between" wrap gap={12}>
                <Button icon={<PlusOutlined />} disabled={!editable || draftLabels.length >= 18} onClick={() => setDraftLabels((current) => [...current, { label: "新分类", description: "请填写稳定的分类范围", estimatedCount: 0, exampleSenders: [], exampleSubjects: [] }])}>增加分类</Button>
                <Button
                  type="primary"
                  icon={<CheckCircleOutlined />}
                  disabled={!editable || !labelsValid}
                  loading={confirm.isPending}
                  onClick={requestConfirmation}
                >
                  确认分类体系
                </Button>
              </Flex>
            </Space>
          </Card>

          <Card title="主要邮件簇" variant="borderless">
            <Table<EmailCluster & { key: string }>
              rowKey="key"
              size="small"
              dataSource={report.data.report.clusters.map((item, index) => ({ ...item, key: `cluster-${index}` }))}
              columns={clusterColumns}
              scroll={{ x: 800 }}
              pagination={{ pageSize: 12 }}
            />
          </Card>
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title={`不确定邮件簇（${report.data.report.uncertainClusters.length}）`} variant="borderless">
                <List dataSource={report.data.report.uncertainClusters.slice(0, 12)} locale={{ emptyText: "无" }} renderItem={(item) => <List.Item><List.Item.Meta title={item.name} description={`${item.count} 封 · ${item.exampleSubjects[0] ?? "无主题"}`} /><Tag color="orange">复核</Tag></List.Item>} />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title={`疑似促销邮件簇（${report.data.report.possiblePromotions.length}）`} variant="borderless">
                <List dataSource={report.data.report.possiblePromotions.slice(0, 12)} locale={{ emptyText: "无" }} renderItem={(item) => <List.Item><List.Item.Meta title={item.name} description={`${item.count} 封 · ${item.exampleSubjects[0] ?? "无主题"}`} /><Tag color="magenta">仅标记</Tag></List.Item>} />
              </Card>
            </Col>
          </Row>
          <Card title="高频发件来源" variant="borderless">
            <Table rowKey="key" size="small" dataSource={report.data.report.topSenders.map((item, index) => ({ ...item, key: `sender-${index}` }))} scroll={{ x: 620 }} pagination={{ pageSize: 10 }} columns={[
              { title: "发件人", dataIndex: "sender" },
              { title: "域名", dataIndex: "domain" },
              { title: "数量", dataIndex: "count" },
              { title: "未读", dataIndex: "unreadCount" },
            ]} />
          </Card>
        </>
      )}
    </Space>
  );
}

function formatRange(from: string, to: string): string {
  if (!from || !to) return "未知";
  return `${dayjs(from).format("YYYY-MM-DD")} → ${dayjs(to).format("YYYY-MM-DD")}`;
}
