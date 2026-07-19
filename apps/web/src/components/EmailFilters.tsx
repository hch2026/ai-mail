import { FilterOutlined, SearchOutlined } from "@ant-design/icons";
import type { EmailQuery } from "@mail-ai/shared";
import { Button, DatePicker, Input, Select, Space, Tooltip } from "antd";
import type { Dayjs } from "dayjs";

interface Props {
  filters: Partial<EmailQuery>;
  onChange: (next: Partial<EmailQuery>) => void;
}

export function EmailFilters({ filters, onChange }: Props) {
  const update = (patch: Partial<EmailQuery>) => onChange({ ...filters, ...patch, page: 1 });
  return (
    <Space wrap size={10} className="filter-bar">
      <Input
        allowClear
        prefix={<SearchOutlined />}
        value={filters.sender}
        placeholder="搜索发件人或邮箱地址"
        aria-label="筛选发件人"
        onChange={(event) => update({ sender: event.target.value || undefined })}
      />
      <Select
        allowClear
        value={filters.unread}
        placeholder="未读状态"
        aria-label="筛选未读状态"
        onChange={(value: boolean | undefined) => update({ unread: value })}
        options={[
          { label: "仅未读", value: true },
          { label: "仅已读", value: false },
        ]}
      />
      <Select
        allowClear
        value={filters.actionRequired}
        placeholder="处理状态"
        aria-label="筛选处理状态"
        onChange={(value: boolean | undefined) => update({ actionRequired: value })}
        options={[
          { label: "需要处理", value: true },
          { label: "无需处理", value: false },
        ]}
      />
      <Select
        allowClear
        value={filters.review}
        placeholder="复核状态"
        aria-label="筛选复核状态"
        onChange={(value: boolean | undefined) => update({ review: value })}
        options={[
          { label: "待人工复核", value: true },
          { label: "无需复核", value: false },
        ]}
      />
      <DatePicker.RangePicker
        aria-label="筛选邮件日期"
        onChange={(dates: null | [Dayjs | null, Dayjs | null]) =>
          update({
            from: dates?.[0]?.startOf("day").toISOString(),
            to: dates?.[1]?.endOf("day").toISOString(),
          })
        }
      />
      <Tooltip title="保留当前标签，清除其他筛选">
        <Button
          icon={<FilterOutlined />}
          onClick={() => onChange({ page: 1, pageSize: filters.pageSize ?? 30, ...(filters.label ? { label: filters.label } : {}) })}
        >
          清空筛选
        </Button>
      </Tooltip>
    </Space>
  );
}
