import { CheckCircleOutlined, InboxOutlined, WarningOutlined } from "@ant-design/icons";
import type { DashboardDto } from "@mail-ai/shared";
import { Card, Col, Row, Skeleton, Statistic } from "antd";

export function StatCards({ data, loading }: { data: DashboardDto | undefined; loading: boolean }) {
  const cards = [
    { title: "已同步邮件", value: data?.total ?? 0, icon: <InboxOutlined />, tone: "blue" },
    { title: "未读邮件", value: data?.unread ?? 0, icon: <WarningOutlined />, tone: "amber" },
    { title: "已读邮件", value: Math.max(0, (data?.total ?? 0) - (data?.unread ?? 0)), icon: <CheckCircleOutlined />, tone: "slate" },
  ];
  return (
    <Row gutter={[16, 16]}>
      {cards.map((card) => (
        <Col xs={24} sm={8} key={card.title}>
          <Card className={`stat-card stat-${card.tone}`} variant="borderless">
            {loading ? (
              <Skeleton active paragraph={false} />
            ) : (
              <Statistic title={card.title} value={card.value} prefix={card.icon} />
            )}
          </Card>
        </Col>
      ))}
    </Row>
  );
}
