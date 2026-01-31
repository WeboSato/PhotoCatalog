import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useCatalogStore, Photo } from '../stores/catalogStore';
import { getImageUrl, getPreviewUrl } from '../utils/imageUrl';
import {
    Sun, Contrast, Droplet, Thermometer, Palette,
    RotateCcw, ZoomIn, ZoomOut, ChevronLeft, Eye, EyeOff,
    Undo, Redo, Save, Focus, Aperture, Circle, Layers
} from 'lucide-react';

// Histogram component
const Histogram: React.FC<{ imageSrc: string | null }> = ({ imageSrc }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [histogramData, setHistogramData] = useState<{ r: number[], g: number[], b: number[], l: number[] } | null>(null);

    useEffect(() => {
        if (!imageSrc) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            // Create offscreen canvas to analyze image
            const offCanvas = document.createElement('canvas');
            const maxSize = 200; // Downsample for performance
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            offCanvas.width = img.width * scale;
            offCanvas.height = img.height * scale;

            const ctx = offCanvas.getContext('2d');
            if (!ctx) return;

            ctx.drawImage(img, 0, 0, offCanvas.width, offCanvas.height);
            const imageData = ctx.getImageData(0, 0, offCanvas.width, offCanvas.height);
            const data = imageData.data;

            // Initialize histogram bins
            const r = new Array(256).fill(0);
            const g = new Array(256).fill(0);
            const b = new Array(256).fill(0);
            const l = new Array(256).fill(0);

            // Count pixel values
            for (let i = 0; i < data.length; i += 4) {
                r[data[i]]++;
                g[data[i + 1]]++;
                b[data[i + 2]]++;
                // Luminance
                const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
                l[lum]++;
            }

            setHistogramData({ r, g, b, l });
        };
        img.src = imageSrc;
    }, [imageSrc]);

    // Draw histogram
    useEffect(() => {
        if (!histogramData || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const width = canvas.width;
        const height = canvas.height;

        // Clear
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, width, height);

        // Find max for scaling
        const maxVal = Math.max(
            ...histogramData.l.slice(5, 250) // Ignore extremes for better scaling
        );

        // Draw luminance histogram
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#9ca3af';
        for (let i = 0; i < 256; i++) {
            const h = (histogramData.l[i] / maxVal) * height;
            ctx.fillRect((i / 256) * width, height - h, width / 256 + 1, h);
        }

        // Draw RGB overlays
        const drawChannel = (data: number[], color: string) => {
            ctx.fillStyle = color;
            for (let i = 0; i < 256; i++) {
                const h = (data[i] / maxVal) * height;
                ctx.fillRect((i / 256) * width, height - h, width / 256 + 1, h);
            }
        };

        ctx.globalAlpha = 0.3;
        drawChannel(histogramData.r, '#ef4444');
        drawChannel(histogramData.g, '#22c55e');
        drawChannel(histogramData.b, '#3b82f6');

        ctx.globalAlpha = 1;
    }, [histogramData]);

    return (
        <div className="p-4 border-b border-gray-700">
            <div className="text-xs text-gray-400 mb-2">Histogram</div>
            <canvas
                ref={canvasRef}
                width={240}
                height={80}
                className="w-full rounded bg-gray-800"
            />
            <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                <span>Shadows</span>
                <span>Midtones</span>
                <span>Highlights</span>
            </div>
        </div>
    );
};

interface DevelopSettings {
    // Basic
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
    // Presence
    clarity: number;
    vibrance: number;
    saturation: number;
    // White Balance
    temperature: number;
    tint: number;
    // Detail (Darktable)
    sharpening: number;
    sharpeningRadius: number;
    noiseReduction: number;
    noiseReductionDetail: number;
    // Effects (Darktable)
    dehaze: number;
    vignette: number;
    vignetteFeather: number;
    grain: number;
    // Split Toning (Darktable)
    splitHighlightHue: number;
    splitHighlightSat: number;
    splitShadowHue: number;
    splitShadowSat: number;
    splitBalance: number;
}

const defaultSettings: DevelopSettings = {
    exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
    clarity: 0, vibrance: 0, saturation: 0,
    temperature: 0, tint: 0,
    sharpening: 0, sharpeningRadius: 1, noiseReduction: 0, noiseReductionDetail: 50,
    dehaze: 0, vignette: 0, vignetteFeather: 50, grain: 0,
    splitHighlightHue: 40, splitHighlightSat: 0, splitShadowHue: 220, splitShadowSat: 0, splitBalance: 0
};

