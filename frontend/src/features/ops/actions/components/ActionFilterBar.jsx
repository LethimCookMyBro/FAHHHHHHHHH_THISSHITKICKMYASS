import { Filter, Search } from "lucide-react";
import { useT } from "../../../../utils/i18n";

const FILTER_KEYS = [
  { key: "all", tKey: "actions.filterAll" },
  { key: "failed", tKey: "actions.filterFailed" },
  { key: "manual", tKey: "actions.filterManual" },
  { key: "executed", tKey: "actions.filterExecuted" },
  { key: "today", tKey: "actions.filterToday" },
];

export default function ActionFilterBar({
  query,
  onQueryChange,
  quickFilter,
  onQuickFilterChange,
}) {
  const { t } = useT();

  return (
    <div className="action-filter-bar">
      <div className="action-filter-left">
        <div className="action-filter-chips">
          {FILTER_KEYS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className={`action-filter-chip ${quickFilter === filter.key ? "is-active" : ""}`}
              onClick={() => onQuickFilterChange(filter.key)}
            >
              {t(filter.tKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="action-search">
        <Search size={14} className="action-search-icon" />
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder={t("actions.searchPlaceholder")}
          className="action-search-input"
        />
      </div>
    </div>
  );
}
