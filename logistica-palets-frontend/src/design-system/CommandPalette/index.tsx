/**
 * CommandPalette — RL Logística Design System
 *
 * Open with Ctrl+K (⌘+K on Mac). Provides:
 *  - Page navigation
 *  - Quick actions (new movement, reports, etc.)
 *  - Search history (localStorage, last 5)
 *  - Keyboard navigation: ↑ ↓ Enter Escape
 *  - Highlight of matching text
 *  - Group labels
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import './CommandPalette.css';

/* ── Types ────────────────────────────────────────────────────────────────── */

export interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  group?: string;
  icon?: ReactNode;
  iconVariant?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  shortcut?: string;
  /** If provided, pressing Enter navigates to this path */
  path?: string;
  /** If provided, pressing Enter calls this action */
  action?: () => void;
  /** Keywords boost match score without appearing in UI */
  keywords?: string;
}

/* ── LocalStorage history ─────────────────────────────────────────────────── */

const HISTORY_KEY = 'cmd_palette_history';
const MAX_HISTORY = 5;

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveToHistory(query: string) {
  if (!query.trim()) return;
  try {
    const existing = loadHistory().filter((h) => h !== query);
    localStorage.setItem(HISTORY_KEY, JSON.stringify([query, ...existing].slice(0, MAX_HISTORY)));
  } catch {
    // ignore
  }
}

/* ── Fuzzy match ──────────────────────────────────────────────────────────── */

interface MatchResult {
  score: number;
  /** Indices in `label` that are matched (for highlighting) */
  matchIndices: number[];
}

function fuzzyMatch(str: string, query: string): MatchResult {
  if (!query) return { score: 1, matchIndices: [] };
  const lStr = str.toLowerCase();
  const lQuery = query.toLowerCase();

  // Exact substring: highest score
  const exactIdx = lStr.indexOf(lQuery);
  if (exactIdx !== -1) {
    return {
      score: 10 + (exactIdx === 0 ? 5 : 0), // bonus for prefix
      matchIndices: Array.from({ length: lQuery.length }, (_, i) => exactIdx + i),
    };
  }

  // Fuzzy: all chars must appear in order
  let si = 0;
  let qi = 0;
  const indices: number[] = [];
  while (si < lStr.length && qi < lQuery.length) {
    if (lStr[si] === lQuery[qi]) {
      indices.push(si);
      qi++;
    }
    si++;
  }
  if (qi < lQuery.length) return { score: 0, matchIndices: [] }; // no match
  return { score: 1 + indices.length / str.length, matchIndices: indices };
}

/** Highlight matched characters in label */
function HighlightedLabel({ label, indices }: { label: string; indices: number[] }) {
  if (indices.length === 0) return <>{label}</>;
  const set = new Set(indices);
  return (
    <>
      {label.split('').map((ch, i) =>
        set.has(i) ? (
          <mark key={i} className="cp-highlight">{ch}</mark>
        ) : (
          <span key={i}>{ch}</span>
        ),
      )}
    </>
  );
}

/* ── Main component ───────────────────────────────────────────────────────── */

interface CommandPaletteProps {
  items: CommandItem[];
  isOpen: boolean;
  onClose: () => void;
}

