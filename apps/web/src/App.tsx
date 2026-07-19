import {
  CheckCircleOutlined,
  CloudSyncOutlined,
  ExperimentOutlined,
  InboxOutlined,
  CloseOutlined,
  MenuFoldOutlined,
  MenuOutlined,
  SafetyCertificateOutlined,
  TagsOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import type { EmailQuery } from "@mail-ai/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, ConfigProvider, Flex, Layout, Menu, Modal, Select, Space, Tag, Typography, message } from "antd";
import { useEffect, useMemo, useState } from "react";

import { loadActiveAccountId, saveActiveAccountId } from "./account-location.js";
import { api } from "./api/client.js";
import { DiscoveryPanel } from "./components/DiscoveryPanel.js";
import { EmailDetailDrawer } from "./components/EmailDetailDrawer.js";
import { EmailFilters } from "./components/EmailFilters.js";
import { EmailTable } from "./components/EmailTable.js";
import { SyncPanel } from "./components/SyncPanel.js";

type View = "mail" | "sync" | "discovery";

const defaultFilters: Partial<EmailQuery> = { page: 1, pageSize: 30 };

export default function App() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>("mail");
  const [selectedNav, setSelectedNav] = useState("all");
  const [filters, setFilters] = useState<Partial<EmailQuery>>(defaultFilters);
  const [selectedEmail, setSelectedEmail] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [narrowLayout, setNarrowLayout] = useState(false);
  const [siderCollapsed, setSiderCollapsed] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(loadActiveAccountId);

  const accounts = useQuery({ queryKey: ["accounts"], queryFn: api.accounts });
  const selectedAccount = accounts.data?.find((item) => item.id === selectedAccountId);
  const activeAccountId = accounts.data
    ? selectedAccount?.id ?? accounts.data.find((item) => item.isDefault)?.id
    : selectedAccountId;
  const activeAccount = accounts.data?.find((item) => item.id === activeAccountId);

  useEffect(() => {
    if (!activeAccountId || activeAccountId === selectedAccountId) return;
    setSelectedAccountId(activeAccountId);
    saveActiveAccountId(activeAccountId);
  }, [activeAccountId, selectedAccountId]);
  const dashboard = useQuery({ queryKey: ["dashboard", activeAccountId], queryFn: () => api.dashboard(activeAccountId) });
  const labels = useQuery({ queryKey: ["labels", activeAccountId], queryFn: () => api.labels(activeAccountId) });
  const taxonomy = useQuery({ queryKey: ["taxonomy-status", activeAccountId], queryFn: () => api.taxonomyStatus(activeAccountId) });
  const actionCount = useQuery({
    queryKey: ["emails", "action-count", activeAccountId],
    queryFn: () => api.emails({ accountId: activeAccountId, actionRequired: true, page: 1, pageSize: 1 }),
  });
  const emails = useQuery({
    queryKey: ["emails", activeAccountId, filters],
    queryFn: () => api.emails({ ...filters, accountId: activeAccountId }),
    enabled: view === "mail",
  });
  const deleteEmails = useMutation({
    mutationFn: api.bulkDelete,
    onSuccess: async (result) => {
      if (result.dryRun) {
        message.warning(`预演完成：选中了 ${result.requested} 封邮件，${activeAccount?.displayName ?? "邮箱"}未发生改变`);
        return;
      }
      message.success(`已将 ${result.moved} 封邮件移入${activeAccount?.displayName ?? "邮箱"}的“${result.targetMailbox ?? "垃圾箱"}”`);
      if (selectedEmail !== null && selectedIds.includes(selectedEmail)) setSelectedEmail(null);
      setSelectedIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["emails"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["labels"] }),
        queryClient.invalidateQueries({ queryKey: ["taxonomy-status"] }),
      ]);
    },
    onError: (error: Error) => message.error(error.message),
  });

  const labelItems = useMemo(() => (labels.data ?? []).map((item) => ({
    key: `label:${item.label}`,
    icon: <span className="label-dot" />,
    label: <SidebarItem label={item.label} count={item.total} />,
  })), [labels.data]);
  const visibleEmailIds = useMemo(
    () => (emails.data?.items ?? []).map((item) => item.id),
    [emails.data?.items],
  );
  const allVisibleSelected = visibleEmailIds.length > 0
    && visibleEmailIds.every((id) => selectedIds.includes(id));

  const openMailboxView = (key: string, next: Partial<EmailQuery>) => {
    setView("mail");
    setSelectedNav(key);
    setFilters({ ...defaultFilters, ...next });
    setSelectedIds([]);
  };

  const confirmBulkDelete = () => {
    if (selectedIds.length === 0) return;
    Modal.confirm({
      title: `删除选中的 ${selectedIds.length} 封邮件？`,
      content: `确认后会将邮件从收件箱移动到${activeAccount?.displayName ?? "当前邮箱"}的垃圾箱，可在垃圾箱中恢复。不会永久清空垃圾箱。`,
      okText: "移入垃圾箱",
      cancelText: "取消",
      okType: "danger",
      centered: true,
      onOk: async () => {
        await deleteEmails.mutateAsync(selectedIds);
      },
    });
  };

  const toggleSelectVisible = () => {
    if (allVisibleSelected) {
      const visible = new Set(visibleEmailIds);
      setSelectedIds((current) => current.filter((id) => !visible.has(id)));
      return;
    }
    setSelectedIds((current) => [...new Set([...current, ...visibleEmailIds])]);
  };

  const onMenu = (key: string) => {
    if (narrowLayout) setSiderCollapsed(true);
    if (key === "sync") {
      setView("sync");
      setSelectedNav(key);
      return;
    }
    if (key === "discovery") {
      setView("discovery");
      setSelectedNav(key);
      return;
    }
    if (key.startsWith("label:")) {
      openMailboxView(key, { label: key.slice(6) });
      return;
    }
    if (key === "unread") openMailboxView(key, { unread: true });
    else if (key === "action") openMailboxView(key, { actionRequired: true });
    else if (key === "review") openMailboxView(key, { review: true });
    else openMailboxView("all", {});
  };

  const title = view === "sync"
    ? "同步中心"
    : view === "discovery"
      ? "分类体系"
      : selectedNav.startsWith("label:")
        ? selectedNav.slice(6)
        : ({ all: "收件箱", unread: "未读邮件", action: "待处理", review: "待复核" }[selectedNav] ?? "收件箱");

  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: "#2563eb",
        colorBgLayout: "#f6f7fb",
        borderRadius: 10,
        fontFamily: "Inter, 'PingFang SC', 'Microsoft YaHei', sans-serif",
      },
      components: {
        Layout: { siderBg: "#f6f7fb", headerBg: "#ffffff" },
        Menu: { itemBg: "transparent", itemSelectedBg: "#dce8ff", itemSelectedColor: "#174ea6" },
        Table: { headerBg: "#ffffff", rowHoverBg: "#f3f6fc" },
      },
    }}>
      <Layout className="app-shell">
        <Layout.Sider
          breakpoint="lg"
          collapsedWidth={0}
          width={256}
          className="app-sider"
          theme="light"
          collapsed={siderCollapsed}
          onCollapse={setSiderCollapsed}
          onBreakpoint={(broken) => {
            setNarrowLayout(broken);
            setSiderCollapsed(broken);
          }}
          trigger={null}
        >
          <div className="brand">
            <div className="brand-mark">析</div>
            <div><strong>信析</strong><span>多邮箱智能分类</span></div>
            {narrowLayout && (
              <Button
                className="sider-close-button"
                type="text"
                icon={<CloseOutlined />}
                aria-label="关闭导航菜单"
                onClick={() => setSiderCollapsed(true)}
              />
            )}
          </div>
          <Select
            className="account-selector"
            value={activeAccountId}
            loading={accounts.isLoading}
            placeholder="选择邮箱"
            options={(accounts.data ?? []).map((item) => ({
              value: item.id,
              label: `${item.displayName}${item.writeEnabled ? "" : " · 只读"}`,
            }))}
            onChange={(accountId) => {
              if (!accountId) return;
              setSelectedAccountId(accountId);
              saveActiveAccountId(accountId);
              setSelectedEmail(null);
              setSelectedIds([]);
              setSelectedNav("all");
              setView("mail");
              setFilters(defaultFilters);
            }}
          />
          <Button className="compose-placeholder" block icon={<MenuFoldOutlined />}>邮件分类台</Button>
          <Menu
            mode="inline"
            selectedKeys={[selectedNav]}
            onClick={({ key }) => onMenu(key)}
            items={[
              { key: "all", icon: <InboxOutlined />, label: <SidebarItem label="全部邮件" count={dashboard.data?.total} /> },
              { key: "unread", icon: <span className="unread-menu-dot" />, label: <SidebarItem label="未读邮件" count={dashboard.data?.unread} /> },
              { key: "action", icon: <ThunderboltOutlined />, label: <SidebarItem label="待处理" count={actionCount.data?.total} /> },
              { key: "review", icon: <CheckCircleOutlined />, label: <SidebarItem label="待复核" count={dashboard.data?.needsReview} /> },
              { type: "divider" },
              { key: "labels", type: "group", label: <span className="menu-group-title"><TagsOutlined /> 分类标签</span>, children: labelItems.length ? labelItems : [{ key: "no-labels", label: "尚无已确认标签", disabled: true }] },
              { type: "divider" },
              { key: "discovery", icon: <ExperimentOutlined />, label: "分类体系" },
              { key: "sync", icon: <CloudSyncOutlined />, label: "同步中心" },
            ]}
          />
          <div className="privacy-note">
            <SafetyCertificateOutlined />
            <span>同步和正文读取保持只读<br />删除仅在人工确认后移入垃圾箱</span>
          </div>
        </Layout.Sider>

        <Layout className="main-layout">
          <Layout.Header className="app-header">
            {narrowLayout && (
              <Button
                className="mobile-menu-button"
                type="text"
                icon={<MenuOutlined />}
                aria-label="打开导航菜单"
                onClick={() => setSiderCollapsed(false)}
              />
            )}
            <div className="header-title">
              <Typography.Title level={2}>{title}</Typography.Title>
              <Typography.Text type="secondary">
                {view === "mail" ? `${emails.data?.total ?? 0} 封邮件` : "本地管理，不改变邮箱未读状态"}
              </Typography.Text>
            </div>
            <Space>
              <Tag className="readonly-tag" icon={<SafetyCertificateOutlined />}>只读同步 · 删除需确认</Tag>
            </Space>
          </Layout.Header>

          <Layout.Content className="app-content">
            {view === "sync" ? <SyncPanel accountId={activeAccountId} /> : view === "discovery" ? <DiscoveryPanel accountId={activeAccountId} /> : (
              <section className="mail-workspace">
                {taxonomy.data && taxonomy.data.state !== "active" && taxonomy.data.state !== "backfilling" && (
                  <Alert
                    className="taxonomy-alert"
                    type="info"
                    showIcon
                    message={`请先确认适合${activeAccount?.displayName ?? "当前邮箱"}的分类体系`}
                    description="确认前可浏览邮件；人工改分类和重新分类暂不可用。"
                    action={<Button size="small" onClick={() => onMenu("discovery")}>前往分类体系</Button>}
                  />
                )}
                <Flex className="mail-toolbar" justify="space-between" align="center" wrap gap={12}>
                  <Space wrap>
                    <QuickFilter active={!filters.unread && !filters.actionRequired && !filters.review && !filters.label} onClick={() => openMailboxView("all", {})}>全部</QuickFilter>
                    <QuickFilter active={filters.unread === true} onClick={() => openMailboxView("unread", { unread: true })}>只看未读</QuickFilter>
                    <QuickFilter active={filters.actionRequired === true} onClick={() => openMailboxView("action", { actionRequired: true })}>待处理</QuickFilter>
                    <QuickFilter active={filters.review === true} onClick={() => openMailboxView("review", { review: true })}>待复核</QuickFilter>
                  </Space>
                  <Space>
                    {selectedIds.length > 0 && <Typography.Text type="secondary">已选择 {selectedIds.length} 封</Typography.Text>}
                    <Button
                      disabled={visibleEmailIds.length === 0}
                      onClick={toggleSelectVisible}
                    >
                      {allVisibleSelected ? "取消选择本页" : `全选当前页（${visibleEmailIds.length}）`}
                    </Button>
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      disabled={selectedIds.length === 0}
                      loading={deleteEmails.isPending}
                      onClick={confirmBulkDelete}
                    >
                      移入垃圾箱
                    </Button>
                  </Space>
                </Flex>
                <EmailFilters filters={filters} onChange={setFilters} />
                <EmailTable
                  items={emails.data?.items ?? []}
                  loading={emails.isLoading}
                  total={emails.data?.total ?? 0}
                  page={emails.data?.page ?? 1}
                  pageSize={emails.data?.pageSize ?? 30}
                  selectedId={selectedEmail}
                  onPageChange={(page, pageSize) => setFilters((current) => ({ ...current, page, pageSize }))}
                  onOpen={setSelectedEmail}
                  selectable
                  selectedIds={selectedIds}
                  onSelectionChange={(keys) => setSelectedIds(keys.map(Number))}
                />
              </section>
            )}
          </Layout.Content>
        </Layout>
      </Layout>
      <EmailDetailDrawer
        emailId={selectedEmail}
        labels={taxonomy.data?.labels ?? []}
        onClose={() => setSelectedEmail(null)}
      />
    </ConfigProvider>
  );
}

function SidebarItem({ label, count }: { label: string; count?: number | undefined }) {
  return (
    <span className="sidebar-item" title={label}>
      <span>{label}</span>
      {count !== undefined && <span className="sidebar-count" aria-label={`${count} 封邮件`}>{count}</span>}
    </span>
  );
}

function QuickFilter({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return <Button size="small" type={active ? "primary" : "default"} ghost={active} onClick={onClick}>{children}</Button>;
}
