import React, { useCallback, useState, useRef, useEffect, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useCatalogStore, Photo, DevelopmentSettings, defaultDevelopmentSettings } from '../stores/catalogStore';
import { Minus, Plus, RotateCcw, RotateCw, Trash2, Star, X } from 'lucide-react';
import { getThumbnailUrl, PLACEHOLDER_IMAGE } from '../utils/imageUrl';
import { decode } from 'blurhash';
import { DeleteDialog } from './DeleteDialog';

const getStore = () => useCatalogStore.getState();

// Compute CSS filter from development settings
const computeCssFilter = (devSettings: DevelopmentSettings | null): string => {
    if (!devSettings) return 'none';

    const filters: string[] = [];

    if (devSettings.exposure !== 0) {
        const brightness = 100 + devSettings.exposure;
        filters.push(`brightness(${brightness}%)`);
    }

    if (devSettings.contrast !== 0) {
        const contrast = 100 + devSettings.contrast;
        filters.push(`contrast(${contrast}%)`);
    }

    if (devSettings.saturation !== 0) {
        const saturate = 100 + devSettings.saturation;
        filters.push(`saturate(${saturate}%)`);
    }

    if (devSettings.vibrance !== 0) {
        const saturate = 100 + (devSettings.vibrance * 0.5);
        filters.push(`saturate(${saturate}%)`);
    }

    if (devSettings.temperature !== 0) {
        if (devSettings.temperature > 0) {
            const sepia = devSettings.temperature * 0.3;
            filters.push(`sepia(${sepia}%)`);
        } else {
            const hueRotate = devSettings.temperature * 0.5;
            filters.push(`hue-rotate(${hueRotate}deg)`);
        }
    }

    if (devSettings.clarity !== 0) {
        const contrast = 100 + (devSettings.clarity * 0.3);
        filters.push(`contrast(${contrast}%)`);
    }

    return filters.length > 0 ? filters.join(' ') : 'none';
};

// Parse develop_settings from photo
const parseDevSettings = (photo: Photo): DevelopmentSettings | null => {
    if (!photo.develop_settings) return null;
    try {
        const parsed = typeof photo.develop_settings === 'string'
            ? JSON.parse(photo.develop_settings)
            : photo.develop_settings;
        return { ...defaultDevelopmentSettings, ...parsed };
    } catch {
        return null;
    }
};

// Darktable-style scroll compression: accumulate scroll events
const useScrollCompression = (callback: (delta: number) => void, delay: number = 16) => {
    const accumulatedDelta = useRef(0);
    const timeoutRef = useRef<number | null>(null);

    return useCallback((delta: number) => {
        accumulatedDelta.current += delta;

        if (timeoutRef.current === null) {
            timeoutRef.current = window.setTimeout(() => {
                if (accumulatedDelta.current !== 0) {
                    callback(accumulatedDelta.current);
                    accumulatedDelta.current = 0;
                }
                timeoutRef.current = null;
            }, delay);
        }
    }, [callback, delay]);
};

// Context menu state
interface ContextMenuState {
    visible: boolean;
    x: number;
    y: number;
    photo: Photo | null;
}

// Color labels for survey mode
const colorLabels = [
    { value: 'none', color: '#666666' },
    { value: 'red', color: '#ef4444' },
    { value: 'yellow', color: '#eab308' },
    { value: 'green', color: '#22c55e' },
    { value: 'blue', color: '#3b82f6' },
    { value: 'purple', color: '#a855f7' }
] as const;

