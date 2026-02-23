import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useCatalogStore, Photo } from '../stores/catalogStore';
import { getImageUrl, getPreviewUrl } from '../utils/imageUrl';
import {
    Sun, Contrast, Droplet, Thermometer, Palette,
    RotateCcw, ZoomIn, ZoomOut, ChevronLeft, ChevronDown, Eye, EyeOff,
    Undo, Redo, Save, Focus, Aperture, Circle, Layers,
    Sliders, Check, Sparkles
} from 'lucide-react';

// ==========================================
// Histogram optimise (downsample a 100px)
// ==========================================
const Histogram: React.FC<{ imageSrc: string | null }> = ({ imageSrc }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [histogramData, setHistogramData] = useState<{ r: number[], g: number[], b: number[], l: number[] } | null>(null);

    useEffect(() => {
        if (!imageSrc) return;

        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            const offCanvas = document.createElement('canvas');
            const maxSize = 100; // Downsample pour performance
            const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
            offCanvas.width = img.width * scale;
            offCanvas.height = img.height * scale;

            const ctx = offCanvas.getContext('2d');
            if (!ctx) return;

            ctx.drawImage(img, 0, 0, offCanvas.width, offCanvas.height);
            const imageData = ctx.getImageData(0, 0, offCanvas.width, offCanvas.height);
            const data = imageData.data;

            const r = new Array(256).fill(0);
            const g = new Array(256).fill(0);
            const b = new Array(256).fill(0);
            const l = new Array(256).fill(0);

            for (let i = 0; i < data.length; i += 4) {
                const pixelR = data[i];
                const pixelG = data[i + 1];
                const pixelB = data[i + 2];

                r[pixelR]++;
                g[pixelG]++;
                b[pixelB]++;

                const lum = Math.round(0.299 * pixelR + 0.587 * pixelG + 0.114 * pixelB);
                l[lum]++;
            }

            setHistogramData({ r, g, b, l });
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

        ctx.fillStyle = '#1f2937';
        ctx.fillRect(0, 0, width, height);

        const maxVal = Math.max(...histogramData.l.slice(5, 250));

        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#9ca3af';
        for (let i = 0; i < 256; i++) {
            const h = (histogramData.l[i] / maxVal) * height;
            ctx.fillRect((i / 256) * width, height - h, width / 256 + 1, h);
        }

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

// ==========================================
// Interfaces et types
// ==========================================
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
    // Detail
    sharpening: number;
    sharpeningRadius: number;
    noiseReduction: number;
    noiseReductionDetail: number;
    // Effects
    dehaze: number;
    vignette: number;
    vignetteFeather: number;
    grain: number;
    // Split Toning
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

// ==========================================
// Presets intelligents
// ==========================================
interface Preset {
    id: string;
    name: string;
    category: string;
    settings: Partial<DevelopSettings>;
}

const presets: Preset[] = [
    { id: 'auto', name: 'Auto', category: 'Basic', settings: {} },
    { id: 'vivid', name: 'Vivid', category: 'Basic', settings: { saturation: 30, contrast: 15, vibrance: 20 } },
    { id: 'natural', name: 'Natural', category: 'Basic', settings: { saturation: 10, contrast: 5, vibrance: 10 } },
    { id: 'flat', name: 'Flat', category: 'Basic', settings: { saturation: -20, contrast: -10, highlights: -20, shadows: 20 } },
    { id: 'bw-classic', name: 'N&B Classique', category: 'Noir & Blanc', settings: { saturation: -100, contrast: 20 } },
    { id: 'bw-high-contrast', name: 'N&B Contraste', category: 'Noir & Blanc', settings: { saturation: -100, contrast: 50, blacks: -20 } },
    { id: 'bw-fade', name: 'N&B Fade', category: 'Noir & Blanc', settings: { saturation: -100, contrast: -10, blacks: 30 } },
    { id: 'vintage-warm', name: 'Vintage Chaud', category: 'Creative', settings: { temperature: 20, tint: 10, saturation: 15, contrast: -5 } },
    { id: 'vintage-cool', name: 'Vintage Froid', category: 'Creative', settings: { temperature: -15, saturation: -15, contrast: 10, blacks: 15 } },
    { id: 'cinematic', name: 'Cinematique', category: 'Creative', settings: { contrast: 25, saturation: -10, clarity: 15, vignette: -30 } },
    { id: 'golden-hour', name: 'Heure Doree', category: 'Creative', settings: { temperature: 25, exposure: 0.3, saturation: 15, highlights: -10 } },
    { id: 'moody', name: 'Moody', category: 'Creative', settings: { contrast: 20, shadows: -20, saturation: -15, vignette: -40, clarity: 10 } },
];

// ==========================================
// Slider ameliore avec min/max
// ==========================================
const DevelopSlider: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    onChange: (value: number) => void;
    icon?: React.ReactNode;
    unit?: string;
    showValue?: boolean;
}> = ({ label, value, min, max, step = 1, onChange, icon, unit = '', showValue = true }) => {
    const percentage = ((value - min) / (max - min)) * 100;
    const displayValue = Number.isInteger(step) ? Math.round(value) : value.toFixed(1);

    return (
        <div className="mb-3 group">
            <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                    {icon && <span className="text-gray-400">{icon}</span>}
                    <span className="text-xs text-gray-300">{label}</span>
                </div>
                {showValue && (
                    <span className="text-xs text-gray-500 w-14 text-right">
                        {displayValue}{unit}
                    </span>
                )}
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                onDoubleClick={() => onChange(min === 0 ? 0 : 0)} // Double-click pour reset a 0
                className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
                style={{
                    background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #374151 ${percentage}%, #374151 100%)`
                }}
            />
            <div className="flex justify-between text-[10px] text-gray-600 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <span>{min}</span>
                <span>{max}</span>
            </div>
        </div>
    );
};

// ==========================================
// Section accordeon avec gradient
// ==========================================
const DevelopSection: React.FC<{
    title: string;
    children: React.ReactNode;
    defaultOpen?: boolean;
    onToggle?: (isOpen: boolean) => void;
}> = ({ title, children, defaultOpen = true, onToggle }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    const handleToggle = () => {
        const newOpen = !isOpen;
        setIsOpen(newOpen);
        onToggle?.(newOpen);
    };

    return (
        <div className="border-b border-gray-700">
            <button
                onClick={handleToggle}
                className="w-full px-4 py-2 text-sm font-medium text-gray-300 hover:text-white flex items-center justify-between transition-colors"
                style={{ background: 'linear-gradient(to right, #1f2937, #374151)' }}
            >
                <span className="flex items-center gap-2">
                    <ChevronDown size={14} className={`transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                    {title}
                </span>
            </button>
            <div
                className={`overflow-hidden transition-all duration-200 ${isOpen ? 'max-h-[2000px] opacity-100' : 'max-h-0 opacity-0'}`}
            >
                <div className="px-4 pb-4 pt-2">{children}</div>
            </div>
        </div>
    );
};

// ==========================================
// Panneau des presets
// ==========================================
const PresetsPanel: React.FC<{
    onApply: (preset: Preset) => void;
    activePresetId: string | null;
}> = ({ onApply, activePresetId }) => {
    const categories = [...new Set(presets.map(p => p.category))];

    return (
        <div className="border-b border-gray-700">
            <div className="px-4 py-2 text-sm font-medium text-gray-300 flex items-center gap-2"
                 style={{ background: 'linear-gradient(to right, #1f2937, #374151)' }}>
                <Sparkles size={14} />
                Presets
            </div>
            <div className="px-4 py-3">
                {categories.map(category => (
                    <div key={category} className="mb-3">
                        <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">{category}</p>
                        <div className="flex flex-wrap gap-1.5">
                            {presets.filter(p => p.category === category).map(preset => (
                                <button
                                    key={preset.id}
                                    onClick={() => onApply(preset)}
                                    className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                                        activePresetId === preset.id
                                            ? 'bg-blue-600 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                                    }`}
                                >
                                    {preset.name}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ==========================================
// Composant principal DevelopView
// ==========================================
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
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [activePresetId, setActivePresetId] = useState<string | null>(null);

    const activePhoto = photos.find(p => p.id === activePhotoId);
    const imageSrc = activePhoto ? getPreviewUrl(activePhoto) || getImageUrl(activePhoto.file_path) : null;

    // Charger les reglages existants quand la photo change
    useEffect(() => {
        if (activePhoto?.develop_settings) {
            try {
                const saved = JSON.parse(activePhoto.develop_settings);
                const merged = { ...defaultSettings, ...saved };
                setSettings(merged);
                setHistory([merged]);
                setHistoryIndex(0);
                setActivePresetId(null);
            } catch (e) {}
        } else {
            setSettings(defaultSettings);
            setHistory([defaultSettings]);
            setHistoryIndex(0);
            setActivePresetId(null);
        }
    }, [activePhotoId]);

    // Historique intelligent - evite les doublons
    const updateSetting = useCallback(<K extends keyof DevelopSettings>(key: K, value: DevelopSettings[K]) => {
        setSettings(prev => {
            const newSettings = { ...prev, [key]: value };
            setHistory(h => {
                const current = h[historyIndex];
                if (current && JSON.stringify(current) === JSON.stringify(newSettings)) {
                    return h;
                }
                return [...h.slice(0, historyIndex + 1), newSettings];
            });
            setHistoryIndex(i => i + 1);
            setActivePresetId(null);
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
        setActivePresetId(null);
    };

    // Appliquer un preset
    const applyPreset = (preset: Preset) => {
        const newSettings = { ...defaultSettings, ...preset.settings };
        setSettings(newSettings);
        setHistory(h => [...h.slice(0, historyIndex + 1), newSettings]);
        setHistoryIndex(i => i + 1);
        setActivePresetId(preset.id);
    };

    // Sauvegarde avec feedback visuel
    const handleSave = async () => {
        if (!activePhoto) return;
        setIsSaving(true);
        try {
            await window.api.updatePhoto(activePhoto.id, {
                develop_settings: JSON.stringify(settings)
            });
            updatePhoto(activePhoto.id, { develop_settings: JSON.stringify(settings) } as any);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        } catch (e) {
            console.error('Failed to save develop settings:', e);
        }
        setIsSaving(false);
    };

    // Filtres CSS optimises
    const generateFilter = (): string => {
        const filters: string[] = [];

        if (settings.exposure !== 0) {
            const brightness = Math.max(0, 1 + settings.exposure / 3);
            filters.push(`brightness(${brightness})`);
        }

        if (settings.contrast !== 0) {
            const contrast = Math.max(0, 1 + settings.contrast / 100);
            filters.push(`contrast(${contrast})`);
        }

        if (settings.saturation !== 0) {
            const saturate = Math.max(0, 1 + settings.saturation / 100);
            filters.push(`saturate(${saturate})`);
        }

        if (settings.clarity !== 0) {
            const clarity = Math.max(0, 1 + settings.clarity / 100);
            filters.push(`contrast(${clarity})`);
        }

        if (settings.sharpening > 0) {
            const sharpBoost = settings.sharpening / 200;
            if (!filters.some(f => f.includes('contrast'))) {
                filters.push(`contrast(${1 + sharpBoost})`);
            }
        }

        if (settings.dehaze !== 0) {
            const dehazeContrast = settings.dehaze / 100;
            const dehazeSat = settings.dehaze / 200;
            filters.push(`contrast(${1 + dehazeContrast * 0.3})`);
            filters.push(`saturate(${1 + dehazeSat})`);
        }

        if (settings.noiseReduction > 50) {
            filters.push(`blur(${(settings.noiseReduction - 50) / 100}px)`);
        }

        if (settings.temperature !== 0) {
            const tempShift = settings.temperature / 10;
            filters.push(`sepia(${Math.abs(tempShift) / 50})`);
            if (settings.temperature > 0) {
                filters.push(`hue-rotate(-10deg)`);
            } else {
                filters.push(`hue-rotate(10deg)`);
            }
        }

        return filters.join(' ') || 'none';
    };

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

    // Raccourcis clavier
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Ignorer si on est dans un input
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                if (e.shiftKey) {
                    handleRedo();
                } else {
                    handleUndo();
                }
            } else if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            } else if (e.key === '\\') {
                e.preventDefault();
                setShowBefore(prev => !prev);
            } else if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                setZoom(z => Math.min(4, z + 0.25));
            } else if (e.key === '-') {
                e.preventDefault();
                setZoom(z => Math.max(0.25, z - 0.25));
            } else if (e.key === '0') {
                e.preventDefault();
                setZoom(1);
            } else if (e.key === 'ArrowLeft' && currentIndex > 0) {
                e.preventDefault();
                setActivePhotoId(photos[currentIndex - 1].id);
            } else if (e.key === 'ArrowRight' && currentIndex < photos.length - 1) {
                e.preventDefault();
                setActivePhotoId(photos[currentIndex + 1].id);
            } else if (e.key === 'Escape') {
                setViewMode('grid');
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [historyIndex, history, currentIndex, photos]);

    if (!activePhoto) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-900">
                <div className="text-center">
                    <Sliders size={64} className="mx-auto mb-4 text-gray-600" />
                    <h3 className="text-xl font-semibold text-white mb-2">Module Develop</h3>
                    <p className="text-gray-400 max-w-md mb-4">
                        Selectionnez une photo pour commencer l'edition. Tous les ajustements sont non-destructifs.
                    </p>
                    <button onClick={() => setViewMode('grid')} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
                        Aller a la Bibliotheque
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 flex overflow-hidden bg-gray-900">
            {/* Filmstrip gauche */}
            <div className="w-16 bg-gray-950 border-r border-gray-700 flex flex-col items-center py-4 gap-2">
                <button onClick={() => setViewMode('grid')} className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded" title="Retour a la Bibliotheque">
                    <ChevronLeft size={20} />
                </button>
                <div className="flex-1" />
                <div className="space-y-2 overflow-y-auto max-h-96">
                    {photos.slice(Math.max(0, currentIndex - 3), currentIndex + 4).map(photo => (
                        <button
                            key={photo.id}
                            onClick={() => setActivePhotoId(photo.id)}
                            className={`w-12 h-12 rounded overflow-hidden transition-all ${photo.id === activePhotoId ? 'ring-2 ring-blue-500 scale-105' : 'opacity-60 hover:opacity-100'}`}
                        >
                            <img src={getImageUrl(photo.file_path)} alt="" className="w-full h-full object-cover" />
                        </button>
                    ))}
                </div>
            </div>

            {/* Preview central */}
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="h-12 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-white font-medium">{activePhoto.file_name}</span>
                        <span className="text-xs text-gray-500">{currentIndex + 1} / {photos.length}</span>
                        {activePresetId && (
                            <span className="text-xs bg-blue-600/30 text-blue-300 px-2 py-0.5 rounded">
                                {presets.find(p => p.id === activePresetId)?.name}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleUndo} disabled={historyIndex === 0}
                            title="Annuler (Cmd+Z)"
                            className={`p-2 rounded ${historyIndex === 0 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            <Undo size={16} />
                        </button>
                        <button onClick={handleRedo} disabled={historyIndex >= history.length - 1}
                            title="Refaire (Cmd+Shift+Z)"
                            className={`p-2 rounded ${historyIndex >= history.length - 1 ? 'text-gray-600' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            <Redo size={16} />
                        </button>
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={() => setShowBefore(!showBefore)}
                            title="Avant/Apres (\\)"
                            className={`p-2 rounded ${showBefore ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            {showBefore ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded" title="Zoom - (-)">
                            <ZoomOut size={16} />
                        </button>
                        <button onClick={() => setZoom(1)} className="text-xs text-gray-400 w-12 text-center hover:text-white cursor-pointer" title="Reset zoom (0)">
                            {Math.round(zoom * 100)}%
                        </button>
                        <button onClick={() => setZoom(z => Math.min(4, z + 0.25))} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded" title="Zoom + (+)">
                            <ZoomIn size={16} />
                        </button>
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={handleSave} disabled={isSaving}
                            title="Sauvegarder (Cmd+S)"
                            className={`px-3 py-1.5 text-white text-sm rounded flex items-center gap-1 transition-all ${
                                saveSuccess ? 'bg-green-500' : 'bg-green-600 hover:bg-green-700'
                            }`}>
                            {saveSuccess ? <Check size={14} /> : <Save size={14} />}
                            {isSaving ? 'Sauvegarde...' : saveSuccess ? 'OK' : 'Sauvegarder'}
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
                            <div className="absolute top-4 left-4 bg-black/70 px-3 py-1.5 rounded text-xs text-white font-medium">
                                AVANT
                            </div>
                        )}
                    </div>
                </div>

                {/* Barre de raccourcis en bas */}
                <div className="h-8 bg-gray-800/50 border-t border-gray-700 flex items-center justify-center gap-6 text-[10px] text-gray-500">
                    <span><kbd className="px-1 bg-gray-700 rounded">Cmd+Z</kbd> Annuler</span>
                    <span><kbd className="px-1 bg-gray-700 rounded">Cmd+S</kbd> Sauvegarder</span>
                    <span><kbd className="px-1 bg-gray-700 rounded">\</kbd> Avant/Apres</span>
                    <span><kbd className="px-1 bg-gray-700 rounded">+/-</kbd> Zoom</span>
                    <span><kbd className="px-1 bg-gray-700 rounded">Esc</kbd> Quitter</span>
                </div>
            </div>

            {/* Panneau droit - reglages */}
            <div className="w-80 bg-gray-800 border-l border-gray-700 overflow-y-auto">
                <div className="p-4 border-b border-gray-700 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-white">Develop</h2>
                    <button onClick={handleReset} className="text-xs text-gray-400 hover:text-white flex items-center gap-1 transition-colors">
                        <RotateCcw size={12} /> Reset
                    </button>
                </div>

                {/* Histogramme */}
                <Histogram imageSrc={imageSrc} />

                {/* Presets */}
                <PresetsPanel onApply={applyPreset} activePresetId={activePresetId} />

                <DevelopSection title="Basic">
                    <DevelopSlider label="Exposition" value={settings.exposure} min={-5} max={5} step={0.1} onChange={(v) => updateSetting('exposure', v)} icon={<Sun size={12} />} />
                    <DevelopSlider label="Contraste" value={settings.contrast} min={-100} max={100} onChange={(v) => updateSetting('contrast', v)} icon={<Contrast size={12} />} />
                    <DevelopSlider label="Hautes Lumieres" value={settings.highlights} min={-100} max={100} onChange={(v) => updateSetting('highlights', v)} />
                    <DevelopSlider label="Ombres" value={settings.shadows} min={-100} max={100} onChange={(v) => updateSetting('shadows', v)} />
                    <DevelopSlider label="Blancs" value={settings.whites} min={-100} max={100} onChange={(v) => updateSetting('whites', v)} />
                    <DevelopSlider label="Noirs" value={settings.blacks} min={-100} max={100} onChange={(v) => updateSetting('blacks', v)} />
                </DevelopSection>

                <DevelopSection title="Presence">
                    <DevelopSlider label="Clarte" value={settings.clarity} min={-100} max={100} onChange={(v) => updateSetting('clarity', v)} />
                    <DevelopSlider label="Dehaze" value={settings.dehaze} min={-100} max={100} onChange={(v) => updateSetting('dehaze', v)} icon={<Layers size={12} />} />
                    <DevelopSlider label="Vibrance" value={settings.vibrance} min={-100} max={100} onChange={(v) => updateSetting('vibrance', v)} icon={<Droplet size={12} />} />
                    <DevelopSlider label="Saturation" value={settings.saturation} min={-100} max={100} onChange={(v) => updateSetting('saturation', v)} icon={<Palette size={12} />} />
                </DevelopSection>

                <DevelopSection title="Balance des Blancs">
                    <DevelopSlider label="Temperature" value={settings.temperature} min={-100} max={100} onChange={(v) => updateSetting('temperature', v)} icon={<Thermometer size={12} />} />
                    <DevelopSlider label="Teinte" value={settings.tint} min={-100} max={100} onChange={(v) => updateSetting('tint', v)} />
                </DevelopSection>

                <DevelopSection title="Detail" defaultOpen={false}>
                    <DevelopSlider label="Nettete" value={settings.sharpening} min={0} max={150} onChange={(v) => updateSetting('sharpening', v)} icon={<Focus size={12} />} />
                    <DevelopSlider label="Rayon" value={settings.sharpeningRadius} min={0.5} max={3} step={0.1} onChange={(v) => updateSetting('sharpeningRadius', v)} />
                    <div className="h-px bg-gray-700 my-3" />
                    <DevelopSlider label="Reduction du bruit" value={settings.noiseReduction} min={0} max={100} onChange={(v) => updateSetting('noiseReduction', v)} />
                    <DevelopSlider label="Detail" value={settings.noiseReductionDetail} min={0} max={100} onChange={(v) => updateSetting('noiseReductionDetail', v)} />
                </DevelopSection>

                <DevelopSection title="Effets" defaultOpen={false}>
                    <DevelopSlider label="Vignettage" value={settings.vignette} min={-100} max={100} onChange={(v) => updateSetting('vignette', v)} icon={<Aperture size={12} />} />
                    <DevelopSlider label="Adoucissement" value={settings.vignetteFeather} min={0} max={100} onChange={(v) => updateSetting('vignetteFeather', v)} />
                    <div className="h-px bg-gray-700 my-3" />
                    <DevelopSlider label="Grain" value={settings.grain} min={0} max={100} onChange={(v) => updateSetting('grain', v)} icon={<Circle size={12} />} />
                </DevelopSection>

                <DevelopSection title="Split Toning" defaultOpen={false}>
                    <p className="text-xs text-gray-500 mb-3">Hautes Lumieres</p>
                    <DevelopSlider label="Teinte" value={settings.splitHighlightHue} min={0} max={360} onChange={(v) => updateSetting('splitHighlightHue', v)} unit="deg" />
                    <DevelopSlider label="Saturation" value={settings.splitHighlightSat} min={0} max={100} onChange={(v) => updateSetting('splitHighlightSat', v)} />
                    <p className="text-xs text-gray-500 mb-3 mt-4">Ombres</p>
                    <DevelopSlider label="Teinte" value={settings.splitShadowHue} min={0} max={360} onChange={(v) => updateSetting('splitShadowHue', v)} unit="deg" />
                    <DevelopSlider label="Saturation" value={settings.splitShadowSat} min={0} max={100} onChange={(v) => updateSetting('splitShadowSat', v)} />
                    <div className="h-px bg-gray-700 my-3" />
                    <DevelopSlider label="Balance" value={settings.splitBalance} min={-100} max={100} onChange={(v) => updateSetting('splitBalance', v)} />
                </DevelopSection>

                <div className="p-4 text-xs text-gray-500">
                    <p className="mb-2">Edition non-destructive</p>
                    <p>Reglages sauvegardes en XMP sidecar. Fichier original intact.</p>
                </div>
            </div>
        </div>
    );
};

export default DevelopView;
