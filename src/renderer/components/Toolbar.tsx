import React, { useCallback, useState, useEffect } from 'react';
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
    Loader2
} from 'lucide-react';

// Get store state/actions without causing re-renders
const getStore = () => useCatalogStore.getState();

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

export const Toolbar: React.FC = React.memo(() => {
    // ONLY subscribe to what affects render
    const viewMode = useCatalogStore((s) => s.viewMode);
    const sidebarCollapsed = useCatalogStore((s) => s.sidebarCollapsed);
    const rightPanelCollapsed = useCatalogStore((s) => s.rightPanelCollapsed);
    const searchText = useCatalogStore((s) => s.filters.search_text);

    // Check if filters exist (for clear button)
    const hasFilters = useCatalogStore((s) => {
        const f = s.filters;
        return !!(f.rating?.min || f.flag?.length || f.color_label?.length || f.is_raw || f.has_affinity_edit || f.affinity_date || f.search_text);
    });

    const handleViewMode = useCallback((mode: 'grid' | 'loupe' | 'survey' | 'map' | 'develop') => {
        getStore().setViewMode(mode);
    }, []);

    const handleToggleSidebar = useCallback(() => {
        getStore().toggleSidebar();
    }, []);

    const handleToggleRightPanel = useCallback(() => {
        getStore().toggleRightPanel();
    }, []);

    const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const { filters, setFilters } = getStore();
        setFilters({ ...filters, search_text: e.target.value || undefined });
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
                    {(['grid', 'loupe', 'survey', 'map', 'develop'] as const).map((mode) => (
                        <button
                            key={mode}
                            onClick={() => handleViewMode(mode)}
                            className={`p-1.5 rounded ${viewMode === mode ? 'bg-gray-700 text-white' : 'text-gray-400 hover:text-white'}`}
                            title={mode === 'survey' ? 'Rating (N)' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                        >
                            {mode === 'grid' && <Grid3X3 size={18} />}
                            {mode === 'loupe' && <Maximize size={18} />}
                            {mode === 'survey' && <Star size={18} />}
                            {mode === 'map' && <Map size={18} />}
                            {mode === 'develop' && <Aperture size={18} />}
                        </button>
                    ))}
                </div>
            </div>

            {/* Center section - Search */}
            <div className="flex-1 max-w-md mx-4">
                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                    <input
                        type="text"
                        placeholder="Search photos..."
                        value={searchText || ''}
                        onChange={handleSearchChange}
                        className="w-full pl-9 pr-4 py-1.5 bg-gray-800 border border-gray-700 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
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