// Darktable-style BEST_EFFORT: show loading state, not error
const PhotoCell = React.memo<{
    photo: Photo;
    isSelected: boolean;
    size: number;
    inSurveyMode?: boolean;
    onClick: (e: React.MouseEvent) => void;
    onDblClick: () => void;
    onContextMenu: (e: React.MouseEvent, photo: Photo) => void;
    onRatingChange?: (rating: number) => void;
    onColorChange?: (color: string) => void;
    onReject?: () => void;
}>(({ photo, isSelected, size, inSurveyMode, onClick, onDblClick, onContextMenu, onRatingChange, onColorChange, onReject }) => {
    const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');

    const thumbUrl = useMemo(() => getThumbnailUrl(photo), [photo.thumbnail_path]);

    // Compute CSS filter for this photo's develop settings
    const cssFilter = useMemo(() => {
        const devSettings = parseDevSettings(photo);
        return computeCssFilter(devSettings);
    }, [photo.develop_settings]);

    // BlurHash canvas placeholder
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        if (!photo.blur_hash || !canvasRef.current) return;
        try {
            const pixels = decode(photo.blur_hash, 32, 32);
            const ctx = canvasRef.current.getContext('2d');
            if (!ctx) return;
            const imageData = ctx.createImageData(32, 32);
            imageData.data.set(pixels);
            ctx.putImageData(imageData, 0, 0);
        } catch {
            // Invalid blur hash, ignore
        }
    }, [photo.blur_hash]);

    // Reset state when URL changes
    useEffect(() => {
        if (!thumbUrl || thumbUrl === PLACEHOLDER_IMAGE) {
            setLoadState('error');
        } else {
            setLoadState('loading');
        }
    }, [thumbUrl]);

    const handleLoad = useCallback(() => {
        setLoadState('loaded');
    }, []);

    const handleError = useCallback(() => {
        setLoadState('error');
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        onContextMenu(e, photo);
    }, [onContextMenu, photo]);

    return (
        <div
            className="photo-cell"
            style={{
                width: '100%',
                height: '100%',
                borderColor: isSelected ? '#3b82f6' : 'transparent',
                background: '#1a1a1a',
                position: 'relative'
            }}
            onClick={onClick}
            onDoubleClick={onDblClick}
            onContextMenu={handleContextMenu}
        >
            {/* Always render img but hide when loading/error */}
            <img
                src={thumbUrl}
                alt=""
                decoding="async"
                onLoad={handleLoad}
                onError={handleError}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    display: loadState === 'loaded' ? 'block' : 'none',
                    filter: cssFilter,
                }}
            />
            {loadState === 'loading' && (
                <div style={{
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                }}>
                    {photo.blur_hash ? (
                        <canvas
                            ref={canvasRef}
                            width={32}
                            height={32}
                            style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                            }}
                        />
                    ) : (
                        <div style={{
                            width: 24,
                            height: 24,
                            border: '2px solid #333',
                            borderTopColor: '#666',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                        }} />
                    )}
                </div>
            )}
            {loadState === 'error' && (
                // Error state - minimal indicator
                <div style={{
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(135deg, #2a2a2a 0%, #1a1a1a 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#444',
                    fontSize: 9,
                    position: 'absolute',
                    top: 0,
                    left: 0,
                }}>
                    {photo.file_type || '?'}
                </div>
            )}
            {/* File type badge - show AFI for Affinity edits, RAW for raw files */}
            {(() => {
                // Check for Affinity edit
                const hasAffinityEdit = photo.edit_copy_path &&
                    (photo.edit_copy_path.toLowerCase().endsWith('.afphoto') ||
                     photo.edit_copy_path.toLowerCase().endsWith('.af'));
                const isAffinityType = photo.file_type === 'AFPHOTO';

                if (hasAffinityEdit || isAffinityType) {
                    return <span className="badge-raw" style={{ backgroundColor: '#ef4444', color: '#000' }}>AFI</span>;
                } else if (photo.is_raw) {
                    return <span className="badge-raw">RAW</span>;
                }
                return null;
            })()}
            {photo.rating > 0 && <div className="badge-rating">{'★'.repeat(photo.rating)}</div>}
            {/* Red folded corner badge for Affinity edits */}
            {photo.edit_copy_path && (photo.edit_copy_path.toLowerCase().endsWith('.afphoto') || photo.edit_copy_path.toLowerCase().endsWith('.af')) && (
                <>
                    {/* Shadow under the peeled corner */}
                    <div
                        style={{
                            position: 'absolute',
                            top: 2,
                            right: -2,
                            width: 0,
                            height: 0,
                            borderStyle: 'solid',
                            borderWidth: '0 28px 28px 0',
                            borderColor: 'transparent rgba(0,0,0,0.5) transparent transparent',
                            filter: 'blur(3px)',
                        }}
                    />
                    <div
                        className="edit-badge-affinity"
                        title="Affinity Photo edit"
                        style={{
                            position: 'absolute',
                            top: 0,
                            right: 0,
                            width: 0,
                            height: 0,
                            borderStyle: 'solid',
                            borderWidth: '0 28px 28px 0',
                            borderColor: 'transparent #f87171 transparent transparent',
                        }}
                    />
                    {/* New update indicator dot */}
                    <div
                        className="update-dot"
                        title="Modified in Affinity"
                        style={{
                            position: 'absolute',
                            bottom: 6,
                            right: 6,
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: '#fbbf24',
                            border: '1px solid rgba(0,0,0,0.3)',
                            boxShadow: '0 0 4px rgba(251, 191, 36, 0.6)',
                        }}
                    />
                </>
            )}

            {/* Survey mode overlay - rating and color controls */}
            {inSurveyMode && (
                <div
                    className="survey-overlay"
                    style={{
                        position: 'absolute',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        background: 'linear-gradient(transparent, rgba(0,0,0,0.85))',
                        padding: '20px 6px 6px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '4px',
                    }}
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Rating stars */}
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '4px' }}>
                        {[1, 2, 3, 4, 5].map((rating) => (
                            <button
                                key={rating}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRatingChange?.(photo.rating === rating ? 0 : rating);
                                }}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    cursor: 'pointer',
                                    padding: '3px',
                                    color: rating <= photo.rating ? '#fbbf24' : '#9ca3af',
                                    transition: 'color 0.15s',
                                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
                                }}
                                title={`${rating} stars`}
                            >
                                <Star size={18} fill={rating <= photo.rating ? '#fbbf24' : 'none'} strokeWidth={2} />
                            </button>
                        ))}
                    </div>

                    {/* Color labels and reject button */}
                    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '3px' }}>
                        {colorLabels.map((label) => (
                            <button
                                key={label.value}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onColorChange?.(label.value);
                                }}
                                style={{
                                    width: 14,
                                    height: 14,
                                    borderRadius: '50%',
                                    border: photo.color_label === label.value ? '2px solid white' : '1px solid #444',
                                    backgroundColor: label.color,
                                    cursor: 'pointer',
                                    padding: 0,
                                }}
                                title={label.value}
                            />
                        ))}
                        <div style={{ width: 8 }} />
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                onReject?.();
                            }}
                            style={{
                                background: photo.flag === 'rejected' ? '#ef4444' : 'rgba(255,255,255,0.1)',
                                border: 'none',
                                cursor: 'pointer',
                                padding: '2px 4px',
                                borderRadius: '3px',
                                color: photo.flag === 'rejected' ? 'white' : '#888',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                            title="Reject (X)"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}, (prev, next) =>
    prev.photo.id === next.photo.id &&
    prev.photo.rating === next.photo.rating &&
    prev.photo.color_label === next.photo.color_label &&
    prev.photo.flag === next.photo.flag &&
    prev.photo.thumbnail_path === next.photo.thumbnail_path &&
    prev.photo.file_type === next.photo.file_type &&
    prev.photo.edit_copy_path === next.photo.edit_copy_path &&
    prev.photo.blur_hash === next.photo.blur_hash &&
    prev.isSelected === next.isSelected &&
    prev.size === next.size &&
    prev.inSurveyMode === next.inSurveyMode
);

