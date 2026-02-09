import React, { useState, useEffect, useRef } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import {
    Grid3X3,
    Maximize,
    Search,
    Star,
    Flag,
    X,
    Check,
    SlidersHorizontal,
    ChevronLeft,
    ChevronRight,
    ExternalLink,
    Map,
    Aperture,
    Loader2,
    ScanFace,
    Tag,
    Sparkles,
    Settings,
    MoreHorizontal,
    AlertCircle,
    RefreshCw
} from 'lucide-react';

// View mode configuration
const VIEW_MODES = [
    { mode: 'grid' as const, icon: Grid3X3, title: 'Grid View (G)' },
    { mode: 'loupe' as const, icon: Maximize, title: 'Loupe View (E)' },
    { mode: 'survey' as const, icon: Star, title: 'Rating View (N)' },
    { mode: 'map' as const, icon: Map, title: 'Map View' },
    { mode: 'develop' as const, icon: Aperture, title: 'Develop View (D)' },
    { mode: 'aiface' as const, icon: ScanFace, title: 'AIFACE - People' },
] as const;

const COLOR_LABELS = [
    { value: 'none', color: '#666666', name: 'None' },
    { value: 'red', color: '#ef4444', name: 'Red' },
    { value: 'yellow', color: '#eab308', name: 'Yellow' },
    { value: 'green', color: '#22c55e', name: 'Green' },
    { value: 'blue', color: '#3b82f6', name: 'Blue' },
    { value: 'purple', color: '#a855f7', name: 'Purple' },
] as const;

