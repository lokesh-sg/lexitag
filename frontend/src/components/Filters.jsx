import React from 'react';

const FILTERS = [
  { key: '', label: 'All', icon: null },
  { key: 'missing_lyrics', label: 'Missing Lyrics' },
  { key: 'has_junk', label: 'Has Junk' },
  { key: 'missing_language', label: 'Missing Language' },
  { key: 'untouched', label: 'Untouched' },
  { key: 'local_fixed', label: 'Local Fixed' },
  { key: 'llm_fixed', label: 'AI Optimized' },
];

export default function Filters({ 
  search, onSearch, 
  searchField, onSearchFieldChange,
  filter, onFilter, 
  groupBy, onGroupBy,
  pageSize, onPageSizeChange
}) {
    const searchFields = [
        { id: 'all', label: 'All Fields' },
        { id: 'title', label: 'Title' },
        { id: 'artist', label: 'Artist' },
        { id: 'album', label: 'Album' },
        { id: 'filename', label: 'Filename' }
    ];

  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 w-full max-w-full min-w-0">
      {/* Search & Filter Pills Row */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1 min-w-0 max-w-full">
        {/* Search */}
        <div className="relative w-full sm:w-80 flex items-center group shrink-0">
          <div className="absolute left-1 top-1/2 -translate-y-1/2 z-10">
              <select
                  value={searchField}
                  onChange={(e) => onSearchFieldChange(e.target.value)}
                  className="appearance-none bg-surface-3 border-none text-[10px] font-bold text-amber-400 uppercase tracking-tighter pl-2 pr-4 py-1.5 rounded-md hover:bg-surface-4 cursor-pointer focus:ring-0 focus:outline-none transition-all w-[90px] truncate"
                  title="Search Field"
              >
                  {searchFields.map(f => (
                      <option key={f.id} value={f.id} className="bg-surface-2 text-ink-rich capitalize">{f.label.replace(' Fields', '')}</option>
                  ))}
              </select>
              <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none opacity-50">
                  <svg className="w-2 h-2 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4">
                      <path d="M6 9l6 6 6-6" />
                  </svg>
              </div>
          </div>
          <input
            type="text"
            placeholder={searchField === 'all' ? "Search everywhere..." : `Search in ${searchField}...`}
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="input-field !pl-[95px] pr-[35px] !text-xs !h-9 border-surface-5/50 focus:border-amber-400/50 w-full"
            id="search-input"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
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
                  title="Refresh View"
              >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M23 4v6h-6M1 20v-6h6" />
                      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
              </button>
          </div>
        </div>

        {/* Filter tabs — with smooth horizontal scroll on mobile */}
        <div className="flex items-center bg-surface-2 rounded-lg border border-surface-5/50 p-0.5 overflow-x-auto scrollbar-none max-w-full shrink-0">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => onFilter(f.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-all duration-150 shrink-0 ${
                filter === f.key
                  ? 'bg-surface-4 text-amber-400 shadow-sm'
                  : 'text-ink-muted hover:text-ink-rich hover:bg-surface-3/50'
              }`}
              id={`filter-${f.key || 'all'}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Controls Right (Page Size & Grouping) */}
      <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0 pt-1 md:pt-0 w-full sm:w-auto">
        {/* Page Size */}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase text-ink-muted tracking-wider hidden sm:inline">Per page:</span>
          <div className="relative group">
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="appearance-none bg-surface-2 border border-surface-5/50 text-ink-rich text-xs font-semibold rounded-lg px-2.5 py-1.5 pr-7 focus:outline-none focus:ring-1 focus:ring-amber-400/50 hover:border-amber-400/30 cursor-pointer transition-all duration-200"
              id="page-size-select"
            >
              {[50, 100, 250, 500, 1000].map(val => (
                <option key={val} value={val}>{val}</option>
              ))}
            </select>
            <svg
              className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-muted pointer-events-none"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </div>
        </div>

        {/* Group By Dropdown */}
        <div className="relative group">
          <select
            value={groupBy}
            onChange={(e) => onGroupBy(e.target.value)}
            className="appearance-none bg-surface-2 border border-surface-5/50 text-ink-rich text-xs font-semibold rounded-lg px-2.5 py-1.5 pr-7 focus:outline-none focus:ring-1 focus:ring-amber-400/50 hover:border-amber-400/30 cursor-pointer transition-all duration-200"
            id="group-by-select"
          >
            <option value="">No Grouping</option>
            <option value="folder">By Folder</option>
          </select>
          <svg
            className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-ink-muted pointer-events-none"
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          >
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </div>
      </div>
    </div>
  );
}