const DevelopSlider: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    icon?: React.ReactNode;
    unit?: string;
}> = ({ label, value, min, max, step = 1, onChange, icon, unit = '' }) => {
    const percentage = ((value - min) / (max - min)) * 100;
    const displayValue = Number.isInteger(step) ? Math.round(value) : value.toFixed(1);

    return (
        <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    {icon && <span className="text-gray-400">{icon}</span>}
                    <span className="text-xs text-gray-300">{label}</span>
                </div>
                <span className="text-xs text-gray-500 w-14 text-right">{displayValue}{unit}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                className="w-full h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #374151 ${percentage}%, #374151 100%)`
                }}
            />
        </div>
    );
};

const DevelopSection: React.FC<{
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
}> = ({ title, children, defaultOpen = true }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    return (
        <div className="border-b border-gray-700">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full px-4 py-2 text-sm font-medium text-gray-300 hover:text-white flex items-center justify-between"
            >
                {title}
                <span className="text-gray-500">{isOpen ? '−' : '+'}</span>
            </button>
            {isOpen && <div className="px-4 pb-4">{children}</div>}
        </div>
    );
};

export const DevelopView: React.FC = () => {
    const photos = useCatalogStore((s) => s.photos);
    const activePhotoId = useCatalogStore((s) => s.activePhotoId);
    const setViewMode = useCatalogStore((s) => s.setViewMode);
    const setActivePhotoId = useCatalogStore((s) => s.setActivePhotoId);
    const updatePhoto = useCatalogStore((s) => s.updatePhoto);

    const [settings, setSettings] = useState<DevelopSettings>(defaultSettings);
    const [showBefore, setShowBefore] = useState(false);
    const [zoom, setZoom] = useState(1);
    const [historyIndex, setHistoryIndex] = useState(0);
    const [history, setHistory] = useState<DevelopSettings[]>([defaultSettings]);
    const [isSaving, setIsSaving] = useState(false);

    const activePhoto = photos.find(p => p.id === activePhotoId);
    const imageSrc = activePhoto ? getPreviewUrl(activePhoto) || getImageUrl(activePhoto.file_path) : null;

    // Load existing settings when photo changes
    useEffect(() => {
        if (activePhoto?.develop_settings) {
            try {
                const saved = JSON.parse(activePhoto.develop_settings);
                const merged = { ...defaultSettings, ...saved };
                setSettings(merged);
                setHistory([merged]);
                setHistoryIndex(0);
            } catch (e) {}
        } else {
            setSettings(defaultSettings);
            setHistory([defaultSettings]);
            setHistoryIndex(0);
        }
    }, [activePhotoId]);

    const updateSetting = useCallback(<K extends keyof DevelopSettings>(key: K, value: DevelopSettings[K]) => {
        setSettings(prev => {
            const newSettings = { ...prev, [key]: value };
            setHistory(h => [...h.slice(0, historyIndex + 1), newSettings]);
            setHistoryIndex(i => i + 1);
            return newSettings;
        });
    }, [historyIndex]);

    const handleUndo = () => {
        if (historyIndex > 0) {
            setHistoryIndex(historyIndex - 1);
            setSettings(history[historyIndex - 1]);
        }
    };

    const handleRedo = () => {
        if (historyIndex < history.length - 1) {
            setHistoryIndex(historyIndex + 1);
            setSettings(history[historyIndex + 1]);
        }
    };

    const handleReset = () => {
        setSettings(defaultSettings);
        setHistory([defaultSettings]);
        setHistoryIndex(0);
    };

    const handleSave = async () => {
        if (!activePhoto) return;
        setIsSaving(true);
        try {
            await window.api.updatePhoto(activePhoto.id, {
                develop_settings: JSON.stringify(settings)
            });
            updatePhoto(activePhoto.id, { develop_settings: JSON.stringify(settings) } as any);
        } catch (e) {
            console.error('Failed to save develop settings:', e);
        }
        setIsSaving(false);
    };

    // Generate CSS filters for preview
    const generateFilter = (): string => {
        const filters: string[] = [];

        // Basic adjustments
        if (settings.exposure !== 0) filters.push(`brightness(${1 + settings.exposure / 3})`);
        if (settings.contrast !== 0) filters.push(`contrast(${1 + settings.contrast / 100})`);
        if (settings.saturation !== 0) filters.push(`saturate(${1 + settings.saturation / 100})`);

        // Sharpening approximation (using contrast at edges - simplified)
        if (settings.sharpening > 0) {
            // CSS doesn't have true sharpening, we simulate with slight contrast boost
            const sharpBoost = settings.sharpening / 200;
            if (!filters.some(f => f.includes('contrast'))) {
                filters.push(`contrast(${1 + sharpBoost})`);
            }
        }

        // Dehaze (increase contrast and saturation)
        if (settings.dehaze !== 0) {
            const dehazeContrast = settings.dehaze / 100;
            const dehazeSat = settings.dehaze / 200;
            filters.push(`contrast(${1 + dehazeContrast * 0.3})`);
            filters.push(`saturate(${1 + dehazeSat})`);
        }

        // Noise reduction approximation (slight blur)
        if (settings.noiseReduction > 50) {
            filters.push(`blur(${(settings.noiseReduction - 50) / 100}px)`);
        }

        // Temperature (hue-rotate approximation)
        if (settings.temperature !== 0) {
            const tempShift = settings.temperature / 10;
            filters.push(`sepia(${Math.abs(tempShift) / 50})`);
            if (settings.temperature > 0) {
                filters.push(`hue-rotate(-10deg)`);
            } else {
                filters.push(`hue-rotate(10deg)`);
            }
        }

        // Grain (using CSS noise - limited but works)

        return filters.join(' ') || 'none';
    };

    // Generate vignette overlay style
    const generateVignette = (): React.CSSProperties | undefined => {
        if (settings.vignette === 0) return undefined;
        const intensity = Math.abs(settings.vignette) / 100;
        const feather = settings.vignetteFeather;
        const color = settings.vignette > 0 ? 'rgba(0,0,0,' : 'rgba(255,255,255,';
        return {
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background: `radial-gradient(ellipse at center, transparent ${100 - feather}%, ${color}${intensity}) 100%)`
        };
    };

    const currentIndex = photos.findIndex(p => p.id === activePhotoId);

    if (!activePhoto) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-900">
                <div className="text-center">
                    <div className="text-6xl mb-4">🎨</div>
                    <h3 className="text-xl font-semibold text-white mb-2">Develop Module</h3>
                    <p className="text-gray-400 max-w-md mb-4">
                        Select a photo to start editing. All adjustments are non-destructive.
                    </p>
                    <button onClick={() => setViewMode('grid')} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                        Go to Library
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex overflow-hidden bg-gray-900">
            {/* Left filmstrip */}
            <div className="w-16 bg-gray-950 border-r border-gray-700 flex flex-col items-center py-4 gap-2">
                <button onClick={() => setViewMode('grid')} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded" title="Back to Library">
                    <ChevronLeft size={20} />
                </button>
                <div className="flex-1" />
                <div className="space-y-2 overflow-y-auto max-h-96">
                    {photos.slice(Math.max(0, currentIndex - 3), currentIndex + 4).map(photo => (
                        <button
                            key={photo.id}
                            onClick={() => setActivePhotoId(photo.id)}
                            className={`w-12 h-12 rounded overflow-hidden ${photo.id === activePhotoId ? 'ring-2 ring-blue-500' : 'opacity-60 hover:opacity-100'}`}
                        >
                            <img src={getImageUrl(photo.file_path)} alt="" className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Center preview */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium">{activePhoto.file_name}</span>
                        <span className="text-xs text-gray-500">{currentIndex + 1} / {photos.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleUndo} disabled={historyIndex === 0}
                            className={`p-2 rounded ${historyIndex === 0 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            <Undo size={16} />
                        </button>
                        <button onClick={handleRedo} disabled={historyIndex >= history.length - 1}
                            className={`p-2 rounded ${historyIndex >= history.length - 1 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            <Redo size={16} />
                        </button>
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={() => setShowBefore(!showBefore)}
                            className={`p-2 rounded ${showBefore ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            {showBefore ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                            <ZoomOut size={16} />
                        </button>
                        <span className="text-xs text-gray-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded">
                            <ZoomIn size={16} />
                        </button>
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={handleSave} disabled={isSaving}
                            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded hover:bg-green-700 flex items-center gap-1">
                            <Save size={14} />
                            {isSaving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex items-center justify-center overflow-auto p-4">
                    <div className="relative inline-block">
                        <img
                            src={imageSrc || ''}
                            alt={activePhoto.file_name}
                            className="max-w-full max-h-full object-contain"
                            style={{
                                filter: showBefore ? 'none' : generateFilter(),
                                transform: `scale(${zoom})`,
                                transformOrigin: 'center',
                                transition: 'filter 0.1s ease'
                            }}
                        />
                        {!showBefore && settings.vignette !== 0 && (
                            <div style={generateVignette()} />
                        )}
                        {showBefore && (
                            <div className="absolute top-4 left-4 bg-black/70 px-2 py-1 rounded text-xs text-white">BEFORE</div>
                        )}
                    </div>
                </div>
            </div>

            {/* Right panel - settings */}
            <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
                <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white">Develop</h2>
                    <button onClick={handleReset} className="text-xs text-gray-400 hover:text-white flex items-center gap-1">
                        <RotateCcw size={12} /> Reset
                    </button>
                </div>

                {/* Histogram */}
                <Histogram imageSrc={imageSrc} />

                <DevelopSection title="Basic">
                    <DevelopSlider label="Exposure" value={settings.exposure} min={-5} max={5} step={0.1} onChange={(v) => updateSetting('exposure', v)} icon={<Sun size={12} />} />
                    <DevelopSlider label="Contrast" value={settings.contrast} min={-100} max={100} onChange={(v) => updateSetting('contrast', v)} icon={<Contrast size={12} />} />
                    <DevelopSlider label="Highlights" value={settings.highlights} min={-100} max={100} onChange={(v) => updateSetting('highlights', v)} />
                    <DevelopSlider label="Shadows" value={settings.shadows} min={-100} max={100} onChange={(v) => updateSetting('shadows', v)} />
                    <DevelopSlider label="Whites" value={settings.whites} min={-100} max={100} onChange={(v) => updateSetting('whites', v)} />
                    <DevelopSlider label="Blacks" value={settings.blacks} min={-100} max={100} onChange={(v) => updateSetting('blacks', v)} />
                </DevelopSection>

                <DevelopSection title="Presence">
                    <DevelopSlider label="Clarity" value={settings.clarity} min={-100} max={100} onChange={(v) => updateSetting('clarity', v)} />
                    <DevelopSlider label="Dehaze" value={settings.dehaze} min={-100} max={100} onChange={(v) => updateSetting('dehaze', v)} icon={<Layers size={12} />} />
                    <DevelopSlider label="Vibrance" value={settings.vibrance} min={-100} max={100} onChange={(v) => updateSetting('vibrance', v)} icon={<Droplet size={12} />} />
                    <DevelopSlider label="Saturation" value={settings.saturation} min={-100} max={100} onChange={(v) => updateSetting('saturation', v)} icon={<Palette size={12} />} />
                </DevelopSection>

                <DevelopSection title="White Balance">
                    <DevelopSlider label="Temperature" value={settings.temperature} min={-100} max={100} onChange={(v) => updateSetting('temperature', v)} icon={<Thermometer size={12} />} />
                    <DevelopSlider label="Tint" value={settings.tint} min={-100} max={100} onChange={(v) => updateSetting('tint', v)} />
                </DevelopSection>

                <DevelopSection title="Detail" defaultOpen={false}>
                    <DevelopSlider label="Sharpening" value={settings.sharpening} min={0} max={150} onChange={(v) => updateSetting('sharpening', v)} icon={<Focus size={12} />} />
                    <DevelopSlider label="Radius" value={settings.sharpeningRadius} min={0.5} max={3} step={0.1} onChange={(v) => updateSetting('sharpeningRadius', v)} />
                    <div className="h-px bg-gray-700 my-3" />
                    <DevelopSlider label="Noise Reduction" value={settings.noiseReduction} min={0} max={100} onChange={(v) => updateSetting('noiseReduction', v)} />
                    <DevelopSlider label="Detail" value={settings.noiseReductionDetail} min={0} max={100} onChange={(v) => updateSetting('noiseReductionDetail', v)} />
                </DevelopSection>

                <DevelopSection title="Effects" defaultOpen={false}>
                    <DevelopSlider label="Vignette" value={settings.vignette} min={-100} max={100} onChange={(v) => updateSetting('vignette', v)} icon={<Aperture size={12} />} />
                    <DevelopSlider label="Feather" value={settings.vignetteFeather} min={0} max={100} onChange={(v) => updateSetting('vignetteFeather', v)} />
                    <div className="h-px bg-gray-700 my-3" />
                    <DevelopSlider label="Grain" value={settings.grain} min={0} max={100} onChange={(v) => updateSetting('grain', v)} icon={<Circle size={12} />} />
                </DevelopSection>

                <DevelopSection title="Split Toning" defaultOpen={false}>
                    <p className="text-xs text-gray-500 mb-3">Highlights</p>
                    <DevelopSlider label="Hue" value={settings.splitHighlightHue} min={0} max={360} onChange={(v) => updateSetting('splitHighlightHue', v)} unit="°" />
                    <DevelopSlider label="Saturation" value={settings.splitHighlightSat} min={0} max={100} onChange={(v) => updateSetting('splitHighlightSat', v)} />
                    <p className="text-xs text-gray-500 mb-3 mt-4">Shadows</p>
                    <DevelopSlider label="Hue" value={settings.splitShadowHue} min={0} max={360} onChange={(v) => updateSetting('splitShadowHue', v)} unit="°" />
                    <DevelopSlider label="Saturation" value={settings.splitShadowSat} min={0} max={100} onChange={(v) => updateSetting('splitShadowSat', v)} />
                    <div className="h-px bg-gray-700 my-3" />
                    <DevelopSlider label="Balance" value={settings.splitBalance} min={-100} max={100} onChange={(v) => updateSetting('splitBalance', v)} />
                </DevelopSection>

                <div className="p-4 text-xs text-gray-500">
                    <p className="mb-2">Non-destructive editing</p>
                    <p>Settings saved to XMP sidecar. Original file untouched.</p>
                </div>
            </div>
        </div>
    );
};

export default DevelopView;