export function CommandPalette({ items, isOpen, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<string[]>([]);

  /* Load history on open */
  useEffect(() => {
    if (isOpen) {
      setHistory(loadHistory());
      setQuery('');
      setActiveIdx(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [isOpen]);

  /* Filter + score items */
  const filtered = useCallback((): Array<CommandItem & { _match: MatchResult }> => {
    if (!query.trim()) {
      // Show all items, history first
      return items.map((item) => ({ ...item, _match: { score: 1, matchIndices: [] } }));
    }
    return items
      .map((item) => {
        const labelMatch = fuzzyMatch(item.label, query);
        const keywordMatch = item.keywords ? fuzzyMatch(item.keywords, query) : { score: 0, matchIndices: [] };
        const subMatch = item.sublabel ? fuzzyMatch(item.sublabel, query) : { score: 0, matchIndices: [] };
        const score = Math.max(labelMatch.score, keywordMatch.score * 0.8, subMatch.score * 0.6);
        return { ...item, _match: { score, matchIndices: labelMatch.matchIndices } };
      })
      .filter((i) => i._match.score > 0)
      .sort((a, b) => b._match.score - a._match.score);
  }, [items, query]);

  const results = filtered();

  /* Group results */
  const grouped = useCallback((): Array<{ group: string; items: typeof results }> => {
    const map = new Map<string, typeof results>();
    for (const item of results) {
      const g = item.group ?? 'Acciones';
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(item);
    }
    return Array.from(map.entries()).map(([group, items]) => ({ group, items }));
  }, [results]);

  const groups = grouped();
  const flatItems = groups.flatMap((g) => g.items);

  /* Keep activeIdx in bounds */
  useEffect(() => {
    setActiveIdx((prev) => Math.min(prev, Math.max(flatItems.length - 1, 0)));
  }, [flatItems.length]);

  /* Scroll active item into view */
  useEffect(() => {
    if (!listRef.current) return;
    const active = listRef.current.querySelector<HTMLElement>('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  /* Keyboard navigation */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % flatItems.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => (i - 1 + flatItems.length) % flatItems.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const item = flatItems[activeIdx];
      if (item) activateItem(item);
    }
  }

  function activateItem(item: CommandItem) {
    saveToHistory(item.label);
    onClose();
    if (item.path) {
      navigate(item.path);
    } else if (item.action) {
      item.action();
    }
  }

  if (!isOpen) return null;

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return createPortal(
    <div
      className="cp-backdrop"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="cp-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Paleta de comandos"
      >
        {/* Search */}
        <div className="cp-search-wrap">
          <span className="cp-search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            ref={inputRef}
            className="cp-input"
            type="text"
            placeholder="Buscar páginas, acciones…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            aria-label="Buscar"
            aria-autocomplete="list"
            aria-controls="cp-listbox"
            aria-activedescendant={flatItems[activeIdx] ? `cp-item-${flatItems[activeIdx].id}` : undefined}
            role="combobox"
            aria-expanded="true"
          />
          <kbd className="cp-kbd" onClick={onClose} title="Cerrar paleta">Esc</kbd>
        </div>

        {/* Recent searches when no query */}
        {!query && history.length > 0 && (
          <div style={{ padding: '6px 0', borderBottom: '1px solid var(--border-dim)' }}>
            <div className="cp-group-label">Recientes</div>
            {history.map((h, idx) => (
              <button
                key={idx}
                className="cp-item"
                onClick={() => setQuery(h)}
                type="button"
              >
                <span className="cp-item-icon">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="12 8 12 12 14 14" />
                    <path d="M3.05 11a9 9 0 1 0 .5-3" />
                    <polyline points="3 4 3 11 10 11" />
                  </svg>
                </span>
                <span className="cp-item-label">{h}</span>
              </button>
            ))}
          </div>
        )}

        {/* Results */}
        <div
          className="cp-list"
          id="cp-listbox"
          role="listbox"
          aria-label="Resultados"
          ref={listRef}
        >
          {flatItems.length === 0 && (
            <div className="cp-empty">Sin resultados para "{query}"</div>
          )}

          {groups.map(({ group, items: groupItems }) => (
            <div key={group}>
              <div className="cp-group-label">{group}</div>
              {groupItems.map((item) => {
                const flatIdx = flatItems.indexOf(item);
                const isActive = flatIdx === activeIdx;
                return (
                  <button
                    key={item.id}
                    id={`cp-item-${item.id}`}
                    className="cp-item"
                    role="option"
                    aria-selected={isActive}
                    onClick={() => activateItem(item)}
                    type="button"
                    tabIndex={-1}
                  >
                    <span
                      className={[
                        'cp-item-icon',
                        item.iconVariant ? `cp-item-icon--${item.iconVariant}` : '',
                      ].join(' ')}
                      aria-hidden="true"
                    >
                      {item.icon}
                    </span>
                    <span className="cp-item-content">
                      <span className="cp-item-label">
                        <HighlightedLabel label={item.label} indices={item._match.matchIndices} />
                      </span>
                      {item.sublabel && (
                        <span className="cp-item-sub">{item.sublabel}</span>
                      )}
                    </span>
                    {item.shortcut && (
                      <span className="cp-item-shortcut">
                        <kbd className="cp-kbd">{item.shortcut}</kbd>
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="cp-footer">
          <span className="cp-footer-hint">
            <kbd className="cp-kbd">↑↓</kbd> navegar
          </span>
          <span className="cp-footer-hint">
            <kbd className="cp-kbd">↵</kbd> seleccionar
          </span>
          <span className="cp-footer-hint">
            <kbd className="cp-kbd">Esc</kbd> cerrar
          </span>
          {results.length > 0 && (
            <span style={{ marginLeft: 'auto' }}>
              {results.length} resultado{results.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Hook: register Ctrl+K ────────────────────────────────────────────────── */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function handler(e: globalThis.KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return {
    isOpen,
    open: () => setIsOpen(true),
    close: () => setIsOpen(false),
  };
}

/* ── Trigger button ───────────────────────────────────────────────────────── */
export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform);
  return (
    <button
      className="cp-trigger"
      onClick={onClick}
      aria-label="Abrir paleta de comandos (Ctrl+K)"
      title="Paleta de comandos"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
      </svg>
      Buscar
      <kbd className="cp-kbd" aria-hidden="true">{isMac ? '⌘K' : 'Ctrl+K'}</kbd>
    </button>
  );
}