// Advanced Keyword Filter with search and categories
const AdvancedKeywordFilter: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [keywords, setKeywords] = useState<{ id: string; name: string; photo_count?: number; category?: string }[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null);
    const activeKeyword = useCatalogStore(s => s.filters.keywords);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setLoading(true);
        setError(null);
        window.api.getKeywords()
            .then((kws: any[]) => {
                // Categorize keywords
                const categorized = kws.map((kw: any) => {
                    let category = 'general';
                    const name = kw.name.toLowerCase();
                    if (name.includes('animal') || name.includes('dog') || name.includes('cat') || name.includes('bird') || name.includes('chien') || name.includes('chat') || name.includes('oiseau')) {
                        category = 'animals';
                    } else if (name.includes('building') || name.includes('house') || name.includes('architecture') || name.includes('maison') || name.includes('église')) {
                        category = 'architecture';
                    } else if (name.includes('nature') || name.includes('forest') || name.includes('beach') || name.includes('tree') || name.includes('forêt') || name.includes('plage') || name.includes('arbre')) {
                        category = 'nature';
                    } else if (name.includes('food') || name.includes('drink') || name.includes('nourriture') || name.includes('boisson')) {
                        category = 'food';
                    }
                    return { ...kw, category };
                });
                const sorted = categorized.sort((a: any, b: any) => (b.photo_count || 0) - (a.photo_count || 0));
                setKeywords(sorted);
            })
            .catch((err: any) => {
                console.error('[KeywordFilter] Failed to load keywords:', err);
                setError('Failed to load keywords');
            })
            .finally(() => setLoading(false));
    }, []);

    const filteredKeywords = keywords.filter(kw => {
        const matchesSearch = kw.name.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesCategory = !activeCategory || kw.category === activeCategory;
        return matchesSearch && matchesCategory;
    });

    const categories = ['all', 'animals', 'architecture', 'nature', 'food', 'general'];

    const handleKeywordClick = (keywordName: string) => {
        const store = useCatalogStore.getState();
        if (activeKeyword?.includes(keywordName)) {
            store.setFilters({ ...store.filters, keywords: undefined });
        } else {
            store.setFilters({ ...store.filters, keywords: [keywordName], search_text: keywordName });
            store.setViewMode('grid');
        }
        setIsOpen(false);
    };

    const handleClearKeyword = () => {
        const store = useCatalogStore.getState();
        store.setFilters({ ...store.filters, keywords: undefined });
        setIsOpen(false);
    };

    if (loading) {
        return (
            <div className="p-1.5">
                <Loader2 size={16} className="animate-spin text-gray-400" />
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-1.5" title={error}>
                <AlertCircle size={16} className="text-red-400" />
            </div>
        );
    }

    if (keywords.length === 0) return null;

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`p-1.5 rounded transition-colors ${
                    activeKeyword ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'
                }`}
                title="Filter by keyword"
            >
                <Tag size={16} />
            </button>

            {isOpen && (
                <>
                    <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                    <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 py-2 min-w-[250px] max-h-[400px] overflow-hidden flex flex-col">
                        <div className="px-3 py-2 border-b border-gray-700 flex items-center justify-between">
                            <h3 className="text-sm font-medium text-gray-300">Filter by Keywords</h3>
                            {activeKeyword && (
                                <button
                                    onClick={handleClearKeyword}
                                    className="text-xs text-red-400 hover:text-white flex items-center gap-1"
                                >
                                    <X size={12} />
                                    Clear
                                </button>
                            )}
                        </div>

                        <div className="p-2 border-b border-gray-700">
                            <div className="relative">
                                <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input
                                    type="text"
                                    placeholder="Search keywords..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 bg-gray-700 border border-gray-600 rounded text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500"
                                />
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-1 p-2 border-b border-gray-700 bg-gray-900/50">
                            {categories.map(category => (
                                <button
                                    key={category}
                                    onClick={() => setActiveCategory(category === 'all' ? null : category)}
                                    className={`px-2 py-1 text-xs rounded ${
                                        activeCategory === category || (activeCategory === null && category === 'all')
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                                >
                                    {category.charAt(0).toUpperCase() + category.slice(1)}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-y-auto p-1">
                            {filteredKeywords.length === 0 ? (
                                <div className="p-3 text-center text-gray-500 text-sm">
                                    No keywords found
                                </div>
                            ) : (
                                filteredKeywords.map((kw) => (
                                    <button
                                        key={kw.id}
                                        onClick={() => handleKeywordClick(kw.name)}
                                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-700 flex items-center justify-between
                                            ${activeKeyword?.includes(kw.name) ? 'text-blue-400 bg-gray-700/50' : 'text-gray-300'}`}
                                    >
                                        <span className="truncate">{kw.name}</span>
                                        <span className="text-xs text-gray-500 ml-2">{kw.photo_count || 0}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// Processing status indicator with detailed info
const ProcessingIndicator: React.FC = () => {
    const [progress, setProgress] = useState<{ current: number; total: number; status?: string } | null>(null);
    const [showDetails, setShowDetails] = useState(false);

    useEffect(() => {
        const unsubscribe = window.api.onThumbnailsProgress((p: any) => {
            if (p.done) {
                setProgress(null);
            } else if (p.total > 0) {
                setProgress({ current: p.current, total: p.total, status: p.status });
            }
        });
        return unsubscribe;
    }, []);

    if (!progress) return null;

    const percent = Math.round((progress.current / progress.total) * 100);

    return (
        <div className="relative group">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-900/50 rounded-lg text-xs text-blue-300 hover:bg-blue-800/50 transition-colors cursor-pointer"
                 onClick={() => setShowDetails(!showDetails)}>
                <Loader2 size={14} className="animate-spin" />
                <span>Processing {progress.current}/{progress.total} ({percent}%)</span>
                <MoreHorizontal size={14} className="opacity-70" />
            </div>

            {showDetails && progress.status && (
                <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-20 py-2 min-w-[200px]">
                    <div className="px-3 py-1.5 text-xs text-gray-400 border-b border-gray-700">
                        Current Status
                    </div>
                    <div className="px-3 py-2 text-sm text-gray-300">
                        {progress.status}
                    </div>
                </div>
            )}
        </div>
    );
};

// Enhanced AI Auto-Tag button with progress
const AITagButton: React.FC = () => {
    const [isTagging, setIsTagging] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number; status: string } | null>(null);
    const selectedCount = useCatalogStore(s => s.selectedPhotoIds.size);

    const handleAITag = async () => {
        const store = useCatalogStore.getState();
        const { selectedPhotoIds, photos } = store;
        const selectedPhotos = photos.filter(p => selectedPhotoIds.has(p.id));

        if (selectedPhotos.length === 0) {
            alert('Select photos to auto-tag with AI');
            return;
        }

        setIsTagging(true);
        setProgress({ current: 0, total: selectedPhotos.length, status: 'Loading AI model...' });

        try {
            const initialized = await window.api.aiInit();
            if (!initialized) {
                throw new Error('Could not load AI model. Check console for details.');
            }

            for (let i = 0; i < selectedPhotos.length; i++) {
                const photo = selectedPhotos[i];
                setProgress({ current: i + 1, total: selectedPhotos.length, status: `Analyzing ${photo.file_name}...` });

                try {
                    const keywords = await window.api.aiAnalyze(photo.id);
                    console.log(`Tagged ${photo.file_name}:`, keywords);
                } catch (err) {
                    console.error(`Error tagging ${photo.file_name}:`, err);
                }
            }

            setProgress({ current: selectedPhotos.length, total: selectedPhotos.length, status: 'Analysis complete!' });
            setTimeout(() => setProgress(null), 3000);
        } catch (error) {
            console.error('AI tagging error:', error);
            alert('AI tagging failed: ' + (error as Error).message);
            setProgress(null);
        } finally {
            setIsTagging(false);
        }
    };

    if (progress) {
        return (
            <div className="relative group">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-900/50 rounded-lg text-xs text-purple-300">
                    <Loader2 size={14} className="animate-spin" />
                    <span>{progress.status} ({progress.current}/{progress.total})</span>
                </div>
            </div>
        );
    }

    return (
        <button
            onClick={handleAITag}
            disabled={isTagging || selectedCount === 0}
            className={`flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg transition-colors
                ${selectedCount > 0
                    ? 'text-purple-300 hover:text-white hover:bg-purple-800/50'
                    : 'text-gray-600 cursor-not-allowed'}`}
            title={selectedCount > 0 ? `AI Auto-Tag ${selectedCount} selected photos` : 'Select photos to AI tag'}
        >
            <Sparkles size={16} />
            <span>AI Tag</span>
        </button>
    );
};

// Selection actions component
const SelectionActions: React.FC = React.memo(() => {
    const selectedCount = useCatalogStore(s => s.selectedPhotoIds.size);

    if (selectedCount === 0) return null;

    const handleRating = (rating: number) => useCatalogStore.getState().setSelectedRating(rating);
    const handleFlag = (flag: 'none' | 'picked' | 'rejected') => useCatalogStore.getState().setSelectedFlag(flag);
    const handleColor = (color: string) => useCatalogStore.getState().setSelectedColorLabel(color as any);
    const handleDeselectAll = () => useCatalogStore.getState().deselectAll();

    return (
        <div className="flex items-center gap-1 bg-gray-800 rounded-lg p-1">
            <span className="text-sm text-gray-400 px-2">{selectedCount} selected</span>

            <button
                onClick={handleDeselectAll}
                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                title="Deselect all"
            >
                <X size={16} />
            </button>

            <div className="h-6 w-px bg-gray-700" />

            {/* Rating */}
            <div className="flex items-center">
                {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                        key={rating}
                        onClick={() => handleRating(rating)}
                        className="p-1.5 text-gray-400 hover:text-yellow-400 hover:bg-gray-700 rounded"
                    >
                        <Star size={16} />
                    </button>
                ))}
            </div>

            <div className="h-6 w-px bg-gray-700" />

            {/* Flags */}
            <div className="flex items-center gap-1">
                <button onClick={() => handleFlag('picked')} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                    <Check size={16} />
                </button>
                <button onClick={() => handleFlag('none')} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                    <Flag size={16} />
                </button>
                <button onClick={() => handleFlag('rejected')} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                    <X size={16} />
                </button>
            </div>

            <div className="h-6 w-px bg-gray-700" />

            {/* Colors */}
            <div className="flex items-center gap-1">
                {COLOR_LABELS.map((label) => (
                    <button
                        key={label.value}
                        onClick={() => handleColor(label.value)}
                        className="w-5 h-5 rounded-full border-2 border-transparent hover:border-white"
                        style={{ backgroundColor: label.color }}
                        title={label.name}
                    />
                ))}
            </div>
        </div>
    );
});
SelectionActions.displayName = 'SelectionActions';

// Main Toolbar component
const Toolbar: React.FC = () => {
    const viewMode = useCatalogStore(s => s.viewMode);
    const sidebarCollapsed = useCatalogStore(s => s.sidebarCollapsed);
    const rightPanelCollapsed = useCatalogStore(s => s.rightPanelCollapsed);
    const searchText = useCatalogStore(s => s.filters.search_text);
    const hasFilters = useCatalogStore(s => {
        const f = s.filters;
        return !!(f.rating?.min || f.flag?.length || f.color_label?.length || f.is_raw || f.has_affinity_edit || f.affinity_date || f.search_text);
    });

    const searchInputRef = useRef<HTMLInputElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [localSearch, setLocalSearch] = useState(searchText || '');
    const [showSearchOptions, setShowSearchOptions] = useState(false);

    // Sync local search with store when store changes externally (e.g. clear filters)
    useEffect(() => {
        setLocalSearch(searchText || '');
    }, [searchText]);

    // Prevent keyboard shortcuts from triggering when typing in search
    useEffect(() => {
        const input = searchInputRef.current;
        if (!input) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            e.stopImmediatePropagation();
        };

        input.addEventListener('keydown', handleKeyDown, true);
        return () => input.removeEventListener('keydown', handleKeyDown, true);
    }, []);

    const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLocalSearch(value);

        // Debounce store update
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            const store = useCatalogStore.getState();
            store.setFilters({ ...store.filters, search_text: value || undefined });

            if (value) {
                store.setActiveFolderId(null);
                store.setActiveCollectionId(null);
                localStorage.removeItem('photocatalog_active_folder');
                if (store.viewMode !== 'grid') {
                    store.setViewMode('grid');
                }
            }
        }, 300);
    };

    const handleClearFilters = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setLocalSearch('');
        useCatalogStore.getState().clearFilters();
    };

    const handleViewMode = (mode: 'grid' | 'loupe' | 'survey' | 'map' | 'develop' | 'aiface') => {
        useCatalogStore.getState().setViewMode(mode);
    };

    const handleOpenInAffinity = async () => {
        const { photos, activePhotoId } = useCatalogStore.getState();
        const photo = photos.find(p => p.id === activePhotoId);
        if (photo) {
            await window.api.openInAffinityPhoto(photo.file_path, photo.id);
        }
    };

    const handleRefresh = () => {
        useCatalogStore.getState().refreshCatalog();
    };

    return (
        <div className="h-14 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-3 gap-2">
            {/* Left section */}
            <div className="flex items-center gap-2">
                <button
                    onClick={() => useCatalogStore.getState().toggleSidebar()}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
                    title={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
                >
                    {sidebarCollapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
                </button>

                <div className="h-8 w-px bg-gray-700" />

                <div className="flex bg-gray-800 rounded-lg p-1">
                    {VIEW_MODES.map(({ mode, icon: Icon, title }) => (
                        <button
                            key={mode}
                            onClick={() => handleViewMode(mode)}
                            className={`p-2 rounded-lg ${viewMode === mode ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                            title={title}
                        >
                            <Icon size={20} />
                        </button>
                    ))}
                </div>
            </div>

            {/* Center section - Enhanced search with keyword filter */}
            <div className="flex-1 max-w-2xl mx-4 flex items-center gap-2">
                <AdvancedKeywordFilter />

                <div className="relative flex-1">
                    <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search photos, keywords, faces..."
                        value={localSearch}
                        onChange={handleSearchChange}
                        className="w-full pl-10 pr-12 py-2 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                            onClick={() => setShowSearchOptions(!showSearchOptions)}
                            className="p-1 text-gray-500 hover:text-white hover:bg-gray-700 rounded"
                            title="Search options"
                        >
                            <Settings size={16} />
                        </button>
                        {hasFilters && (
                            <button
                                onClick={handleClearFilters}
                                className="p-1 text-gray-500 hover:text-white hover:bg-gray-700 rounded"
                                title="Clear filters"
                            >
                                <X size={16} />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Processing indicator */}
            <ProcessingIndicator />

            {/* Selection actions */}
            <SelectionActions />

            {/* AI Auto-Tag button */}
            <AITagButton />

            {/* Action buttons */}
            <div className="flex items-center gap-1">
                <button
                    onClick={handleRefresh}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
                    title="Refresh"
                >
                    <RefreshCw size={20} />
                </button>

                <button
                    onClick={() => useCatalogStore.getState().toggleRightPanel()}
                    className={`p-2 rounded-lg ${!rightPanelCollapsed ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                    title="Toggle Info Panel"
                >
                    <SlidersHorizontal size={20} />
                </button>

                <button
                    onClick={handleOpenInAffinity}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg"
                    title="Edit in Affinity Photo"
                >
                    <ExternalLink size={20} />
                </button>
            </div>
        </div>
    );
};

Toolbar.displayName = 'Toolbar';

export { Toolbar };
export default React.memo(Toolbar);