PhotoCell.displayName = 'PhotoCell';

// Context Menu Component
const ContextMenu: React.FC<{
    x: number;
    y: number;
    photo: Photo;
    editors: { id: string; name: string }[];
    onClose: () => void;
    onEditIn: (editorId: string) => void;
    onLinkEditedFile: () => void;
    onGoToFolder: () => void;
    onShowInFinder: () => void;
}> = ({ x, y, photo, editors, onClose, onEditIn, onLinkEditedFile, onGoToFolder, onShowInFinder }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleEsc);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleEsc);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            className="fixed z-50 bg-[#2a2a2a] border border-[#444] rounded shadow-xl py-1 min-w-[180px]"
            style={{ left: x, top: y }}
        >
            <div className="px-3 py-1 text-xs text-gray-500 border-b border-[#444]">
                {photo.file_name}
            </div>
            {editors.length > 0 ? (
                <>
                    <div className="px-3 py-1 text-xs text-gray-500 mt-1">Edit in...</div>
                    {editors.map((editor) => (
                        <button
                            key={editor.id}
                            className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-blue-600 hover:text-white"
                            onClick={() => onEditIn(editor.id)}
                        >
                            {editor.name}
                        </button>
                    ))}
                </>
            ) : (
                <div className="px-3 py-2 text-sm text-gray-500">No editor available</div>
            )}
            <div className="border-t border-[#444] mt-1 pt-1">
                <button
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-blue-600 hover:text-white"
                    onClick={onLinkEditedFile}
                >
                    📎 Link edited file...
                </button>
                <button
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-blue-600 hover:text-white"
                    onClick={onGoToFolder}
                >
                    📁 Go to folder
                </button>
                <button
                    className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-blue-600 hover:text-white"
                    onClick={onShowInFinder}
                >
                    📂 Show in Finder
                </button>
            </div>
        </div>
    );
};

