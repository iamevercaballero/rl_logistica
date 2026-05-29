import { useMemo, useState } from "react";

export type SortDir = "asc" | "desc" | null;

export interface SortConfig {
  key: string | null;
  dir: SortDir;
}

/**
 * Reads a value from an object using dot-notation path.
 * e.g. getPath(row, "material.code")
 */
function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => {
    if (acc == null || typeof acc !== "object") return acc;
    return (acc as Record<string, unknown>)[k];
  }, obj);
}

/**
 * Generic client-side table sort hook with dot-notation key support.
 *
 * Clicking the same column cycles:  null → asc → desc → null
 * Clicking a different column resets to: asc
 *
 * Usage:
 *   const { sortedData, sortConfig, handleSort } = useTableSort(rows);
 *   <th style={{ cursor: "pointer" }} onClick={() => handleSort("date")}>
 *     Fecha {sortArrow(sortConfig, "date")}
 *   </th>
 *   // or nested:
 *   <th style={{ cursor: "pointer" }} onClick={() => handleSort("material.code")}>
 *     Material {sortArrow(sortConfig, "material.code")}
 *   </th>
 */
export function useTableSort<T>(
  data: T[],
  defaultKey?: string,
  defaultDir: SortDir = null,
) {
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: defaultKey ?? null,
    dir: defaultDir,
  });

  function handleSort(key: string) {
    setSortConfig((prev) => {
      if (prev.key !== key) return { key, dir: "asc" };
      // cycle: asc → desc → null
      if (prev.dir === "asc") return { key, dir: "desc" };
      if (prev.dir === "desc") return { key: null, dir: null };
      return { key, dir: "asc" };
    });
  }

  const sortedData = useMemo(() => {
    const { key, dir } = sortConfig;
    if (!key || !dir) return data;
    return [...data].sort((a, b) => {
      const av = getPath(a, key);
      const bv = getPath(b, key);
      // Handle null / undefined → sort to end
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      // Numeric
      if (typeof av === "number" && typeof bv === "number") {
        return dir === "asc" ? av - bv : bv - av;
      }
      // String (case-insensitive)
      const as = String(av).toLowerCase();
      const bs = String(bv).toLowerCase();
      if (as < bs) return dir === "asc" ? -1 : 1;
      if (as > bs) return dir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  return { sortedData, sortConfig, handleSort };
}

/** Returns a sort-direction indicator string for a column header. */
export function sortArrow(config: SortConfig, key: string): string {
  if (config.key !== key) return " ↕";
  if (config.dir === "asc") return " ↑";
  if (config.dir === "desc") return " ↓";
  return " ↕";
}
