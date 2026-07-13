import React, { useMemo, useRef, useEffect, useState } from 'react';
import { useCatalogStore, EditHistoryEntry } from '../stores/catalogStore';
import {
    History,
    Image,
    ChevronDown,
    ChevronRight,
    ArrowLeft,
    Trash2,
    Sliders
} from 'lucide-react';
import { getThumbnailUrl, getPreviewUrl } from '../utils/imageUrl';

interface SidebarSectionProps {
    title: string;
    icon: React.ReactNode;
    defaultOpen?: boolean;
    children: React.ReactNode;
    action?: React.ReactNode;
}

const SidebarSection: React.FC<SidebarSectionProps> = ({
    title,
    icon,
    defaultOpen = true,
    children,
    action
}) => {
    const [isOpen, setIsOpen] = React.useState(defaultOpen);

    return (
        <div className="mb-2">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium text-gray-400 hover:text-white hover:bg-gray-800 rounded transition-colors"
            >
                <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    {icon}
                    <span>{title}</span>
                </div>
                {action && (
                    <div onClick={(e) => e.stopPropagation()}>
                        {action}
                    </div>
                )}
            </button>
            {isOpen && (
                <div className="mt-1">
                    {children}
                </div>
            )}
        </div>
    );
};

// Format relative time
const formatRelativeTime = (date: Date): string => {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    return date.toLocaleDateString();
};

// Navigator component - simple thumbnail preview
interface NavigatorProps {
    activePhoto: any;
}

const Navigator: React.FC<NavigatorProps> = ({ activePhoto }) => {
    if (!activePhoto) {
        return (
            <div className="aspect-video bg-gray-800 rounded flex items-center justify-center text-gray-500 text-sm">
                No photo selected
            </div>
        );
    }

    return (
        <div className="relative bg-black rounded overflow-hidden" style={{ height: 120 }}>
            <img
                src={getThumbnailUrl(activePhoto)}
                alt="Navigator"
                className="w-full h-full object-contain"
            />
        </div>
    );
};

// Preset definitions
const presets = [
    { id: 'auto', name: 'Auto', category: 'Basic' },
    { id: 'vivid', name: 'Vivid', category: 'Basic' },
    { id: 'natural', name: 'Natural', category: 'Basic' },
    { id: 'flat', name: 'Flat', category: 'Basic' },
    { id: 'bw-classic', name: 'B&W Classic', category: 'Black & White' },
    { id: 'bw-high-contrast', name: 'B&W High Contrast', category: 'Black & White' },
    { id: 'vintage-warm', name: 'Vintage Warm', category: 'Creative' },
    { id: 'vintage-cool', name: 'Vintage Cool', category: 'Creative' },
    { id: 'cinematic', name: 'Cinematic', category: 'Creative' },
];

