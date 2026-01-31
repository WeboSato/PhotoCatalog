import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import { format } from 'date-fns';
import {
    Camera,
    Aperture,
    Clock,
    Sun,
    MapPin,
    FileImage,
    Tag,
    Star,
    Calendar,
    HardDrive,
    Ruler,
    Info,
    Edit3,
    X,
    Plus,
    BarChart3,
    Contrast,
    Droplets
} from 'lucide-react';
import { getThumbnailUrl, getPreviewUrl } from '../utils/imageUrl';

interface MetadataRowProps {
    icon?: React.ReactNode;
    label: string;
    value: string | number | undefined | null;
}

const MetadataRow: React.FC<MetadataRowProps> = ({ icon, label, value }) => {
    if (value === undefined || value === null || value === '') return null;

    return (
        <div className="flex items-start gap-2 py-1">
            {icon && <div className="text-gray-500 mt-0.5">{icon}</div>}
            <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-500">{label}</p>
                <p className="text-sm text-gray-200 truncate">{String(value)}</p>
            </div>
        </div>
    );
};

// Keywords editor component with XMP support
interface KeywordsEditorProps {
    photoId: string;
    filePath: string;
    keywords: any[];
    onKeywordsChange: (keywords: any[]) => void;
}

const KeywordsEditor: React.FC<KeywordsEditorProps> = ({ photoId, filePath, keywords, onKeywordsChange }) => {
    const [isAdding, setIsAdding] = useState(false);
    const [newKeyword, setNewKeyword] = useState('');
    const [allKeywords, setAllKeywords] = useState<any[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);

    // Load all available keywords for suggestions
    useEffect(() => {
        window.api.getKeywords().then(setAllKeywords);
    }, []);

    const handleAddKeyword = async () => {
        if (!newKeyword.trim()) return;

        try {
            // Add keyword using bulk API (handles creation + XMP)
            await window.api.bulkAddKeywords([photoId], [newKeyword.trim()]);

            // Reload keywords for this photo
            const updated = await window.api.getPhotoKeywords(photoId);
            onKeywordsChange(updated);

            // Refresh all keywords list
            const all = await window.api.getKeywords();
            setAllKeywords(all);

            setNewKeyword('');
            setIsAdding(false);
        } catch (error) {
            console.error('Failed to add keyword:', error);
        }
    };

    const handleRemoveKeyword = async (keywordId: string, keywordName: string) => {
        try {
            await window.api.bulkRemoveKeywords([photoId], [keywordName]);

            const updated = await window.api.getPhotoKeywords(photoId);
            onKeywordsChange(updated);
        } catch (error) {
            console.error('Failed to remove keyword:', error);
        }
    };

    const handleSelectSuggestion = async (keyword: any) => {
        try {
            await window.api.bulkAddKeywords([photoId], [keyword.name]);

            const updated = await window.api.getPhotoKeywords(photoId);
            onKeywordsChange(updated);

            setNewKeyword('');
            setIsAdding(false);
            setShowSuggestions(false);
        } catch (error) {
            console.error('Failed to add keyword:', error);
        }
    };

    // Filter suggestions based on input
    const suggestions = allKeywords.filter(k =>
        k.name.toLowerCase().includes(newKeyword.toLowerCase()) &&
        !keywords.some(pk => pk.id === k.id)
    ).slice(0, 5);

    return (
        <div>
            {/* Current keywords */}
            <div className="flex flex-wrap gap-1 mb-2">
                {keywords.map((keyword) => (
                    <span
                        key={keyword.id}
                        className="px-2 py-0.5 bg-gray-800 text-gray-300 text-xs rounded-full flex items-center gap-1 group"
                    >
                        {keyword.name}
                        <button
                            onClick={() => handleRemoveKeyword(keyword.id, keyword.name)}
                            className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity"
                        >
                            <X size={10} />
                        </button>
                    </span>
                ))}
                {keywords.length === 0 && !isAdding && (
                    <p className="text-xs text-gray-500">No keywords</p>
                )}
            </div>

            {/* Add keyword */}
            {isAdding ? (
                <div className="relative">
                    <div className="flex items-center gap-1">
                        <input
                            type="text"
                            value={newKeyword}
                            onChange={(e) => {
                                setNewKeyword(e.target.value);
                                setShowSuggestions(e.target.value.length > 0);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleAddKeyword();
                                if (e.key === 'Escape') {
                                    setIsAdding(false);
                                    setNewKeyword('');
                                }
                            }}
                            onFocus={() => setShowSuggestions(newKeyword.length > 0)}
                            placeholder="Type keyword..."
                            autoFocus
                            className="flex-1 px-2 py-1 text-xs bg-gray-800 border border-gray-600 rounded text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                        />
                        <button
                            onClick={handleAddKeyword}
                            disabled={!newKeyword.trim()}
                            className="p-1 text-green-400 hover:text-green-300 disabled:opacity-50"
                        >
                            <Plus size={14} />
                        </button>
                        <button
                            onClick={() => {
                                setIsAdding(false);
                                setNewKeyword('');
                            }}
                            className="p-1 text-gray-400 hover:text-gray-300"
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {/* Suggestions dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-gray-800 border border-gray-600 rounded shadow-lg z-10">
                            {suggestions.map((kw) => (
                                <button
                                    key={kw.id}
                                    onClick={() => handleSelectSuggestion(kw)}
                                    className="w-full px-2 py-1 text-left text-xs text-gray-300 hover:bg-gray-700"
                                >
                                    {kw.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            ) : (
                <button
                    onClick={() => setIsAdding(true)}
                    className="px-2 py-0.5 bg-gray-800 text-gray-500 hover:text-white text-xs rounded-full flex items-center gap-1"
                >
                    <Plus size={10} />
                    Add
                </button>
            )}
        </div>
    );
};

interface SectionProps {
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}

const Section: React.FC<SectionProps> = ({ title, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-700 last:border-0">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-300 hover:bg-gray-800"
            >
                {title}
                <span className="text-gray-500">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && <div className="px-4 pb-3">{children}</div>}
        </div>
    );
};

// Histogram component
interface HistogramProps {
    imageSrc: string;
}

const Histogram: React.FC<HistogramProps> = ({ imageSrc }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [histogramData, setHistogramData] = useState<{ r: number[]; g: number[]; b: number[]; l: number[] } | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!imageSrc) return;

        setError(null);
        const img = new Image();
        // Don't set crossOrigin for local-image:// protocol - it causes CORS issues
        img.onload = () => {
            try {
                const sampleCanvas = document.createElement('canvas');
                const sampleSize = 200;
                sampleCanvas.width = sampleSize;
                sampleCanvas.height = sampleSize;
                const sampleCtx = sampleCanvas.getContext('2d');
                if (!sampleCtx) return;

                sampleCtx.drawImage(img, 0, 0, sampleSize, sampleSize);
                const imageData = sampleCtx.getImageData(0, 0, sampleSize, sampleSize);
                const data = imageData.data;

                const r = new Array(256).fill(0);
                const g = new Array(256).fill(0);
                const b = new Array(256).fill(0);
                const l = new Array(256).fill(0);

                for (let i = 0; i < data.length; i += 4) {
                    r[data[i]]++;
                    g[data[i + 1]]++;
                    b[data[i + 2]]++;
                    const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                    l[lum]++;
                }

                setHistogramData({ r, g, b, l });
            } catch (err) {
                console.error('Histogram error:', err);
                setError('Unable to read image data');
            }
        };
        img.onerror = () => {
            setError('Failed to load image');
        };
        img.src = imageSrc;
    }, [imageSrc]);

    useEffect(() => {
        if (!histogramData || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        const maxVal = Math.max(
            ...histogramData.r.slice(5, 250),
            ...histogramData.g.slice(5, 250),
            ...histogramData.b.slice(5, 250)
        );

        const drawChannel = (data: number[], color: string, alpha: number) => {
            ctx.beginPath();
            ctx.moveTo(0, height);

            for (let i = 0; i < 256; i++) {
                const x = (i / 255) * width;
                const y = height - (data[i] / maxVal) * height;
                ctx.lineTo(x, Math.max(0, y));
            }

            ctx.lineTo(width, height);
            ctx.closePath();
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha;
            ctx.fill();
        };

        drawChannel(histogramData.r, '#ef4444', 0.5);
        drawChannel(histogramData.g, '#22c55e', 0.5);
        drawChannel(histogramData.b, '#3b82f6', 0.5);
        ctx.globalAlpha = 0.3;
        drawChannel(histogramData.l, '#ffffff', 0.3);
        ctx.globalAlpha = 1;
    }, [histogramData]);

    if (error) {
        return (
            <div className="w-full h-20 rounded bg-black flex items-center justify-center">
                <span className="text-xs text-gray-500">{error}</span>
            </div>
        );
    }

    return (
        <canvas
            ref={canvasRef}
            width={220}
            height={80}
            className="w-full rounded bg-black"
        />
    );
};

// Development slider
interface SliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (value: number) => void;
}

const Slider: React.FC<SliderProps> = ({ label, value, min, max, onChange }) => {
    const percentage = ((value - min) / (max - min)) * 100;
    const isZero = value === 0;

    return (
        <div className="mb-2">
            <div className="flex justify-between items-center mb-1">
                <span className="text-xs text-gray-400">{label}</span>
                <span className={`text-xs ${isZero ? 'text-gray-500' : 'text-white'}`}>
                    {value > 0 ? `+${value}` : value}
                </span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider-thumb"
                style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #374151 ${percentage}%, #374151 100%)`
                }}
            />
        </div>
    );
};

const getStore = () => useCatalogStore.getState();

export const InfoPanel: React.FC = React.memo(() => {
    // All store selectors at the top
    const rightPanelCollapsed = useCatalogStore((s) => s.rightPanelCollapsed);
    const activePhotoId = useCatalogStore((s) => s.activePhotoId);
    const viewMode = useCatalogStore((s) => s.viewMode);
    const devSettings = useCatalogStore((s) => s.developmentSettings);
    const updateDevelopmentSetting = useCatalogStore((s) => s.updateDevelopmentSetting);
    const resetDevelopmentSettings = useCatalogStore((s) => s.resetDevelopmentSettings);

    // All state hooks
    const [activePhoto, setActivePhoto] = useState<any>(null);
    const [keywords, setKeywords] = useState<any[]>([]);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [editTitle, setEditTitle] = useState('');

    // Derived values
    const isLoupeMode = viewMode === 'loupe' || viewMode === 'develop';

    // All useCallback hooks BEFORE early returns
    const handleDevSettingChange = useCallback((key: keyof typeof devSettings, value: number) => {
        updateDevelopmentSetting(key, value);
    }, [updateDevelopmentSetting]);

    // All useEffect hooks
    useEffect(() => {
        if (activePhotoId) {
            const { photos } = getStore();
            const photo = photos.find((p) => p.id === activePhotoId);
            setActivePhoto(photo || null);
        } else {
            setActivePhoto(null);
        }
    }, [activePhotoId]);

    useEffect(() => {
        if (activePhoto) {
            window.api.getPhotoKeywords(activePhoto.id).then(setKeywords);
        }
    }, [activePhoto?.id]);

    // Early returns AFTER all hooks
    if (rightPanelCollapsed) {
        return null;
    }

    if (!activePhoto) {
        return (
            <div className="w-72 bg-gray-900 border-l border-gray-700 flex items-center justify-center">
                <div className="text-center text-gray-500 p-4">
                    <Info size={32} className="mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Select a photo to view details</p>
                </div>
            </div>
        );
    }

    const formatFileSize = (bytes?: number) => {
        if (!bytes) return 'Unknown';
        const mb = bytes / (1024 * 1024);
        return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return 'Unknown';
        try {
            return format(new Date(dateStr), 'MMM d, yyyy h:mm a');
        } catch {
            return dateStr;
        }
    };

    const formatShutterSpeed = (speed?: string) => {
        if (!speed) return undefined;
        return speed;
    };

    const formatAperture = (aperture?: number) => {
        if (!aperture) return undefined;
        return `f/${aperture}`;
    };

    const formatFocalLength = (focal?: number) => {
        if (!focal) return undefined;
        return `${focal}mm`;
    };

    const handleTitleSave = async () => {
        if (activePhoto) {
            await window.api.updatePhoto(activePhoto.id, { title: editTitle });
            getStore().updatePhoto(activePhoto.id, { title: editTitle });
            setActivePhoto({ ...activePhoto, title: editTitle });
        }
        setIsEditingTitle(false);
    };

    const handleRatingClick = async (rating: number) => {
        if (activePhoto) {
            const newRating = activePhoto.rating === rating ? 0 : rating;
            await window.api.updatePhoto(activePhoto.id, { rating: newRating });
            getStore().updatePhoto(activePhoto.id, { rating: newRating });
            setActivePhoto({ ...activePhoto, rating: newRating });
        }
    };

    const handleResetDev = () => {
        resetDevelopmentSettings();
    };

    const imageSrc = activePhoto ? getPreviewUrl(activePhoto) : '';

    return (
        <div className="w-72 bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
            {/* Preview - hide in loupe mode since image is already shown */}
            {!isLoupeMode && (
                <div className="h-48 bg-black flex items-center justify-center">
                    <img
                        src={getThumbnailUrl(activePhoto)}
                        alt={activePhoto.file_name}
                        className="max-w-full max-h-full object-contain"
                    />
                </div>
            )}

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto">
                {/* Development panels - only in loupe mode */}
                {isLoupeMode && (
                    <>
                        {/* Histogram */}
                        <Section title="Histogram" defaultOpen={true}>
                            <Histogram imageSrc={imageSrc} />
                        </Section>

                        {/* Basic Adjustments */}
                        <Section title="Basic Settings" defaultOpen={true}>
                            <Slider label="Exposure" value={devSettings.exposure} min={-100} max={100} onChange={(v) => handleDevSettingChange('exposure', v)} />
                            <Slider label="Contrast" value={devSettings.contrast} min={-100} max={100} onChange={(v) => handleDevSettingChange('contrast', v)} />
                            <Slider label="Highlights" value={devSettings.highlights} min={-100} max={100} onChange={(v) => handleDevSettingChange('highlights', v)} />
                            <Slider label="Shadows" value={devSettings.shadows} min={-100} max={100} onChange={(v) => handleDevSettingChange('shadows', v)} />
                            <Slider label="Whites" value={devSettings.whites} min={-100} max={100} onChange={(v) => handleDevSettingChange('whites', v)} />
                            <Slider label="Blacks" value={devSettings.blacks} min={-100} max={100} onChange={(v) => handleDevSettingChange('blacks', v)} />
                        </Section>

                        {/* Presence */}
                        <Section title="Presence" defaultOpen={false}>
                            <Slider label="Clarity" value={devSettings.clarity} min={-100} max={100} onChange={(v) => handleDevSettingChange('clarity', v)} />
                            <Slider label="Vibrance" value={devSettings.vibrance} min={-100} max={100} onChange={(v) => handleDevSettingChange('vibrance', v)} />
                            <Slider label="Saturation" value={devSettings.saturation} min={-100} max={100} onChange={(v) => handleDevSettingChange('saturation', v)} />
                        </Section>

                        {/* White Balance */}
                        <Section title="White Balance" defaultOpen={false}>
                            <Slider label="Temperature" value={devSettings.temperature} min={-100} max={100} onChange={(v) => handleDevSettingChange('temperature', v)} />
                            <Slider label="Tint" value={devSettings.tint} min={-100} max={100} onChange={(v) => handleDevSettingChange('tint', v)} />
                        </Section>

                        {/* Reset button */}
                        <div className="px-4 py-2 border-b border-gray-700">
                            <button
                                onClick={handleResetDev}
                                className="w-full px-3 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
                            >
                                Reset All
                            </button>
                        </div>
                    </>
                )}

                {/* Title and Rating */}
                <div className="p-4 border-b border-gray-700">
                    {isEditingTitle ? (
                        <div className="flex items-center gap-2 mb-2">
                            <input
                                type="text"
                                value={editTitle}
                                onChange={(e) => setEditTitle(e.target.value)}
                                className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm text-white"
                                autoFocus
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleTitleSave();
                                    if (e.key === 'Escape') setIsEditingTitle(false);
                                }}
                            />
                            <button
                                onClick={handleTitleSave}
                                className="p-1 text-green-500 hover:bg-gray-800 rounded"
                            >
                                <Edit3 size={14} />
                            </button>
                            <button
                                onClick={() => setIsEditingTitle(false)}
                                className="p-1 text-gray-500 hover:bg-gray-800 rounded"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <div
                            className="flex items-start justify-between mb-2 cursor-pointer group"
                            onClick={() => {
                                setEditTitle(activePhoto.title || activePhoto.file_name);
                                setIsEditingTitle(true);
                            }}
                        >
                            <h3 className="font-medium text-white truncate flex-1">
                                {activePhoto.title || activePhoto.file_name}
                            </h3>
                            <Edit3 size={14} className="text-gray-500 opacity-0 group-hover:opacity-100 ml-2 flex-shrink-0" />
                        </div>
                    )}

                    {/* Rating */}
                    <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((star) => (
                            <button
                                key={star}
                                onClick={() => handleRatingClick(star)}
                                className="p-0.5"
                            >
                                <Star
                                    size={18}
                                    className={`${
                                        star <= activePhoto.rating
                                            ? 'fill-yellow-400 text-yellow-400'
                                            : 'text-gray-600 hover:text-yellow-400'
                                    } transition-colors`}
                                />
                            </button>
                        ))}
                    </div>
                </div>

                {/* File Info */}
                <Section title="File Info">
                    <MetadataRow
                        icon={<FileImage size={14} />}
                        label="File Name"
                        value={activePhoto.file_name}
                    />
                    <MetadataRow
                        icon={<HardDrive size={14} />}
                        label="Size"
                        value={formatFileSize(activePhoto.file_size)}
                    />
                    <MetadataRow
                        icon={<Ruler size={14} />}
                        label="Dimensions"
                        value={activePhoto.width && activePhoto.height ? `${activePhoto.width} × ${activePhoto.height}` : undefined}
                    />
                    <MetadataRow
                        label="Type"
                        value={activePhoto.is_raw ? `RAW (${activePhoto.file_type})` : activePhoto.file_type}
                    />
                </Section>

                {/* Camera Info */}
                <Section title="Camera">
                    <MetadataRow
                        icon={<Camera size={14} />}
                        label="Camera"
                        value={[activePhoto.camera_make, activePhoto.camera_model].filter(Boolean).join(' ')}
                    />
                    <MetadataRow
                        label="Lens"
                        value={activePhoto.lens_model}
                    />
                    <MetadataRow
                        icon={<Aperture size={14} />}
                        label="Aperture"
                        value={formatAperture(activePhoto.aperture)}
                    />
                    <MetadataRow
                        icon={<Clock size={14} />}
                        label="Shutter Speed"
                        value={formatShutterSpeed(activePhoto.shutter_speed)}
                    />
                    <MetadataRow
                        icon={<Sun size={14} />}
                        label="ISO"
                        value={activePhoto.iso}
                    />
                    <MetadataRow
                        label="Focal Length"
                        value={formatFocalLength(activePhoto.focal_length)}
                    />
                </Section>

                {/* Date */}
                <Section title="Date">
                    <MetadataRow
                        icon={<Calendar size={14} />}
                        label="Date Taken"
                        value={formatDate(activePhoto.date_taken)}
                    />
                    <MetadataRow
                        label="Date Imported"
                        value={formatDate(activePhoto.date_imported)}
                    />
                </Section>

                {/* Location */}
                {(activePhoto.gps_latitude || activePhoto.gps_longitude) && (
                    <Section title="Location">
                        <MetadataRow
                            icon={<MapPin size={14} />}
                            label="GPS"
                            value={`${activePhoto.gps_latitude?.toFixed(6)}, ${activePhoto.gps_longitude?.toFixed(6)}`}
                        />
                    </Section>
                )}

                {/* Keywords */}
                <Section title="Keywords">
                    <KeywordsEditor
                        photoId={activePhoto.id}
                        filePath={activePhoto.file_path}
                        keywords={keywords}
                        onKeywordsChange={setKeywords}
                    />
                </Section>

                {/* Caption */}
                {activePhoto.caption && (
                    <Section title="Caption">
                        <p className="text-sm text-gray-300">{activePhoto.caption}</p>
                    </Section>
                )}
            </div>

            {/* Actions */}
            <div className="p-3 border-t border-gray-700">
                <button
                    onClick={() => window.api.showInFolder(activePhoto.file_path)}
                    className="w-full btn btn-secondary text-sm"
                >
                    Show in Finder
                </button>
            </div>
        </div>
    );
});

InfoPanel.displayName = 'InfoPanel';

export default InfoPanel;
