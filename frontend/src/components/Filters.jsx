import React from 'react';

const FILTERS = [
  { key: '', label: 'All Tracks' },
  { key: 'recently_added', label: 'Recently Added', isRecent: true },
  { key: 'has_junk', label: 'Has Junk' },
  { key: 'missing_lyrics', label: 'Missing Lyrics' },
  { key: 'sidecar_lyrics', label: 'Sidecar (.lrc) Only' },
  { key: 'missing_language', label: 'Missing Language' },
  { key: 'untouched', label: 'Untouched' },
  { key: 'local_fixed', label: 'Local Fixed' },
  { key: 'llm_fixed', label: 'AI Optimized' },
];

const SORT_PRESETS = [
  { value: 'title:asc', label: 'Title (A → Z)' },
  { value: 'id:desc', label: 'Recently Added (Newest First)' },
  { value: 'last_scanned:desc', label: 'Recently Scanned' },
  { value: 'last_fixed_at:desc', label: 'Recently Fixed' },
  { value: 'artist:asc', label: 'Artist (A → Z)' },
  { value: 'album:asc', label: 'Album (A → Z)' },
  { value: 'year:desc', label: 'Year (Newest)' },
];

export default function Filters({ 
  search, onSearch, 
  searchField, onSearchFieldChange,
  filter, onFilter, 
  groupBy, onGroupBy,
  pageSize, onPageSizeChange,
  sortBy = 'title',
  sortDir = 'asc',
  onSortChange,
  page = 1,
  total = 0,
  onPageChange
}) {
  const searchFields = [
    { id: 'all', label: 'All Fields' },
    { id: 'title', label: 'Title' },
    { id: 'artist', label: 'Artist' },
    { id: 'album', label: 'Album' },
    { id: 'filename', label: 'Filename' }
  ];

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentSortKey = `${sortBy}:${sortDir}`;

  return (
    <div className="studio-card p-2.5 sm:p-3 bg-surface-1 border-surface-4 space-y-2.5">
      {/* Row 1: Search Input + Sort + View Options + Compact Pagination */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between gap-2 sm:gap-2.5">
        {/* Search Bar */}
        <div className="relative flex-1 min-w-0 sm:min-w-[240px] sm:max-w-md flex items-center group">
          <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10">
            <select
              value={searchField}
              onChange={(e) => onSearchFieldChange(e.target.value)}
              className="appearance-none bg-surface-3 border-none text-[10px] font-bold text-amber-400 uppercase tracking-tighter pl-2 pr-4 py-1.5 rounded-md hover:bg-surface-4 cursor-pointer focus:ring-0 focus:outline-none transition-all w-[76px] sm:w-[86px] truncate"
              title="Search Field"
            >
              {searchFields.map(f => (
                <option key={f.id} value={f.id} className="bg-surface-2 text-ink-rich capitalize">
                  {f.label.replace(' Fields', '')}
                </option>
              ))}
            </select>
            <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none opacity-60">
              <svg className="w-2 h-2 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </div>
          </div>
          <input
            type="text"
            placeholder={searchField === 'all' ? "Search title, artist, album, file..." : `Search in ${searchField}...`}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="input-field !pl-[82px] sm:!pl-[92px] pr-[52px] sm:pr-[56px] !text-xs !h-9 border-surface-5/60 focus:border-amber-400/50 w-full bg-surface-0"
            id="search-input"
          />
          <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            {search && (
              <button 
                onClick={() => onSearch('')}
                className="p-1 text-ink-faint hover:text-red-400 transition-colors"
                title="Clear Search"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
            <button 
              onClick={() => onFilter(filter)}
              className="p-1 text-ink-muted hover:text-amber-400 transition-colors"
              title="Reload View"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Right Controls: Sort By + Grouping + Page Size + Inline Pagination */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center justify-between sm:justify-end gap-1.5 sm:gap-2 w-full sm:w-auto">
          <div className="grid grid-cols-12 sm:flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto">
            {/* Sort By Dropdown */}
            {onSortChange && (
              <div className="col-span-5 sm:w-auto flex items-center gap-1.5 min-w-0">
                <span className="text-[10px] font-bold uppercase text-ink-faint tracking-wider hidden xl:inline">Sort:</span>
                <div className="relative w-full sm:w-auto">
                  <select
                    value={SORT_PRESETS.some(p => p.value === currentSortKey) ? currentSortKey : 'custom'}
                    onChange={(e) => {
                      if (e.target.value === 'custom') return;
                      const [field, dir] = e.target.value.split(':');
                      onSortChange(field, dir);
                    }}
                    className="w-full sm:w-auto appearance-none bg-surface-0 border border-surface-4 text-ink-rich text-[11px] sm:text-xs font-semibold rounded-lg px-2 sm:px-2.5 py-1.5 pr-5 sm:pr-7 focus:outline-none focus:border-amber-400/50 hover:border-surface-5 cursor-pointer transition-all truncate"
                    id="sort-by-select"
                  >
                    {SORT_PRESETS.map(p => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                    {!SORT_PRESETS.some(p => p.value === currentSortKey) && (
                      <option value="custom">Custom ({sortBy} {sortDir.toUpperCase()})</option>
                    )}
                  </select>
                  <svg
                    className="absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-muted pointer-events-none"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </div>
              </div>
            )}

            {/* Group By Dropdown */}
            <div className="col-span-4 sm:w-auto flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-bold uppercase text-ink-faint tracking-wider hidden xl:inline">View:</span>
              <div className="relative w-full sm:w-auto">
                <select
                  value={groupBy}
                  onChange={(e) => onGroupBy(e.target.value)}
                  className="w-full sm:w-auto appearance-none bg-surface-0 border border-surface-4 text-ink-rich text-[11px] sm:text-xs font-semibold rounded-lg px-2 sm:px-2.5 py-1.5 pr-5 sm:pr-7 focus:outline-none focus:border-amber-400/50 hover:border-surface-5 cursor-pointer transition-all truncate"
                  id="group-by-select"
                >
                  <option value="">Flat Track List</option>
                  <option value="folder">Group by Folder</option>
                </select>
                <svg
                  className="absolute right-1.5 sm:right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-muted pointer-events-none"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>

            {/* Page Size */}
            <div className="col-span-3 sm:w-auto flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-bold uppercase text-ink-faint tracking-wider hidden sm:inline">Rows:</span>
              <div className="relative w-full sm:w-auto">
                <select
                  value={pageSize}
                  onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  className="w-full sm:w-auto appearance-none bg-surface-0 border border-surface-4 text-ink-rich text-[11px] sm:text-xs font-semibold rounded-lg px-2 sm:px-2.5 py-1.5 pr-5 sm:pr-6 focus:outline-none focus:border-amber-400/50 hover:border-surface-5 cursor-pointer transition-all font-mono truncate"
                  id="page-size-select"
                >
                  {[50, 100, 250, 500, 1000].map(val => (
                    <option key={val} value={val}>{val} rows</option>
                  ))}
                </select>
                <svg
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-muted pointer-events-none"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </div>
            </div>
          </div>

          {/* Compact Inline Pagination */}
          {total > pageSize && onPageChange && (
            <div className="flex items-center justify-between sm:justify-start gap-1 sm:pl-1 sm:border-l border-surface-4 bg-surface-0/60 sm:bg-transparent px-2 py-1 sm:p-0 rounded-lg border sm:border-0 border-surface-4/70">
              <span className="text-[10px] font-mono text-ink-muted sm:hidden">
                Page <strong className="text-amber-400">{page}</strong> of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onPageChange(1)}
                  disabled={page <= 1}
                  className="px-2 py-1 rounded-md bg-surface-0 border border-surface-4 hover:border-amber-400/40 text-[10px] font-bold text-ink-muted hover:text-ink-rich disabled:opacity-30 transition-all uppercase"
                  title="First Page"
                >
                  «
                </button>
                <button
                  onClick={() => onPageChange(Math.max(1, page - 1))}
                  disabled={page <= 1}
                  className="px-2.5 py-1 rounded-md bg-surface-0 border border-surface-4 hover:border-amber-400/40 text-xs font-bold text-ink-normal disabled:opacity-30 transition-all"
                  title="Previous Page"
                >
                  ‹
                </button>
                <span className="hidden sm:inline-block px-2.5 py-1 rounded-md bg-surface-2 border border-surface-4 text-[11px] font-mono font-bold text-amber-400 tabular-nums whitespace-nowrap">
                  {page} <span className="text-ink-faint font-normal">/</span> {totalPages}
                </span>
                <button
                  onClick={() => onPageChange(page + 1)}
                  disabled={page >= totalPages}
                  className="px-2.5 py-1 rounded-md bg-surface-0 border border-surface-4 hover:border-amber-400/40 text-xs font-bold text-ink-normal disabled:opacity-30 transition-all"
                  title="Next Page"
                >
                  ›
                </button>
                <button
                  onClick={() => onPageChange(totalPages)}
                  disabled={page >= totalPages}
                  className="px-2 py-1 rounded-md bg-surface-0 border border-surface-4 hover:border-amber-400/40 text-[10px] font-bold text-ink-muted hover:text-ink-rich disabled:opacity-30 transition-all uppercase"
                  title="Last Page"
                >
                  »
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Row 2: Clean Segmented Filter Tabs */}
      <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-surface-4/60 overflow-x-auto no-scrollbar">
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint mr-1 hidden sm:inline shrink-0">
            Filter:
          </span>
          {FILTERS.map(f => {
            const isActive = f.isRecent
              ? (filter === 'recently_added' || (sortBy === 'id' && sortDir === 'desc' && filter === ''))
              : filter === f.key;
            return (
              <button
                key={f.key || 'all'}
                onClick={() => {
                  if (f.isRecent) {
                    if (onSortChange) onSortChange('id', 'desc');
                    onFilter('recently_added');
                  } else {
                    if (filter === 'recently_added' && onSortChange) {
                      onSortChange('title', 'asc');
                    }
                    onFilter(f.key);
                  }
                }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 shrink-0 flex items-center gap-1.5 ${
                  isActive
                    ? 'bg-amber-400/15 text-amber-400 border border-amber-400/35 shadow-xs font-bold'
                    : 'text-ink-muted hover:text-ink-rich hover:bg-surface-2 border border-transparent'
                }`}
                id={`filter-${f.key || 'all'}`}
              >
                {f.isRecent ? (
                  <svg className="w-3 h-3 text-amber-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                ) : (
                  isActive && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
                <span>{f.label}</span>
              </button>
            );
          })}
        </div>

        {(filter || sortBy !== 'title') && (
          <button
            onClick={() => {
              onFilter('');
              if (onSortChange) onSortChange('title', 'asc');
            }}
            className="text-[10px] font-bold text-amber-400 hover:underline uppercase tracking-wider shrink-0 px-2 py-0.5"
          >
            Reset View
          </button>
        )}
      </div>
    </div>
  );
}
