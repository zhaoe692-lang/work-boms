import type { SearchHit } from "../shared/types";
import { useI18n } from "../shared/i18n";

interface GlobalSearchProps {
  query: string;
  onQueryChange: (value: string) => void;
  results: SearchHit[];
  loading: boolean;
  onSelect: (hit: SearchHit) => void;
}

export function GlobalSearch({
  query,
  onQueryChange,
  results,
  loading,
  onSelect,
}: GlobalSearchProps) {
  const { t } = useI18n();
  const showResults = query.trim().length >= 2;

  return (
    <div className="global-search">
      <input
        className="global-search-input"
        placeholder={t("globalSearch.placeholder")}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        aria-label={t("globalSearch.aria")}
      />
      {showResults && (
        <div className="global-search-results" role="listbox">
          {loading && <p className="muted small pad">{t("globalSearch.searching")}</p>}
          {!loading && results.length === 0 && (
            <p className="muted small pad">{t("globalSearch.noResults")}</p>
          )}
          {!loading &&
            results.map((hit) => (
              <button
                key={`${hit.packageId}-${hit.artifactId}`}
                type="button"
                className="search-hit"
                role="option"
                onClick={() => onSelect(hit)}
              >
                <strong>{hit.displayName}</strong>
                <span className="muted small">{hit.packageTitle}</span>
                {hit.snippet ? (
                  <span
                    className="snippet small"
                    dangerouslySetInnerHTML={{ __html: hit.snippet }}
                  />
                ) : (
                  hit.summary && (
                    <span className="muted small">{hit.summary}</span>
                  )
                )}
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
