// A placeholder panel for data sources that pku3b/the backend cannot feed yet
// (P3). Renders a labeled "待接入" empty state and documents the future data
// contract via the generic `T` — so when P3 implements the scraper/endpoint,
// the panel swaps in a real fetch + render against the same shape. NO fetch, NO
// backend route today (deliberately — see the P1 plan, Increment C2).

import { Panel } from "./widgets";

export default function DeferredPanel<T>({
  title,
  futureTool,
  fields,
}: {
  title: string;
  /** What P3 will wire up: a future MCP tool name or backend endpoint. */
  futureTool: string;
  /** The field names of the future contract T (keys only, for documentation). */
  fields: (keyof T & string)[];
}) {
  return (
    <Panel title={`${title}`}>
      <div className="deferred">
        <p className="muted">待接入（P3）</p>
        <p className="deferred-detail">
          计划来源：<code>{futureTool}</code>
        </p>
        {fields.length > 0 && (
          <p className="deferred-detail">
            数据契约字段：<code>{fields.join(" · ")}</code>
          </p>
        )}
        <p className="muted small">界面与接口已就绪，等待数据源实现后接入。</p>
      </div>
    </Panel>
  );
}
