import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import {
    ChevronLeft,
    ChevronRight,
    ZoomIn,
    ZoomOut,
    Star,
    Check,
    X,
    ArrowLeft
} from 'lucide-react';
import { getPreviewUrl, getThumbnailUrl } from '../utils/imageUrl';

export const LoupeView: React.FC = () => {
    // All store selectors at the top
    const photos = useCatalogStore((s) => s.photos);
    const activePhotoId = useCatalogStore((s) => s.activePhotoId);
    const setActivePhotoId = useCatalogStore((s) => s.setActivePhotoId);
    const updatePhoto = useCatalogStore((s) => s.updatePhoto);
    const setViewMode = useCatalogStore((s) => s.setViewMode);
    const goBack = useCatalogStore((s) => s.goBack);
    const pushNavigation = useCatalogStore((s) => s.pushNavigation);
    const addEditHistory = useCatalogStore((s) => s.addEditHistory);
    const devSettings = useCatalogStore((s) => s.developmentSettings);

    // All state hooks
    const [zoom, setZoom] = useState(1);
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [imageOffset, setImageOffset] = useState({ x: 0, y: 0 });
    const [isLoading, setIsLoading] = useState(true);
    const [imageError, setImageError] = useState<string | null>(null);
    const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
    const [filmstripHeight, setFilmstripHeight] = useState(() => {
        const saved = localStorage.getItem('filmstripHeight');
        const height = saved ? parseInt(saved, 10) : 150;
        // Force minimum height of 130px for good visibility
        const minHeight = 130;
        if (height < minHeight) {
            localStorage.setItem('filmstripHeight', minHeight.toString());
            return minHeight;
        }
        return height;
    });
    const [isResizingFilmstrip, setIsResizingFilmstrip] = useState(false);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // All refs
    const imageRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    // Compute CSS filter from development settings
    const imageFilter = useMemo(() => {
        const filters: string[] = [];

        // Exposure: maps to brightness (0 = 100%, -100 = 0%, +100 = 200%)
        if (devSettings.exposure !== 0) {
            const brightness = 100 + devSettings.exposure;
            filters.push(`brightness(${brightness}%)`);
        }

        // Contrast: maps to contrast (0 = 100%, -100 = 0%, +100 = 200%)
        if (devSettings.contrast !== 0) {
            const contrast = 100 + devSettings.contrast;
            filters.push(`contrast(${contrast}%)`);
        }

        // Saturation: maps to saturate (0 = 100%, -100 = 0%, +100 = 200%)
        if (devSettings.saturation !== 0) {
            const saturate = 100 + devSettings.saturation;
            filters.push(`saturate(${saturate}%)`);
        }

        // Vibrance: similar to saturation but less aggressive
        if (devSettings.vibrance !== 0) {
            const saturate = 100 + (devSettings.vibrance * 0.5);
            filters.push(`saturate(${saturate}%)`);
        }

        // Temperature: maps to sepia for warm or hue-rotate for cool
        if (devSettings.temperature !== 0) {
            if (devSettings.temperature > 0) {
                // Warm (orange/yellow) - use sepia
                const sepia = devSettings.temperature * 0.3;
                filters.push(`sepia(${sepia}%)`);
            } else {
                // Cool (blue) - use hue-rotate towards blue
                const hueRotate = devSettings.temperature * 0.5;
                filters.push(`hue-rotate(${hueRotate}deg)`);
            }
        }

        // Clarity: not directly available in CSS, approximate with contrast
        if (devSettings.clarity !== 0) {
            const contrast = 100 + (devSettings.clarity * 0.3);
            filters.push(`contrast(${contrast}%)`);
        }

        // Highlights and Shadows are complex - CSS can't do this well
        // We'll skip them or use a simple approximation

        return filters.length > 0 ? filters.join(' ') : 'none';
    }, [devSettings]);

    // Derived values (not hooks)
    const activePhoto = photos.find((p) => p.id === activePhotoId);
    const currentIndex = photos.findIndex((p) => p.id === activePhotoId);

    // Save filmstrip height to localStorage when it changes, enforce minimum
    useEffect(() => {
        const minHeight = 130;
        if (filmstripHeight < minHeight) {
            setFilmstripHeight(minHeight);
        } else {
            localStorage.setItem('filmstripHeight', filmstripHeight.toString());
        }
    }, [filmstripHeight]);

    // Reset zoom when changing photos
    useEffect(() => {
        setZoom(1);
        setImageOffset({ x: 0, y: 0 });
        setIsLoading(true);
        setImageError(null);
    }, [activePhotoId]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowLeft':
                    goToPrevious();
                    break;
                case 'ArrowRight':
                    goToNext();
                    break;
                case 'Escape':
                    // Try to go back in history, otherwise go to grid
                    if (!goBack()) {
                        setViewMode('grid');
                    }
                    break;
                case '+':
                case '=':
                    handleZoomIn();
                    break;
                case '-':
                    handleZoomOut();
                    break;
                case '0':
                    // Fit is Cmd/Ctrl+0. A bare 0 is the global "clear rating"
                    // shortcut — handling it here too meant one keypress both
                    // refit the view and silently wiped the photo's stars.
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        handleZoomFit();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [currentIndex, photos.length, goBack]);

    const goToPrevious = useCallback(() => {
        if (currentIndex > 0) {
            setActivePhotoId(photos[currentIndex - 1].id);
        }
    }, [currentIndex, photos, setActivePhotoId]);

    const goToNext = useCallback(() => {
        if (currentIndex < photos.length - 1) {
            setActivePhotoId(photos[currentIndex + 1].id);
        }
    }, [currentIndex, photos, setActivePhotoId]);

    const handleZoomIn = () => setZoom((z) => Math.min(z * 1.5, 8));
    const handleZoomOut = () => setZoom((z) => Math.max(z / 1.5, 0.1));
    const handleZoomFit = () => {
        setZoom(1);
        setImageOffset({ x: 0, y: 0 });
    };

    const handleWheel = (e: React.WheelEvent) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoom((z) => Math.max(0.1, Math.min(8, z * delta)));
        }
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button === 0) { // Left click only
            setIsDragging(true);
            setDragStart({ x: e.clientX - imageOffset.x, y: e.clientY - imageOffset.y });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isDragging) {
            setImageOffset({
                x: e.clientX - dragStart.x,
                y: e.clientY - dragStart.y
            });
        }
    };

    const handleMouseUp = () => {
        setIsDragging(false);
    };

    // Global mouse events for filmstrip resize
    useEffect(() => {
        if (!isResizingFilmstrip) return;

        const handleGlobalMouseMove = (e: MouseEvent) => {
            // Calculate from bottom of window - min 130px for visible thumbnails
            const newHeight = Math.max(130, Math.min(400, window.innerHeight - e.clientY - 32));
            setFilmstripHeight(newHeight);
        };

        const handleGlobalMouseUp = () => {
            setIsResizingFilmstrip(false);
        };

        window.addEventListener('mousemove', handleGlobalMouseMove);
        window.addEventListener('mouseup', handleGlobalMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleGlobalMouseMove);
            window.removeEventListener('mouseup', handleGlobalMouseUp);
        };
    }, [isResizingFilmstrip]);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const handleOpenInAffinity = async () => {
        if (activePhoto) {
            await window.api.openInAffinityPhoto(activePhoto.file_path, activePhoto.id);
        }
        setContextMenu(null);
    };

    const handleFilmstripResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizingFilmstrip(true);
    };

    const handleRating = async (rating: number) => {
        if (activePhoto) {
            const previousRating = activePhoto.rating;
            const newRating = activePhoto.rating === rating ? 0 : rating;
            await window.api.updatePhoto(activePhoto.id, { rating: newRating });
            updatePhoto(activePhoto.id, { rating: newRating });
            addEditHistory(activePhoto.id, `Rating → ${newRating} ★`, previousRating, newRating);
        }
    };

    const handleFlag = async (flag: 'none' | 'picked' | 'rejected') => {
        if (activePhoto) {
            const previousFlag = activePhoto.flag;
            await window.api.updatePhoto(activePhoto.id, { flag });
            updatePhoto(activePhoto.id, { flag });
            const flagLabels = { none: 'None', picked: 'Picked ✓', rejected: 'Rejected ✗' };
            addEditHistory(activePhoto.id, `Flag → ${flagLabels[flag]}`, previousFlag, flag);
        }
    };

    if (!activePhoto) {
        console.log('[LoupeView] No active photo - photos count:', photos.length, 'activePhotoId:', activePhotoId);
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-900 text-gray-400">
                <div className="text-center">
                    <p className="text-lg mb-2">No photo selected</p>
                    <p className="text-xs text-gray-600">Photos: {photos.length} | ID: {activePhotoId || 'null'}</p>
                </div>
            </div>
        );
    }

    const imageSrc = getPreviewUrl(activePhoto);
    console.log('[LoupeView] Rendering with:', {
        photoId: activePhoto.id,
        fileName: activePhoto.file_name,
        imageSrc,
        zoom,
        isLoading
    });

    return (
        <div className="flex-1 flex flex-col bg-black">
            {/* Top Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 bg-[#111] border-b border-[#333]">
                {/* Left - Back and Photo info */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            if (!goBack()) {
                                setViewMode('grid');
                            }
                        }}
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                        title="Back (Escape)"
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <p className="text-white text-sm font-medium">{activePhoto.file_name}</p>
                        <p className="text-gray-500 text-xs">
                            {currentIndex + 1} / {photos.length}
                            {activePhoto.is_raw && <span className="ml-2 text-orange-400">RAW</span>}
                        </p>
                    </div>
                </div>

                {/* Center - Zoom controls */}
                <div className="flex items-center gap-2">
                    <button onClick={handleZoomOut} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                        <ZoomOut size={18} />
                    </button>
                    <button
                        onClick={handleZoomFit}
                        className={`px-2 py-1 text-sm rounded ${zoom === 1 ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                        title="Fit to screen (⌘0)"
                    >
                        FIT
                    </button>
                    <span className="text-gray-400 text-sm min-w-[50px] text-center">
                        {Math.round(zoom * 100)}%
                    </span>
                    <button onClick={handleZoomIn} className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                        <ZoomIn size={18} />
                    </button>
                    <button
                        onClick={() => setZoom(1)}
                        className={`px-2 py-1 text-sm rounded ${zoom === 1 ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
                        title="100% (1:1)"
                    >
                        1:1
                    </button>
                </div>

                {/* Right - Rating, flags, and sidebar toggles */}
                <div className="flex items-center gap-2">
                    {/* Rating */}
                    <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                onClick={() => handleRating(star)}
                                className="p-0.5"
                            >
                                <Star
                                    size={16}
                                    className={`${
                                        star <= activePhoto.rating
                                            ? 'fill-yellow-400 text-yellow-400'
                                            : 'text-gray-500 hover:text-yellow-400'
                                    }`}
                                />
                            </button>
                        ))}
                    </div>
                    <div className="w-px h-4 bg-gray-600" />
                    {/* Flags */}
                    <button
                        onClick={() => handleFlag(activePhoto.flag === 'picked' ? 'none' : 'picked')}
                        className={`p-1 rounded ${
                            activePhoto.flag === 'picked' ? 'bg-green-600 text-white' : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <Check size={16} />
                    </button>
                    <button
                        onClick={() => handleFlag(activePhoto.flag === 'rejected' ? 'none' : 'rejected')}
                        className={`p-1 rounded ${
                            activePhoto.flag === 'rejected' ? 'bg-red-600 text-white' : 'text-gray-400 hover:text-white'
                        }`}
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Image container */}
            <div
                ref={containerRef}
                className="flex-1 relative overflow-hidden flex items-center justify-center"
                onWheel={handleWheel}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onContextMenu={handleContextMenu}
                style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
            >
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-2 border-gray-600 border-t-white" />
                    </div>
                )}
                {imageError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80">
                        <div className="text-center text-red-400 p-4">
                            <p className="text-lg mb-2">Image not loaded</p>
                            <p className="text-xs text-gray-500 max-w-md break-all">{imageError}</p>
                        </div>
                    </div>
                )}
                <img
                    ref={imageRef}
                    src={imageSrc}
                    alt={activePhoto.file_name}
                    className="select-none"
                    style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        width: 'auto',
                        height: 'auto',
                        objectFit: 'contain',
                        transform: `scale(${zoom}) translate(${imageOffset.x / zoom}px, ${imageOffset.y / zoom}px)`,
                        opacity: isLoading ? 0 : 1,
                        transition: isDragging ? 'none' : 'transform 0.1s ease-out, filter 0.15s ease-out',
                        filter: imageFilter,
                    }}
                    onLoad={(e) => {
                        const img = e.target as HTMLImageElement;
                        setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
                        setIsLoading(false);
                    }}
                    onError={(e) => {
                        console.error('Image failed to load:', imageSrc);
                        setIsLoading(false);
                        setImageError(`Failed to load: ${imageSrc}`);
                    }}
                    onDoubleClick={() => {
                        if (zoom === 1) {
                            setZoom(2);
                        } else {
                            setZoom(1);
                            setImageOffset({ x: 0, y: 0 });
                        }
                    }}
                    draggable={false}
                />

                {/* Navigation arrows */}
                <button
                    onClick={goToPrevious}
                    disabled={currentIndex === 0}
                    className="absolute left-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                >
                    <ChevronLeft size={24} />
                </button>
                <button
                    onClick={goToNext}
                    disabled={currentIndex === photos.length - 1}
                    className="absolute right-4 top-1/2 -translate-y-1/2 p-3 bg-black/50 hover:bg-black/70 rounded-full text-white disabled:opacity-30 disabled:cursor-not-allowed transition-opacity"
                >
                    <ChevronRight size={24} />
                </button>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-gray-800 border border-gray-600 rounded shadow-lg py-1"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={() => setContextMenu(null)}
                >
                    <button
                        onClick={handleOpenInAffinity}
                        className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700 flex items-center gap-2"
                    >
                        <span className="text-xs font-bold text-red-500">AFI</span>
                        Open in Affinity Photo
                    </button>
                    <button
                        onClick={() => {
                            if (activePhoto) window.api.showInFolder(activePhoto.file_path);
                            setContextMenu(null);
                        }}
                        className="w-full px-4 py-2 text-left text-sm text-white hover:bg-gray-700"
                    >
                        Show in Finder
                    </button>
                </div>
            )}

            {/* Click outside to close context menu */}
            {contextMenu && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setContextMenu(null)}
                />
            )}

            {/* Filmstrip resize handle */}
            <div
                className="h-3 bg-gray-800 hover:bg-white/15 cursor-ns-resize flex items-center justify-center transition-colors"
                onMouseDown={handleFilmstripResizeStart}
                style={{ borderTop: '1px solid #9a9aa2' }}
            >
                <div className="w-16 h-1 bg-gray-500 rounded hover:bg-white" />
            </div>

            {/* Filmstrip */}
            <div
                className="filmstrip"
                style={{ height: `${filmstripHeight}px` }}
            >
                {(() => {
                    // Calculate item size: filmstrip height - padding (16px)
                    const itemSize = Math.max(60, filmstripHeight - 16);
                    return photos.map((photo) => (
                        <button
                            key={photo.id}
                            onClick={() => setActivePhotoId(photo.id)}
                            className={`filmstrip-item ${photo.id === activePhotoId ? 'active' : ''}`}
                            style={{
                                width: `${itemSize}px`,
                                height: `${itemSize}px`,
                                minWidth: `${itemSize}px`,
                                minHeight: `${itemSize}px`
                            }}
                        >
                            <img
                                src={getThumbnailUrl(photo)}
                                alt={photo.file_name}
                                loading="lazy"
                            />
                        </button>
                    ));
                })()}
            </div>
        </div>
    );
};

export default LoupeView;
