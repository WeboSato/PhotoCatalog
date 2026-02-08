import React, { useCallback, useState, useEffect, useRef } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import {
    Grid3X3,
    Maximize,
    Columns,
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
    ChevronDown,
    Filter,
    Sparkles
} from 'lucide-react';

// Get store state/actions without causing re-renders
const getStore = () => useCatalogStore.getState();

// Keyword filter dropdown component
const KeywordFilter: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [keywords, setKeywords] = useState<{ id: string; name: string; photo_count?: number }[]>([]);
    const activeKeyword = useCatalogStore((s) => s.filters.keywords);

    // Load keywords on mount
    useEffect(() => {
        window.api.getKeywords().then((kws) => {
            // Sort by photo_count descending
            const sorted = kws.sort((a: any, b: any) => (b.photo_count || 0) - (a.photo_count || 0));
            setKeywords(sorted.slice(0, 20)); // Top 20 keywords
        });
    }, []);

    const handleKeywordClick = (keywordName: string) => {
        const { filters, setFilters, setViewMode } = getStore();
        if (activeKeyword?.includes(keywordName)) {
            // Remove keyword filter
            setFilters({ ...filters, keywords: undefined });
        } else {
            // Add keyword filter and switch to grid view
            setFilters({ ...filters, keywords: [keywordName], search_text: keywordName });
            setViewMode('grid');
        }
        setIsOpen(false);
    };

    const handleClearKeyword = () => {
        const { filters, setFilters } = getStore();
        setFilters({ ...filters, keywords: undefined });
        setIsOpen(false);
    };

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
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setIsOpen(false)}
                    />
                    <div className="absolute left-0 top-full mt-1 bg-gray-800 border border-gray-700
                                    rounded-lg shadow-xl z-20 py-1 min-w-[200px] max-h-[300px] overflow-y-auto">
                        <div className="px-3 py-1.5 text-xs text-gray-500 border-b border-gray-700">
                            Top Keywords
                        </div>
                        {activeKeyword && (
                            <button
                                onClick={handleClearKeyword}
                                className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-gray-700 flex items-center gap-2"
                            >
                                <X size={12} />
                                Clear filter
                            </button>
                        )}
                        {keywords.map((kw) => (
                            <button
                                key={kw.id}
                                onClick={() => handleKeywordClick(kw.name)}
                                className={`w-full text-left px-3 py-1.5 text-sm hover:bg-gray-700 flex items-center justify-between
                                    ${activeKeyword?.includes(kw.name) ? 'text-blue-400 bg-gray-700/50' : 'text-gray-300'}`}
                            >
                                <span className="truncate">{kw.name}</span>
                                <span className="text-xs text-gray-500 ml-2">{kw.photo_count || 0}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

// Processing status indicator component
const ProcessingIndicator: React.FC = () => {
    const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

    useEffect(() => {
        const unsubscribe = window.api.onThumbnailsProgress((p) => {
            if (p.done) {
                setProgress(null);
            } else if (p.total > 0) {
                setProgress({ current: p.current, total: p.total });
            }
        });
        return unsubscribe;
    }, []);

    if (!progress) return null;

    const percent = Math.round((progress.current / progress.total) * 100);

    return (
        <div className="flex items-center gap-2 px-2 py-1 bg-blue-900/50 rounded text-xs text-blue-300">
            <Loader2 size={12} className="animate-spin" />
            <span>Processing {progress.current}/{progress.total} ({percent}%)</span>
        </div>
    );
};

// AI Auto-Tag button component
const AITagButton: React.FC = () => {
    const [isTagging, setIsTagging] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number; status: string } | null>(null);
    const selectedCount = useCatalogStore((s) => s.selectedPhotoIds.size);

    const handleAITag = async () => {
        const { selectedPhotoIds, photos } = getStore();
        const selectedPhotos = photos.filter(p => selectedPhotoIds.has(p.id));

        if (selectedPhotos.length === 0) {
            alert('Select photos to auto-tag with AI');
            return;
        }

        setIsTagging(true);
        setProgress({ current: 0, total: selectedPhotos.length, status: 'Loading AI models...' });

        try {
            // Dynamically import the AI service
            const { aiImageService } = await import('../services/AIImageService');

            // Initialize AI models
            const initialized = await aiImageService.initialize((pct, status) => {
                setProgress(prev => prev ? { ...prev, status } : null);
            });

            if (!initialized) {
                throw new Error('Failed to initialize AI models');
            }

            // Process each photo
            for (let i = 0; i < selectedPhotos.length; i++) {
                const photo = selectedPhotos[i];
                setProgress({ current: i + 1, total: selectedPhotos.length, status: `Analyzing ${photo.file_name}...` });

                try {
                    const imageUrl = photo.thumbnail_path
                        ? `local-image://${photo.thumbnail_path}`
                        : `local-image://${photo.file_path}`;

                    const result = await aiImageService.analyzeImage(imageUrl);

                    if (result.keywords.length > 0) {
                        await window.api.addKeywordsByName(photo.id, result.keywords);
                    }
                } catch (err) {
                    console.error(`Error tagging ${photo.file_name}:`, err);
                }
            }

            setProgress({ current: selectedPhotos.length, total: selectedPhotos.length, status: 'Done!' });
            setTimeout(() => setProgress(null), 2000);
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
            <div className="flex items-center gap-2 px-2 py-1 bg-purple-900/50 rounded text-xs text-purple-300">
                <Loader2 size={12} className="animate-spin" />
                <span>{progress.status} ({progress.current}/{progress.total})</span>
            </div>
        );
    }

    return (
        <button
            onClick={handleAITag}
            disabled={isTagging || selectedCount === 0}
            className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded transition-colors
                ${selectedCount > 0
                    ? 'text-purple-300 hover:text-white hover:bg-purple-800/50'
                    : 'text-gray-600 cursor-not-allowed'}`}
            title={selectedCount > 0 ? `AI Auto-Tag ${selectedCount} selected photos` : 'Select photos to AI tag'}
        >
            <Sparkles size={14} />
            <span>AI Tag</span>
        </button>
    );
};

export const Toolbar: React.FC = React.memo(() => {
    // ONLY subscribe to what affects render
    const viewMode = useCatalogStore((s) => s.viewMode);
    const sidebarCollapsed = useCatalogStore((s) => s.sidebarCollapsed);
    const rightPanelCollapsed = useCatalogStore((s) => s.rightPanelCollapsed);
    const searchText = useCatalogStore((s) => s.filters.search_text);

    // Ref for search input to attach native event listener
    const searchInputRef = useRef<HTMLInputElement>(null);

    // Use native event listener with stopImmediatePropagation to prevent
    // keyboard shortcuts from triggering when typing in search input
    useEffect(() => {
        const input = searchInputRef.current;
        if (!input) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Stop the event from reaching any other listeners (like window shortcuts)
            e.stopImmediatePropagation();
        };

        // Add listener in capture phase to intercept before bubble phase listeners
        input.addEventListener('keydown', handleKeyDown, true);
        return () => input.removeEventListener('keydown', handleKeyDown, true);
    }, []);

    // Check if filters exist (for clear button)
    const hasFilters = useCatalogStore((s) => {
        const f = s.filters;
        return !!(f.rating?.min || f.flag?.length || f.color_label?.length || f.is_raw || f.has_affinity_edit || f.affinity_date || f.search_text);
    });

    const handleViewMode = useCallback((mode: 'grid' | 'loupe' | 'survey' | 'map' | 'develop' | 'aiface') => {
        getStore().setViewMode(mode);
    }, []);

    const handleToggleSidebar = useCallback(() => {
        getStore().toggleSidebar();
    }, []);

    const handleToggleRightPanel = useCallback(() => {
        getStore().toggleRightPanel();
    }, []);

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { filters, setFilters, viewMode, setViewMode, setActiveFolderId, setActiveCollectionId } = getStore();
        setFilters({ ...filters, search_text: e.target.value || undefined });
        // When searching, clear folder/collection filter to search ALL photos
        if (e.target.value) {
            setActiveFolderId(null);
            setActiveCollectionId(null);
            // Switch to grid view to show results
            if (viewMode !== 'grid') {
                setViewMode('grid');
            }
        }
    }, []);

    const handleClearFilters = useCallback(() => {
        getStore().clearFilters();
    }, []);

    const handleOpenInAffinity = useCallback(async () => {
        const { photos, activePhotoId } = getStore();
        const photo = photos.find((p) => p.id === activePhotoId);
        if (photo) {
            await window.api.openInAffinityPhoto(photo.file_path, photo.id);
        }
    }, []);

    const colorLabels = [
        { value: 'none', color: '#666666', name: 'None' },
        { value: 'red', color: '#ef4444', name: 'Red' },
        { value: 'yellow', color: '#eab308', name: 'Yellow' },
        { value: 'green', color: '#22c55e', name: 'Green' },
        { value: 'blue', color: '#3b82f6', name: 'Blue' },
        { value: 'purple', color: '#a855f7', name: 'Purple' }
    ];

    return (
        <div className="h-12 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-2 gap-2">
            {/* Left section */}
            <div className="flex items-center gap-2">
                <button
                    onClick={handleToggleSidebar}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                    title={sidebarCollapsed ? 'Show Sidebar' : 'Hide Sidebar'}
                >
                    {sidebarCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                </button>

                <div className="h-6 w-px bg-gray-700" />

                <div className="flex bg-gray-800 rounded p-0.5">
                    {(['grid', 'loupe', 'survey', 'map', 'develop', 'aiface'] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => handleViewMode(mode)}
                            className={`p-1.5 rounded ${viewMode === mode ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                            title={mode === 'survey' ? 'Rating (N)' : mode === 'aiface' ? 'AIFACE - People' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                        >
                            {mode === 'grid' && <Grid3X3 size={18} />}
                            {mode === 'loupe' && <Maximize size={18} />}
                            {mode === 'survey' && <Star size={18} />}
                            {mode === 'map' && <Map size={18} />}
                            {mode === 'develop' && <Aperture size={18} />}
                            {mode === 'aiface' && <ScanFace size={18} />}
                        </button>
                    ))}
                </div>
            </div>

            {/* Center section - Search with keyword filter */}
            <div className="flex-1 max-w-lg mx-4 flex items-center gap-2">
                <KeywordFilter />
                <div className="relative flex-1">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        ref={searchInputRef}
                        type="text"
                        placeholder="Search photos, keywords..."
                        value={searchText || ''}
                        onChange={handleSearchChange}
                        className="w-full pl-9 pr-8 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                    />
                    {hasFilters && (
                        <button
                            onClick={handleClearFilters}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white"
                            title="Clear filters"
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            {/* Processing indicator */}
            <ProcessingIndicator />

            {/* Right section - Selection actions (rendered on demand) */}
            <SelectionActions colorLabels={colorLabels} />

            {/* AI Auto-Tag button */}
            <AITagButton />

            {/* Edit button */}
            <button
                onClick={handleOpenInAffinity}
                className="flex items-center gap-1 px-2 py-1.5 text-sm text-gray-300 hover:text-white hover:bg-gray-800 rounded"
                title="Edit in Affinity Photo"
            >
                <ExternalLink size={14} />
                <span>Edit</span>
            </button>

            {/* Info panel toggle */}
            <button
                onClick={handleToggleRightPanel}
                className={`p-2 rounded ${!rightPanelCollapsed ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-800'}`}
                title="Toggle Info Panel"
            >
                <SlidersHorizontal size={18} />
            </button>
        </div>
    );
});

// Separate component for selection actions - only re-renders when selection changes
const SelectionActions: React.FC<{ colorLabels: { value: string; color: string; name: string }[] }> = React.memo(({ colorLabels }) => {
    const selectedCount = useCatalogStore((s) => s.selectedPhotoIds.size);

    if (selectedCount === 0) return null;

    const handleRating = (rating: number) => {
        getStore().setSelectedRating(rating);
    };

    const handleFlag = (flag: 'none' | 'picked' | 'rejected') => {
        getStore().setSelectedFlag(flag);
    };

    const handleColor = (color: string) => {
        getStore().setSelectedColorLabel(color as any);
    };

    const handleDeselectAll = () => {
        getStore().deselectAll();
    };

    return (
        <>
            <span className="text-sm text-gray-400">{selectedCount} selected</span>
            <button
                onClick={handleDeselectAll}
                className="ml-1 p-1 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                title="Deselect all"
            >
                <X size={14} />
            </button>
            <div className="h-6 w-px bg-gray-700" />

            {/* Rating */}
            <div className="flex items-center">
                {[1, 2, 3, 4, 5].map((rating) => (
                    <button
                        key={rating}
                        onClick={() => handleRating(rating)}
                        className="p-1 text-gray-400 hover:text-yellow-400"
                    >
                        <Star size={14} />
                    </button>
                ))}
            </div>

            <div className="h-6 w-px bg-gray-700" />

            {/* Flags */}
            <div className="flex items-center gap-1">
                <button onClick={() => handleFlag('picked')} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded">
                    <Check size={14} />
                </button>
                <button onClick={() => handleFlag('none')} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded">
                    <Flag size={14} />
                </button>
                <button onClick={() => handleFlag('rejected')} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded">
                    <X size={14} />
                </button>
            </div>

            <div className="h-6 w-px bg-gray-700" />

            {/* Colors */}
            <div className="flex items-center gap-1">
                {colorLabels.map((label) => (
                    <button
                        key={label.value}
                        onClick={() => handleColor(label.value)}
                        className="w-5 h-5 rounded-full border-2 border-transparent hover:border-white"
                        style={{ backgroundColor: label.color }}
                        title={label.name}
                    />
                ))}
            </div>

            <div className="h-6 w-px bg-gray-700" />
        </>
    );
});

Toolbar.displayName = 'Toolbar';
SelectionActions.displayName = 'SelectionActions';

export default Toolbar;