export const HistorySidebar: React.FC = React.memo(() => {
    const activePhotoId = useCatalogStore((s) => s.activePhotoId);
    const photos = useCatalogStore((s) => s.photos);
    const editHistory = useCatalogStore((s) => s.editHistory);
    const goBack = useCatalogStore((s) => s.goBack);
    const clearPhotoEditHistory = useCatalogStore((s) => s.clearPhotoEditHistory);
    const restoreFromHistory = useCatalogStore((s) => s.restoreFromHistory);
    const navigationHistory = useCatalogStore((s) => s.navigationHistory);

    const activePhoto = photos.find(p => p.id === activePhotoId);

    // Get history for current photo, sorted by timestamp (newest first)
    const photoHistory = useMemo(() => {
        if (!activePhotoId) return [];
        return editHistory
            .filter(e => e.photoId === activePhotoId)
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }, [editHistory, activePhotoId]);

    const handleClearHistory = () => {
        if (activePhotoId && confirm('Clear all history for this photo?')) {
            clearPhotoEditHistory(activePhotoId);
        }
    };

    return (
        <div className="w-64 bg-gray-900/55 backdrop-blur-2xl border-r border-white/10 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-3 border-b border-gray-700 flex items-center gap-2">
                <button
                    onClick={() => goBack()}
                    className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-800 rounded"
                    title="Back (Escape)"
                    disabled={navigationHistory.length === 0}
                >
                    <ArrowLeft size={16} />
                </button>
                <div className="flex-1">
                    <h1 className="text-sm font-bold text-white truncate">
                        {activePhoto?.file_name || 'No photo'}
                    </h1>
                    <p className="text-xs text-gray-500">Develop</p>
                </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto py-2">
                {/* Navigator - Photo Preview with viewport indicator */}
                <SidebarSection
                    title="Navigator"
                    icon={<Image size={16} />}
                >
                    <div className="px-3 py-2">
                        <Navigator activePhoto={activePhoto} />
                    </div>
                </SidebarSection>

                {/* Presets */}
                <SidebarSection
                    title="Presets"
                    icon={<Sliders size={16} />}
                >
                    <div className="px-2 space-y-0.5 max-h-48 overflow-y-auto">
                        {presets.map((preset) => (
                            <button
                                key={preset.id}
                                className="w-full text-left px-2 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white rounded transition-colors"
                                onClick={() => {
                                    // TODO: Apply preset
                                    console.log('Apply preset:', preset.id);
                                }}
                            >
                                {preset.name}
                            </button>
                        ))}
                    </div>
                </SidebarSection>

                {/* History Panel */}
                <SidebarSection
                    title="History"
                    icon={<History size={16} />}
                    action={
                        photoHistory.length > 0 ? (
                            <button
                                onClick={handleClearHistory}
                                className="p-1 text-gray-500 hover:text-red-400 rounded"
                                title="Clear history"
                            >
                                <Trash2 size={12} />
                            </button>
                        ) : undefined
                    }
                >
                    <div className="px-2">
                        {photoHistory.length === 0 ? (
                            <p className="px-2 py-3 text-xs text-gray-500 text-center">
                                No changes
                            </p>
                        ) : (
                            <div className="space-y-0.5">
                                {/* Current state indicator */}
                                <div className="px-2 py-1.5 text-xs bg-white/10 text-gray-200 rounded border border-white/20/30">
                                    Current state
                                </div>

                                {/* History entries */}
                                {photoHistory.map((entry, index) => (
                                    <div
                                        key={entry.id}
                                        className={`px-2 py-1.5 text-xs text-gray-300 hover:bg-gray-700 rounded cursor-pointer group transition-colors ${entry.devSettingsSnapshot ? 'border-l-2 border-transparent hover:border-white/25' : ''}`}
                                        title={`${entry.action}\n${new Date(entry.timestamp).toLocaleString()}${entry.devSettingsSnapshot ? '\nClick to restore' : ''}`}
                                        onClick={() => {
                                            if (entry.devSettingsSnapshot) {
                                                restoreFromHistory(entry);
                                            }
                                        }}
                                    >
                                        <div className="flex items-center justify-between">
                                            <span className="truncate flex-1">{entry.action}</span>
                                            <span className="text-gray-500 text-[10px] ml-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {entry.devSettingsSnapshot ? '↩' : ''} {formatRelativeTime(new Date(entry.timestamp))}
                                            </span>
                                        </div>
                                    </div>
                                ))}

                                {/* Import indicator */}
                                <div className="px-2 py-1.5 text-xs text-gray-500 rounded border-t border-gray-700 mt-2 pt-2">
                                    Import
                                </div>
                            </div>
                        )}
                    </div>
                </SidebarSection>

                {/* Photo Info */}
                {activePhoto && (
                    <SidebarSection
                        title="Info"
                        icon={<Image size={16} />}
                        defaultOpen={false}
                    >
                        <div className="px-3 space-y-1 text-xs text-gray-400">
                            <div className="flex justify-between">
                                <span>Dimensions</span>
                                <span className="text-gray-300">
                                    {activePhoto.width || '?'} × {activePhoto.height || '?'}
                                </span>
                            </div>
                            {activePhoto.camera_model && (
                                <div className="flex justify-between">
                                    <span>Camera</span>
                                    <span className="text-gray-300 truncate ml-2">
                                        {activePhoto.camera_model}
                                    </span>
                                </div>
                            )}
                            {activePhoto.focal_length && (
                                <div className="flex justify-between">
                                    <span>Focal</span>
                                    <span className="text-gray-300">{activePhoto.focal_length}mm</span>
                                </div>
                            )}
                            {activePhoto.aperture && (
                                <div className="flex justify-between">
                                    <span>Aperture</span>
                                    <span className="text-gray-300">f/{activePhoto.aperture}</span>
                                </div>
                            )}
                            {activePhoto.shutter_speed && (
                                <div className="flex justify-between">
                                    <span>Shutter</span>
                                    <span className="text-gray-300">{activePhoto.shutter_speed}</span>
                                </div>
                            )}
                            {activePhoto.iso && (
                                <div className="flex justify-between">
                                    <span>ISO</span>
                                    <span className="text-gray-300">{activePhoto.iso}</span>
                                </div>
                            )}
                            {activePhoto.edit_copy_path && (
                                <div className="mt-2 pt-2 border-t border-gray-700">
                                    <span className="text-orange-400">Has external edit</span>
                                </div>
                            )}
                        </div>
                    </SidebarSection>
                )}
            </div>
        </div>
    );
});

HistorySidebar.displayName = 'HistorySidebar';

export default HistorySidebar;