// Main PhotoGrid component
export const PhotoGrid: React.FC = React.memo(() => {
    const totalPhotoCount = useCatalogStore((s) => s.totalPhotoCount);
    const gridSize = useCatalogStore((s) => s.gridSize);
    const filters = useCatalogStore((s) => s.filters);
    const activeCollectionId = useCatalogStore((s) => s.activeCollectionId);
    const activeFolderId = useCatalogStore((s) => s.activeFolderId);
    const storePhotos = useCatalogStore((s) => s.photos);
    const setPhotos = useCatalogStore((s) => s.setPhotos);
    const viewMode = useCatalogStore((s) => s.viewMode);
    const inSurveyMode = viewMode === 'survey';

    // Use store photos directly - no local state duplication
    const photos = storePhotos;

    // Use store selectedPhotoIds directly (no duplicated local state)
    const selectedIds = useCatalogStore((s) => s.selectedPhotoIds);
    const setSelectedPhotoIds = useCatalogStore((s) => s.setSelectedPhotoIds);
    const [containerWidth, setContainerWidth] = useState(0);
    const [contextMenu, setContextMenu] = useState<ContextMenuState>({ visible: false, x: 0, y: 0, photo: null });
    const [availableEditors, setAvailableEditors] = useState<{ id: string; name: string }[]>([]);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [showRejectedMode, setShowRejectedMode] = useState(false);
    const [photosToDelete, setPhotosToDelete] = useState<Photo[]>([]);
    const loadingRef = useRef(false);
    const parentRef = useRef<HTMLDivElement>(null);
    const removePhotos = useCatalogStore((s) => s.removePhotos);
    const setTotalPhotoCount = useCatalogStore((s) => s.setTotalPhotoCount);

    // Load available editors on mount
    useEffect(() => {
        window.api.getAvailableEditors().then((editors: any[]) => {
            setAvailableEditors(editors.map(e => ({ id: e.id, name: e.name })));
        }).catch(console.error);
    }, []);

    const cellSize = gridSize + 4;
    // Ensure we have a valid width - use window width as fallback
    const effectiveWidth = containerWidth > 0 ? containerWidth : (typeof window !== 'undefined' ? window.innerWidth - 300 : 800);
    const columnCount = Math.max(1, Math.floor(effectiveWidth / cellSize));
    const rowCount = Math.ceil(photos.length / columnCount);

    // Virtual rows (overscan 8 for smoother scroll - was 3)
    const rowVirtualizer = useVirtualizer({
        count: rowCount,
        getScrollElement: () => parentRef.current,
        estimateSize: () => cellSize,
        overscan: 8,
    });

    const virtualItems = rowVirtualizer.getVirtualItems();
    const firstVisibleRow = virtualItems.length ? virtualItems[0].index : 0;
    const lastVisibleRow = virtualItems.length ? virtualItems[virtualItems.length - 1].index : 0;

    // Load photos - only when NOT browsing a folder (folders load via FolderTree)
    const loadPhotos = useCallback(async () => {
        // Skip if a folder is selected - FolderTree handles that
        if (activeFolderId) return;
        if (loadingRef.current) return;
        loadingRef.current = true;

        try {
            // Load the whole library (no 1000-row cap). react-virtual only renders
            // the visible rows, so a 20k+ photo array is fine; the cap was silently
            // truncating large catalogs. LOAD_ALL is a sentinel "all rows" limit.
            const LOAD_ALL = 1_000_000;
            let data: Photo[];
            if (activeCollectionId) {
                data = await window.api.getCollectionPhotos(activeCollectionId);
            } else if (Object.keys(filters).length > 0) {
                data = await window.api.searchPhotos(filters, LOAD_ALL, 0);
            } else {
                data = await window.api.getPhotos(LOAD_ALL, 0);
            }
            setPhotos(data);
        } catch (e) {
            console.error('Failed to load photos:', e);
        }
        loadingRef.current = false;
    }, [filters, activeCollectionId, activeFolderId, setPhotos]);

    // Initial load - only when no folder is selected
    useEffect(() => {
        if (!activeFolderId) {
            loadPhotos();
        }
    }, [loadPhotos, activeFolderId]);

    // Listen for photos:refresh to update thumbnails during processing.
    // During import/AI tagging the main process fires this every ~50 thumbnails,
    // and each call re-fetches up to 1000 rows + replaces the whole array. Throttle
    // so a burst collapses to at most one reload per REFRESH_INTERVAL, with a
    // trailing reload so the final state isn't missed.
    const lastRefreshRef = useRef(0);
    const refreshTimerRef = useRef<number | null>(null);
    useEffect(() => {
        const REFRESH_INTERVAL = 2500;
        const run = () => { if (!activeFolderId) loadPhotos(); };
        const unsubscribe = window.api.onPhotosRefresh(() => {
            const now = Date.now();
            const elapsed = now - lastRefreshRef.current;
            if (elapsed >= REFRESH_INTERVAL) {
                lastRefreshRef.current = now;
                run();
            } else if (refreshTimerRef.current === null) {
                refreshTimerRef.current = window.setTimeout(() => {
                    refreshTimerRef.current = null;
                    lastRefreshRef.current = Date.now();
                    run();
                }, REFRESH_INTERVAL - elapsed);
            }
        });
        return () => {
            unsubscribe();
            if (refreshTimerRef.current !== null) {
                clearTimeout(refreshTimerRef.current);
                refreshTimerRef.current = null;
            }
        };
    }, [loadPhotos, activeFolderId]);

    // Directional thumbnail prefetch: warm the local-image cache for rows just
    // beyond the visible+overscan window in the scroll direction, so fast scroll
    // shows decoded images instead of spinners. Reuses the same local-image:// URL
    // (now served async/streamed by the main process) — no extra DB work.
    const prefetchedRef = useRef<Set<string>>(new Set());
    const lastScrollTopRef = useRef(0);
    // Forget what we prefetched when the dataset itself changes.
    useEffect(() => { prefetchedRef.current.clear(); }, [photos]);
    useEffect(() => {
        const PREFETCH_ROWS = 6;
        const scrollEl = parentRef.current;
        const goingDown = scrollEl ? scrollEl.scrollTop >= lastScrollTopRef.current : true;
        if (scrollEl) lastScrollTopRef.current = scrollEl.scrollTop;

        const startRow = goingDown ? lastVisibleRow + 1 : Math.max(0, firstVisibleRow - PREFETCH_ROWS);
        const endRow = goingDown ? lastVisibleRow + PREFETCH_ROWS : firstVisibleRow - 1;

        for (let r = startRow; r <= endRow; r++) {
            for (let c = 0; c < columnCount; c++) {
                const idx = r * columnCount + c;
                if (idx < 0 || idx >= photos.length) continue;
                const p = photos[idx];
                if (!p.thumbnail_path || prefetchedRef.current.has(p.id)) continue;
                prefetchedRef.current.add(p.id);
                const img = new Image();
                img.decoding = 'async';
                img.src = getThumbnailUrl(p);
            }
        }
    }, [firstVisibleRow, lastVisibleRow, columnCount, photos]);

    // Selection changes are now read directly from the store (no duplicated subscribe)

    // Track container size - ResizeObserver only (removed setTimeout fallbacks)
    useEffect(() => {
        const container = parentRef.current;
        if (!container) return;

        const observer = new ResizeObserver((entries) => {
            const entry = entries[0];
            if (entry) {
                const width = entry.contentRect.width;
                if (width > 0) {
                    setContainerWidth(width);
                }
            }
        });

        observer.observe(container);

        return () => observer.disconnect();
    }, []);

    // Handle photo click
    const handlePhotoClick = useCallback((e: React.MouseEvent, photo: Photo) => {
        getStore().selectPhoto(photo.id, e.metaKey || e.ctrlKey, e.shiftKey);
    }, []);

    // Handle double-click - save navigation state then switch to loupe
    const handlePhotoDblClick = useCallback((photo: Photo) => {
        console.log('[PhotoGrid] Double-click on photo:', photo.id, photo.file_name);
        const { setActivePhotoId, setViewMode, pushNavigation } = getStore();
        // Save current state before navigating
        pushNavigation();
        setActivePhotoId(photo.id);
        setViewMode('loupe');
        console.log('[PhotoGrid] Set viewMode to loupe');
    }, []);

    // Handle context menu (right-click)
    const handleContextMenu = useCallback((e: React.MouseEvent, photo: Photo) => {
        e.preventDefault();
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            photo
        });
    }, []);

    // Close context menu
    const closeContextMenu = useCallback(() => {
        setContextMenu({ visible: false, x: 0, y: 0, photo: null });
    }, []);

    // State for save path notification
    const [savePathNotification, setSavePathNotification] = useState<{ show: boolean; path: string }>({ show: false, path: '' });

    // Handle edit in external editor
    const handleEditIn = useCallback(async (editorId: string) => {
        if (!contextMenu.photo) return;
        try {
            const result = await window.api.openInEditor(contextMenu.photo.file_path, contextMenu.photo.id, editorId);
            if (result && result.editCopyPath) {
                // Get the folder path
                const folderPath = result.editCopyPath.substring(0, result.editCopyPath.lastIndexOf('/'));
                // Copy to clipboard
                navigator.clipboard.writeText(folderPath);
                // Show notification
                setSavePathNotification({ show: true, path: folderPath });
                // Hide after 8 seconds
                setTimeout(() => setSavePathNotification({ show: false, path: '' }), 8000);
            }
        } catch (error) {
            console.error('Failed to open in editor:', error);
        }
        closeContextMenu();
    }, [contextMenu.photo, closeContextMenu]);

    const updatePhoto = useCatalogStore((s) => s.updatePhoto);

    // Handle link edited file
    const handleLinkEditedFile = useCallback(async () => {
        if (!contextMenu.photo) return;
        try {
            const result = await window.api.linkEditedFile(contextMenu.photo.id);
            if (result && result.editCopyPath) {
                // Update the photo in the store (only edit_copy_path, keep original thumbnail)
                updatePhoto(contextMenu.photo.id, {
                    edit_copy_path: result.editCopyPath
                });
            }
        } catch (error) {
            console.error('Failed to link edited file:', error);
        }
        closeContextMenu();
    }, [contextMenu.photo, closeContextMenu, updatePhoto]);

    // Handle show in Finder
    const handleShowInFinder = useCallback(async () => {
        if (!contextMenu.photo) return;
        try {
            await window.api.showInFolder(contextMenu.photo.file_path);
        } catch (error) {
            console.error('Failed to show in Finder:', error);
        }
        closeContextMenu();
    }, [contextMenu.photo, closeContextMenu]);

    const setActiveFolderId = useCatalogStore((s) => s.setActiveFolderId);

    // Handle go to folder in app
    const handleGoToFolder = useCallback(async () => {
        if (!contextMenu.photo) return;
        // Get the directory of the photo
        const photoDir = contextMenu.photo.file_path.substring(0, contextMenu.photo.file_path.lastIndexOf('/'));

        // Set the folder as active (use path as ID)
        setActiveFolderId(photoDir);

        // Load photos from that folder
        try {
            const folderPhotos = await window.api.getPhotosInFolder(photoDir);
            setPhotos(folderPhotos);
        } catch (error) {
            console.error('Failed to load folder photos:', error);
        }

        closeContextMenu();
    }, [contextMenu.photo, setActiveFolderId, setPhotos, closeContextMenu]);

    // Delete handlers - use photosToDelete which may be selected photos or rejected photos
    const handleDeletePermanently = useCallback(async () => {
        const ids = photosToDelete.map(p => p.id);
        if (ids.length === 0) return;

        try {
            await window.api.deletePhotos(ids, true); // true = delete from disk
            removePhotos(ids);
            const newCount = await window.api.getPhotoCount();
            setTotalPhotoCount(newCount);
        } catch (error) {
            console.error('Failed to delete photos:', error);
        }
        setDeleteDialogOpen(false);
        setPhotosToDelete([]);
        setShowRejectedMode(false);
    }, [photosToDelete, removePhotos, setTotalPhotoCount]);

    const handleHideFromLibrary = useCallback(async () => {
        const ids = photosToDelete.map(p => p.id);
        if (ids.length === 0) return;

        try {
            await window.api.deletePhotos(ids, false); // false = keep files on disk
            removePhotos(ids);
            const newCount = await window.api.getPhotoCount();
            setTotalPhotoCount(newCount);
        } catch (error) {
            console.error('Failed to hide photos:', error);
        }
        setDeleteDialogOpen(false);
        setPhotosToDelete([]);
        setShowRejectedMode(false);
    }, [photosToDelete, removePhotos, setTotalPhotoCount]);

    const handleCloseDeleteDialog = useCallback(() => {
        setDeleteDialogOpen(false);
        setPhotosToDelete([]);
        setShowRejectedMode(false);
    }, []);

    // Keyboard listener for Delete key
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }
            if ((e.key === 'Delete' || e.key === 'Backspace')) {
                e.preventDefault();

                // Shift+Delete: Show all rejected photos in current folder
                if (e.shiftKey) {
                    const rejectedPhotos = photos.filter(p => p.flag === 'rejected');
                    if (rejectedPhotos.length > 0) {
                        setPhotosToDelete(rejectedPhotos);
                        setShowRejectedMode(true);
                        setDeleteDialogOpen(true);
                    }
                }
                // Normal Delete: Show selected photos
                else if (selectedIds.size > 0) {
                    const selectedPhotos = photos.filter(p => selectedIds.has(p.id));
                    setPhotosToDelete(selectedPhotos);
                    setShowRejectedMode(false);
                    setDeleteDialogOpen(true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIds, photos]);

    // Rotation handlers
    const handleRotate = useCallback(async (direction: 'cw' | 'ccw') => {
        const ids = [...selectedIds];
        if (ids.length === 0) return;

        try {
            await window.api.rotatePhotos(ids, direction);
        } catch (error) {
            console.error('Failed to rotate photos:', error);
        }
    }, [selectedIds]);

    // Survey mode handlers
    const handleSurveyRating = useCallback(async (photoId: string, rating: number) => {
        try {
            await window.api.bulkUpdateRating([photoId], rating);
            updatePhoto(photoId, { rating });
        } catch (error) {
            console.error('Failed to update rating:', error);
        }
    }, [updatePhoto]);

    const handleSurveyColor = useCallback(async (photoId: string, color: string) => {
        try {
            await window.api.bulkUpdateColorLabel([photoId], color);
            updatePhoto(photoId, { color_label: color as any });
        } catch (error) {
            console.error('Failed to update color:', error);
        }
    }, [updatePhoto]);

    const handleSurveyReject = useCallback(async (photoId: string, currentFlag: string) => {
        const newFlag = currentFlag === 'rejected' ? 'none' : 'rejected';
        try {
            await window.api.bulkUpdateFlag([photoId], newFlag);
            updatePhoto(photoId, { flag: newFlag as any });
        } catch (error) {
            console.error('Failed to update flag:', error);
        }
    }, [updatePhoto]);

    // Zoom handlers
    const handleZoomOut = useCallback(() => {
        getStore().setGridSize(Math.max(80, gridSize - 50));
    }, [gridSize]);

    const handleZoomIn = useCallback(() => {
        getStore().setGridSize(Math.min(400, gridSize + 50));
    }, [gridSize]);

    const handleZoomChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        getStore().setGridSize(parseInt(e.target.value));
    }, []);

    if (totalPhotoCount === 0) {
        return (
            <div className="flex-1 flex items-center justify-center text-gray-500">
                No photos. Import to get started.
            </div>
        );
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-[#0a0a0a]">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#111] border-b border-[#333]">
                {/* Left side - Selection actions */}
                <div className="flex items-center gap-1">
                    {selectedIds.size > 0 && (
                        <>
                            <span className="text-xs text-blue-400 mr-1">
                                {selectedIds.size} selected
                            </span>
                            <button
                                onClick={() => setSelectedPhotoIds(new Set())}
                                className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded mr-1"
                                title="Deselect all"
                            >
                                <X size={14} />
                            </button>
                            <button
                                onClick={() => handleRotate('ccw')}
                                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                                title="Rotate left"
                            >
                                <RotateCcw size={16} />
                            </button>
                            <button
                                onClick={() => handleRotate('cw')}
                                className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                                title="Rotate right"
                            >
                                <RotateCw size={16} />
                            </button>
                            <div className="w-px h-4 bg-gray-600 mx-1" />
                            <button
                                onClick={() => {
                                    const selectedPhotos = photos.filter(p => selectedIds.has(p.id));
                                    setPhotosToDelete(selectedPhotos);
                                    setShowRejectedMode(false);
                                    setDeleteDialogOpen(true);
                                }}
                                className="p-1.5 text-gray-400 hover:text-red-400 hover:bg-gray-700 rounded"
                                title="Delete"
                            >
                                <Trash2 size={16} />
                            </button>
                        </>
                    )}
                </div>

                {/* Center - Zoom controls */}
                <div className="flex items-center gap-2">
                    <button onClick={handleZoomOut} className="p-1 text-gray-400 hover:text-white">
                        <Minus size={14} />
                    </button>
                    <input
                        type="range"
                        min="80"
                        max="400"
                        step="40"
                        value={gridSize}
                        onChange={handleZoomChange}
                        className="w-24"
                    />
                    <button onClick={handleZoomIn} className="p-1 text-gray-400 hover:text-white">
                        <Plus size={14} />
                    </button>
                </div>

                {/* Right side - Count */}
                <span className="text-xs text-gray-500">
                    {photos.length} / {totalPhotoCount}
                </span>
            </div>

            {/* Virtualized Grid */}
            <div
                ref={parentRef}
                className="flex-1 overflow-auto"
            >
                <div
                    style={{
                        height: `${rowVirtualizer.getTotalSize()}px`,
                        width: '100%',
                        position: 'relative',
                    }}
                >
                    {virtualItems.map((virtualRow) => {
                        const startIndex = virtualRow.index * columnCount;

                        return (
                            <div
                                key={virtualRow.key}
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: `${virtualRow.size}px`,
                                    transform: `translateY(${virtualRow.start}px)`,
                                    display: 'grid',
                                    gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                                    gap: 4,
                                    paddingLeft: 4,
                                    paddingRight: 4,
                                }}
                            >
                                {Array.from({ length: columnCount }).map((_, colIndex) => {
                                    const photoIndex = startIndex + colIndex;
                                    if (photoIndex >= photos.length) {
                                        return <div key={`empty-${colIndex}`} />;
                                    }

                                    const photo = photos[photoIndex];
                                    return (
                                        <div key={photo.id} style={{ aspectRatio: '1' }}>
                                            <PhotoCell
                                                photo={photo}
                                                isSelected={selectedIds.has(photo.id)}
                                                size={cellSize - 4}
                                                inSurveyMode={inSurveyMode}
                                                onClick={(e) => handlePhotoClick(e, photo)}
                                                onDblClick={() => handlePhotoDblClick(photo)}
                                                onContextMenu={handleContextMenu}
                                                onRatingChange={(rating) => handleSurveyRating(photo.id, rating)}
                                                onColorChange={(color) => handleSurveyColor(photo.id, color)}
                                                onReject={() => handleSurveyReject(photo.id, photo.flag)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Context Menu */}
            {contextMenu.visible && contextMenu.photo && (
                <ContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    photo={contextMenu.photo}
                    editors={availableEditors}
                    onClose={closeContextMenu}
                    onEditIn={handleEditIn}
                    onLinkEditedFile={handleLinkEditedFile}
                    onGoToFolder={handleGoToFolder}
                    onShowInFinder={handleShowInFinder}
                />
            )}

            {/* Save Path Notification */}
            {savePathNotification.show && (
                <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white px-6 py-4 rounded-lg shadow-2xl max-w-2xl">
                    <div className="flex items-start gap-3">
                        <div className="text-2xl">📁</div>
                        <div className="flex-1">
                            <p className="font-medium mb-1">Save in Affinity</p>
                            <p className="text-sm text-blue-100 mb-2">
                                When saving in Affinity, use this folder:
                            </p>
                            <code className="block bg-blue-800 px-3 py-2 rounded text-xs break-all">
                                {savePathNotification.path}
                            </code>
                            <p className="text-xs text-blue-200 mt-2">
                                ✓ Path copied to clipboard (Cmd+V to paste)
                            </p>
                        </div>
                        <button
                            onClick={() => setSavePathNotification({ show: false, path: '' })}
                            className="text-blue-200 hover:text-white"
                        >
                            ✕
                        </button>
                    </div>
                </div>
            )}

            {/* Delete Dialog */}
            <DeleteDialog
                isOpen={deleteDialogOpen}
                photoCount={photosToDelete.length}
                photos={photosToDelete}
                showRejectedMode={showRejectedMode}
                onClose={handleCloseDeleteDialog}
                onDeletePermanently={handleDeletePermanently}
                onHideFromLibrary={handleHideFromLibrary}
            />
        </div>
    );
});

PhotoGrid.displayName = 'PhotoGrid';

export default PhotoGrid;
