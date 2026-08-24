import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useCatalogStore, Photo } from '../stores/catalogStore';
import { getImageUrl, getPreviewUrl } from '../utils/imageUrl';
import {
    Sun, Contrast, Droplet, Thermometer, Palette,
    RotateCcw, ZoomIn, ZoomOut, ChevronLeft, ChevronDown, Eye, EyeOff,
    Undo, Redo, Save, Focus, Aperture, Circle, Layers,
    Sliders, Check, Sparkles, Crop, Eraser, Pipette, X as XIcon
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
        drawChannel(histogramData.b, '#9a9aa2');

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
                    background: `linear-gradient(to right, #9a9aa2 0%, #9a9aa2 ${percentage}%, #374151 ${percentage}%, #374151 100%)`
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
                                            ? 'bg-white/10 text-white'
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

    // Every photo opens fitted to the view (zoom 100% of "fit"), never carrying
    // the previous photo's zoom.
    useEffect(() => { setZoom(1); }, [activePhotoId]);

    // Bumped after a crop is applied so the <img> remounts and revalidates the
    // regenerated (same-URL) preview instead of showing the stale cached one.
    const [imgVersion, setImgVersion] = useState(0);
    const imageSrc = activePhoto ? getPreviewUrl(activePhoto) || getImageUrl(activePhoto.file_path) : null;

    // ---- Recadrage non destructif (façon Lightroom) -----------------------
    // Le rect est normalisé (0..1) par rapport à l'image ORIGINALE complète et
    // vit dans develop_settings.crop. Le fichier n'est jamais modifié : seules
    // les vignettes sont re-rendues, et on peut revenir en arrière à tout moment.
    const [cropMode, setCropMode] = useState(false);
    const [cropRect, setCropRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
    const [cropAspect, setCropAspect] = useState<number | null>(null); // en pixels image (w/h); null = libre
    const [uncroppedSrc, setUncroppedSrc] = useState<string | null>(null);
    const [hasSavedCrop, setHasSavedCrop] = useState(false);
    const [applyingCrop, setApplyingCrop] = useState(false);
    const cropImgRef = useRef<HTMLImageElement>(null);
    const cropDragRef = useRef<null | { mode: string; startX: number; startY: number; rect: { x: number; y: number; w: number; h: number } }>(null);

    const readSavedCrop = useCallback((): { x: number; y: number; w: number; h: number } | null => {
        try {
            const ds = activePhoto?.develop_settings ? JSON.parse(activePhoto.develop_settings as any) : null;
            return ds?.crop || null;
        } catch { return null; }
    }, [activePhoto]);

    const enterCropMode = useCallback(async () => {
        if (!activePhoto) return;
        const saved = readSavedCrop();
        setHasSavedCrop(!!saved);
        setCropRect(saved || { x: 0.05, y: 0.05, w: 0.9, h: 0.9 });
        setCropAspect(null);
        setUncroppedSrc(null);
        setCropMode(true);
        // Le preview stocké est déjà recadré : il faut l'image COMPLÈTE pour recadrer.
        const p = await window.api.getUncroppedPreview(activePhoto.id);
        setUncroppedSrc(p ? getImageUrl(p) : (imageSrc || null));
    }, [activePhoto, imageSrc, readSavedCrop]);

    const clampRect = (r: { x: number; y: number; w: number; h: number }) => {
        const w = Math.max(0.05, Math.min(1, r.w));
        const h = Math.max(0.05, Math.min(1, r.h));
        return { x: Math.max(0, Math.min(1 - w, r.x)), y: Math.max(0, Math.min(1 - h, r.y)), w, h };
    };

    // Verrouille la hauteur sur la largeur selon l'aspect choisi (en px image).
    const lockAspect = useCallback((r: { x: number; y: number; w: number; h: number }, aspect: number | null) => {
        const img = cropImgRef.current;
        if (!aspect || !img || !img.naturalWidth) return r;
        const W = img.naturalWidth, H = img.naturalHeight;
        const h = (r.w * W) / (aspect * H);
        return clampRect({ ...r, h });
    }, []);

    const startCropDrag = useCallback((e: React.PointerEvent, mode: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (!cropRect) return;
        cropDragRef.current = { mode, startX: e.clientX, startY: e.clientY, rect: { ...cropRect } };

        const onMove = (ev: PointerEvent) => {
            const drag = cropDragRef.current;
            const img = cropImgRef.current;
            if (!drag || !img) return;
            const b = img.getBoundingClientRect();
            const dx = (ev.clientX - drag.startX) / b.width;
            const dy = (ev.clientY - drag.startY) / b.height;
            let r = { ...drag.rect };
            if (drag.mode === 'move') {
                r.x += dx; r.y += dy;
            } else {
                if (drag.mode.includes('w')) { r.x += dx; r.w -= dx; }
                if (drag.mode.includes('e')) { r.w += dx; }
                if (drag.mode.includes('n')) { r.y += dy; r.h -= dy; }
                if (drag.mode.includes('s')) { r.h += dy; }
                if (r.w < 0.05) r.w = 0.05;
                if (r.h < 0.05) r.h = 0.05;
            }
            setCropRect(clampRect(cropAspect && drag.mode !== 'move' ? lockAspect(r, cropAspect) : r));
        };
        const onUp = () => {
            cropDragRef.current = null;
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [cropRect, cropAspect, lockAspect]);

    const applyCropNow = useCallback(async (rect: { x: number; y: number; w: number; h: number } | null) => {
        if (!activePhoto) return;
        setApplyingCrop(true);
        try {
            const r = await window.api.applyCrop(activePhoto.id, rect);
            if (r?.photo) updatePhoto(activePhoto.id, r.photo);
            // Le crop vit dans develop_settings : garde l'état local cohérent
            // pour qu'un « Sauvegarder » des réglages n'écrase pas le recadrage.
            setSettings(prev => ({ ...(prev as any), crop: rect || undefined } as any));
            setCropMode(false);
            setImgVersion(v => v + 1);
        } catch (e) {
            console.error('applyCrop failed:', e);
        }
        setApplyingCrop(false);
    }, [activePhoto, updatePhoto]);

    // ---- Suppression d'objet (LaMa, 100 % local) --------------------------
    // On peint un masque sur l'image ; le résultat va sur la COPIE LIÉE (créée
    // au besoin) — l'original n'est jamais modifié.
    const [removeMode, setRemoveMode] = useState(false);
    const [brushSize, setBrushSize] = useState(40);
    const [removing, setRemoving] = useState(false);
    const [removeStatus, setRemoveStatus] = useState('');
    const [removeNotice, setRemoveNotice] = useState('');
    const [hasStrokes, setHasStrokes] = useState(false);
    const paintCanvasRef = useRef<HTMLCanvasElement>(null);
    const paintImgRef = useRef<HTMLImageElement>(null);
    const paintingRef = useRef(false);

    useEffect(() => {
        if (!removeMode) return;
        const unsub = window.api.onInpaintProgress((p) => {
            if (p.phase === 'download') setRemoveStatus(`Téléchargement du modèle IA (une seule fois)… ${p.pct ?? 0}%`);
            else if (p.phase === 'inpaint') setRemoveStatus('Suppression en cours (IA locale)…');
        });
        return unsub;
    }, [removeMode]);

    const initPaintCanvas = useCallback(() => {
        const img = paintImgRef.current, canvas = paintCanvasRef.current;
        if (!img || !canvas || !img.naturalWidth) return;
        const scale = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight));
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
        setHasStrokes(false);
    }, []);

    const paintPos = (e: React.PointerEvent) => {
        const canvas = paintCanvasRef.current!;
        const b = canvas.getBoundingClientRect();
        return {
            x: ((e.clientX - b.left) * canvas.width) / b.width,
            y: ((e.clientY - b.top) * canvas.height) / b.height,
            scale: canvas.width / b.width
        };
    };
    const paintStart = (e: React.PointerEvent) => {
        if (removing) return;
        e.preventDefault();
        paintingRef.current = true;
        const ctx = paintCanvasRef.current!.getContext('2d')!;
        const { x, y, scale } = paintPos(e);
        ctx.strokeStyle = 'rgba(255,45,100,0.6)';
        ctx.fillStyle = 'rgba(255,45,100,0.6)';
        ctx.lineWidth = brushSize * scale;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.arc(x, y, (brushSize * scale) / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x, y);
        setHasStrokes(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
    };
    const paintMove = (e: React.PointerEvent) => {
        if (!paintingRef.current) return;
        const ctx = paintCanvasRef.current!.getContext('2d')!;
        const { x, y } = paintPos(e);
        ctx.lineTo(x, y);
        ctx.stroke();
    };
    const paintEnd = () => { paintingRef.current = false; };

    const submitRemove = async () => {
        if (!activePhoto || !paintCanvasRef.current) return;
        // Masque binaire : blanc où c'est peint, noir ailleurs.
        const src = paintCanvasRef.current;
        const m = document.createElement('canvas');
        m.width = src.width; m.height = src.height;
        const mctx = m.getContext('2d')!;
        const px = src.getContext('2d')!.getImageData(0, 0, src.width, src.height);
        const out = mctx.createImageData(m.width, m.height);
        for (let i = 0; i < px.data.length; i += 4) {
            const v = px.data[i + 3] > 10 ? 255 : 0;
            out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
            out.data[i + 3] = 255;
        }
        mctx.putImageData(out, 0, 0);
        const base64 = m.toDataURL('image/png').split(',')[1];

        setRemoving(true);
        setRemoveStatus('Suppression en cours (IA locale)…');
        try {
            const r = await window.api.removeObject(activePhoto.id, base64);
            if (r.success) {
                setRemoveMode(false);
                setRemoveStatus('');
                // The result lives on the linked copy — SHOW it. Staying on the
                // untouched original made a successful removal look like a no-op.
                if (r.appliedToCopy && r.targetPhotoId) {
                    const copyRow = await window.api.getPhoto(r.targetPhotoId);
                    const st = useCatalogStore.getState();
                    if (copyRow && !st.photos.find(ph => ph.id === copyRow.id)) {
                        st.setPhotos([...st.photos, copyRow]);
                    }
                    st.setActivePhotoId(r.targetPhotoId);
                }
                setImgVersion(v => v + 1);
                setRemoveNotice(r.appliedToCopy
                    ? 'Objet supprimé ✨ — tu regardes maintenant la copie liée ; ton original est intact juste à côté.'
                    : 'Objet supprimé ✨');
                setTimeout(() => setRemoveNotice(''), 9000);
            } else {
                setRemoveStatus(`⚠️ ${r.error || 'Échec'}`);
            }
        } catch (e: any) {
            setRemoveStatus('⚠️ ' + String(e?.message || e));
        }
        setRemoving(false);
    };

    // ---- Calibration des couleurs à la carte grise ------------------------
    // Clique sur une zone neutre : on calcule les gains R/B qui la rendent
    // grise (vert ancré à 1), stockés dans develop_settings.wb et cuits dans
    // les vignettes — non destructif, réversible, synchronisable en lot.
    const [wbPickMode, setWbPickMode] = useState(false);
    const [wbBusy, setWbBusy] = useState(false);
    const [wbNotice, setWbNotice] = useState('');
    const [syncBusy, setSyncBusy] = useState(false);
    const [syncProgress, setSyncProgress] = useState<{ current: number; total: number } | null>(null);
    const selectedIds = useCatalogStore((st) => st.selectedPhotoIds);
    const hasWb = (() => {
        try {
            const ds = activePhoto?.develop_settings ? JSON.parse(activePhoto.develop_settings as any) : null;
            return !!ds?.wb;
        } catch { return false; }
    })();

    const handleWbPick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
        if (!wbPickMode || !activePhoto || !imageSrc || wbBusy) return;
        const rect = (e.currentTarget as HTMLImageElement).getBoundingClientRect();
        const relX = (e.clientX - rect.left) / rect.width;
        const relY = (e.clientY - rect.top) / rect.height;
        setWbBusy(true);
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = async () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(img, 0, 0);
                const cx = Math.round(relX * img.width), cy = Math.round(relY * img.height);
                const S = 9;
                const x0 = Math.max(0, cx - S), y0 = Math.max(0, cy - S);
                const d = ctx.getImageData(x0, y0, Math.min(2 * S, img.width - x0), Math.min(2 * S, img.height - y0)).data;
                let r = 0, g = 0, b = 0, n = 0;
                for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
                r /= n; g /= n; b /= n;
                const lum = 0.299 * r + 0.587 * g + 0.114 * b;
                if (lum < 12 || lum > 248) {
                    setWbNotice('⚠️ Zone trop sombre ou brûlée — clique sur ta carte grise (gris moyen).');
                    setTimeout(() => setWbNotice(''), 6000);
                    setWbBusy(false);
                    return;
                }
                const gains = {
                    r: Math.max(0.4, Math.min(2.5, g / Math.max(1, r))),
                    b: Math.max(0.4, Math.min(2.5, g / Math.max(1, b)))
                };
                const res = await window.api.applyWhiteBalance(activePhoto.id, gains);
                if (res?.photo) updatePhoto(activePhoto.id, res.photo);
                setSettings(prev => ({ ...(prev as any), wb: gains } as any));
                setWbPickMode(false);
                setImgVersion(v => v + 1);
                const others = [...selectedIds].filter(id => id !== activePhoto.id).length;
                setWbNotice(`🎯 Calibré sur ta carte grise (R×${gains.r.toFixed(2)}, B×${gains.b.toFixed(2)})${others > 0 ? ` — clique « Sync » pour l'appliquer aux ${others} autres sélectionnées.` : ''}`);
                setTimeout(() => setWbNotice(''), 10000);
            } catch (err: any) {
                setWbNotice('⚠️ ' + String(err?.message || err));
            }
            setWbBusy(false);
        };
        img.onerror = () => { setWbBusy(false); setWbNotice("⚠️ Impossible de lire l'image"); };
        img.src = imageSrc;
    }, [wbPickMode, activePhoto, imageSrc, wbBusy, selectedIds, updatePhoto]);

    const handleResetWb = useCallback(async () => {
        if (!activePhoto) return;
        setWbBusy(true);
        const res = await window.api.applyWhiteBalance(activePhoto.id, null);
        if (res?.photo) updatePhoto(activePhoto.id, res.photo);
        setSettings(prev => { const c: any = { ...(prev as any) }; delete c.wb; return c; });
        setImgVersion(v => v + 1);
        setWbBusy(false);
        setWbNotice('Calibration réinitialisée — couleurs d\'origine restaurées.');
        setTimeout(() => setWbNotice(''), 6000);
    }, [activePhoto, updatePhoto]);

    const handleSyncCalibration = useCallback(async () => {
        if (!activePhoto) return;
        const targets = [...selectedIds].filter(id => id !== activePhoto.id);
        if (targets.length === 0) {
            setWbNotice('Sélectionne d\'abord dans la grille les photos à synchroniser (⌘-clic), puis reviens ici.');
            setTimeout(() => setWbNotice(''), 8000);
            return;
        }
        setSyncBusy(true);
        setSyncProgress({ current: 0, total: targets.length });
        const unsub = window.api.onCalibrationProgress(pr => setSyncProgress(pr));
        try {
            const r = await window.api.syncCalibration(activePhoto.id, targets);
            setWbNotice(`✓ Calibration synchronisée sur ${r.synced ?? 0} photo(s).`);
            setTimeout(() => setWbNotice(''), 8000);
        } catch (e: any) {
            setWbNotice('⚠️ ' + String(e?.message || e));
        }
        unsub();
        setSyncBusy(false);
        setSyncProgress(null);
    }, [activePhoto, selectedIds]);

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
            } else if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
                // Cmd/Ctrl+0 resets zoom; a bare 0 is the global "clear rating"
                // shortcut and must not also refit the view.
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
                    <button onClick={() => setViewMode('grid')} className="px-4 py-2 bg-white/10 text-white rounded hover:bg-white/20">
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
                            className={`w-12 h-12 rounded overflow-hidden transition-all ${photo.id === activePhotoId ? 'ring-2 ring-white/40 scale-105' : 'opacity-60 hover:opacity-100'}`}
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
                            <span className="text-xs bg-white/10 text-gray-300 px-2 py-0.5 rounded">
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
                        <button onClick={() => (cropMode ? setCropMode(false) : enterCropMode())}
                            title="Recadrer (non destructif — réversible à tout moment)"
                            className={`p-2 rounded ${cropMode ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            <Crop size={16} />
                        </button>
                        <button onClick={() => { if (removeMode) { setRemoveMode(false); } else { setCropMode(false); setWbPickMode(false); setRemoveMode(true); setRemoveStatus(''); } }}
                            title="Supprimer un objet (IA locale — résultat sur la copie liée, original intact)"
                            className={`p-2 rounded ${removeMode ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            <Eraser size={16} />
                        </button>
                        <button onClick={() => { setCropMode(false); setRemoveMode(false); setWbPickMode(v => !v); }}
                            title="Calibration des couleurs : active puis clique sur ta carte grise (non destructif, réversible)"
                            className={`p-2 rounded ${wbPickMode ? 'bg-white/15 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            <Pipette size={16} />
                        </button>
                        <button onClick={handleSyncCalibration} disabled={syncBusy || !hasWb}
                            title="Synchroniser la calibration sur toutes les photos sélectionnées dans la grille"
                            className={`px-2 py-1.5 rounded text-xs ${hasWb ? 'text-gray-300 hover:text-white hover:bg-gray-700' : 'text-gray-600'}`}>
                            {syncBusy && syncProgress ? `Sync ${syncProgress.current}/${syncProgress.total}…` : 'Sync'}
                        </button>
                        {hasWb && (
                            <button onClick={handleResetWb} disabled={wbBusy}
                                title="Retirer la calibration (couleurs d'origine)"
                                className="px-1.5 py-1.5 rounded text-[10px] text-gray-500 hover:text-white hover:bg-gray-700">
                                réinit.
                            </button>
                        )}
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={() => setShowBefore(!showBefore)}
                            title="Avant/Apres (\\)"
                            className={`p-2 rounded ${showBefore ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}>
                            {showBefore ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <div className="w-px h-4 bg-gray-600 mx-1" />
                        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded" title="Zoom - (-)">
                            <ZoomOut size={16} />
                        </button>
                        <button onClick={() => setZoom(1)} className="text-xs text-gray-400 w-12 text-center hover:text-white cursor-pointer" title="Reset zoom (⌘0)">
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
                    {removeMode ? (
                        <div className="flex flex-col items-center gap-3 max-w-full max-h-full">
                            <div className="flex items-center gap-3 text-xs">
                                <span className="text-gray-400">Pinceau</span>
                                <input type="range" min={10} max={120} value={brushSize}
                                    onChange={e => setBrushSize(parseInt(e.target.value))} className="w-28" disabled={removing} />
                                <button onClick={initPaintCanvas} disabled={removing}
                                    className="px-2 py-1 rounded text-gray-300 hover:bg-white/10">Effacer le masque</button>
                                <button onClick={submitRemove} disabled={removing || !hasStrokes}
                                    className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
                                    {removing ? 'Suppression…' : "✨ Supprimer l'objet"}
                                </button>
                                <button onClick={() => setRemoveMode(false)} disabled={removing}
                                    className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700" title="Annuler">
                                    <XIcon size={14} />
                                </button>
                            </div>
                            <div className="relative inline-block select-none">
                                <img ref={paintImgRef} src={imageSrc || ''} alt="" draggable={false}
                                    onLoad={initPaintCanvas} className="max-w-full block"
                                    style={{ maxHeight: 'calc(100vh - 240px)' }} />
                                <canvas
                                    ref={paintCanvasRef}
                                    onPointerDown={paintStart}
                                    onPointerMove={paintMove}
                                    onPointerUp={paintEnd}
                                    onPointerLeave={paintEnd}
                                    className="absolute inset-0 w-full h-full"
                                    style={{ cursor: 'crosshair', touchAction: 'none' }}
                                />
                            </div>
                            <div className="text-[11px] text-gray-500 max-w-lg text-center">
                                Peins sur ce que tu veux enlever, puis « Supprimer l'objet ». 100 % local (LaMa) —
                                le résultat va sur la <b>copie liée</b>, ton original reste intact.
                                {removeStatus && <div className="mt-1 text-gray-300">{removeStatus}</div>}
                            </div>
                        </div>
                    ) : cropMode ? (
                        <div className="flex flex-col items-center gap-3 max-w-full max-h-full">
                            {/* Barre du recadrage */}
                            <div className="flex items-center gap-2 text-xs">
                                <span className="text-gray-400 mr-1">Ratio :</span>
                                {([
                                    { label: 'Libre', v: null },
                                    { label: 'Original', v: (cropImgRef.current?.naturalWidth || 3) / (cropImgRef.current?.naturalHeight || 2) },
                                    { label: '1:1', v: 1 },
                                    { label: '3:2', v: 3 / 2 },
                                    { label: '4:5', v: 4 / 5 },
                                    { label: '16:9', v: 16 / 9 },
                                ] as { label: string; v: number | null }[]).map(a => (
                                    <button key={a.label}
                                        onClick={() => { setCropAspect(a.v); if (cropRect) setCropRect(r => lockAspect(r!, a.v)); }}
                                        className={`px-2 py-1 rounded border ${cropAspect === a.v ? 'border-white/40 bg-white/10 text-white' : 'border-[#444] text-gray-400 hover:border-[#666]'}`}>
                                        {a.label}
                                    </button>
                                ))}
                                <div className="w-px h-4 bg-gray-600 mx-1" />
                                <button onClick={() => cropRect && applyCropNow(cropRect)} disabled={applyingCrop || !cropRect}
                                    className="px-3 py-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50">
                                    {applyingCrop ? 'Application…' : 'Appliquer'}
                                </button>
                                {hasSavedCrop && (
                                    <button onClick={() => applyCropNow(null)} disabled={applyingCrop}
                                        title="Revenir à l'image complète — le fichier original n'a jamais été modifié"
                                        className="px-3 py-1 rounded bg-white/10 hover:bg-white/20 text-gray-200">
                                        Image complète
                                    </button>
                                )}
                                <button onClick={() => setCropMode(false)} disabled={applyingCrop}
                                    className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700" title="Annuler">
                                    <XIcon size={14} />
                                </button>
                            </div>

                            {/* Image complète + rectangle de recadrage */}
                            <div className="relative inline-block overflow-hidden select-none" style={{ maxWidth: '100%', maxHeight: 'calc(100% - 40px)' }}>
                                {!uncroppedSrc ? (
                                    <div className="w-[480px] h-[320px] flex items-center justify-center text-gray-500 text-sm">Préparation de l'image complète…</div>
                                ) : (
                                    <>
                                        <img
                                            ref={cropImgRef}
                                            src={uncroppedSrc}
                                            alt=""
                                            draggable={false}
                                            className="max-w-full block"
                                            style={{ maxHeight: 'calc(100vh - 220px)' }}
                                        />
                                        {cropRect && (
                                            <div
                                                onPointerDown={(e) => startCropDrag(e, 'move')}
                                                className="absolute border-2 border-white/90 cursor-move"
                                                style={{
                                                    left: `${cropRect.x * 100}%`,
                                                    top: `${cropRect.y * 100}%`,
                                                    width: `${cropRect.w * 100}%`,
                                                    height: `${cropRect.h * 100}%`,
                                                    boxShadow: '0 0 0 100000px rgba(0,0,0,0.55)',
                                                }}
                                            >
                                                {/* Grille des tiers */}
                                                <div className="absolute inset-0 pointer-events-none opacity-40">
                                                    <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white" />
                                                    <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white" />
                                                    <div className="absolute top-1/3 left-0 right-0 h-px bg-white" />
                                                    <div className="absolute top-2/3 left-0 right-0 h-px bg-white" />
                                                </div>
                                                {/* Poignées d'angle */}
                                                {(['nw', 'ne', 'sw', 'se'] as const).map(c => (
                                                    <div key={c}
                                                        onPointerDown={(e) => startCropDrag(e, c)}
                                                        className="absolute w-4 h-4 bg-white rounded-sm"
                                                        style={{
                                                            left: c.includes('w') ? -8 : undefined,
                                                            right: c.includes('e') ? -8 : undefined,
                                                            top: c.includes('n') ? -8 : undefined,
                                                            bottom: c.includes('s') ? -8 : undefined,
                                                            cursor: c === 'nw' || c === 'se' ? 'nwse-resize' : 'nesw-resize',
                                                        }}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            <div className="text-[11px] text-gray-500">
                                Recadrage <b>non destructif</b> : ton fichier original n'est jamais modifié — reviens quand tu veux avec « Image complète ».
                            </div>
                        </div>
                    ) : (
                    <div className="relative inline-block">
                        <img
                            key={imgVersion}
                            src={imageSrc || ''}
                            alt={activePhoto.file_name}
                            onClick={handleWbPick}
                            className="max-w-full object-contain"
                            style={{
                                cursor: wbPickMode ? 'crosshair' : undefined,
                                // Fit the whole photo by default: the wrapper's
                                // height is content-driven so max-h-full never
                                // bit — portrait photos overflowed and scrolled.
                                maxHeight: 'calc(100vh - 170px)',
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
                    )}
                </div>

                {wbPickMode && (
                    <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 glass-strong text-white text-sm px-5 py-2.5 rounded-lg shadow-2xl">
                        🎯 Clique sur ta <b>carte grise</b> (ou une zone neutre) dans la photo{wbBusy ? ' — analyse…' : ''}
                    </div>
                )}
                {wbNotice && (
                    <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-40 glass-strong text-white text-sm px-5 py-2.5 rounded-lg shadow-2xl max-w-2xl text-center">
                        {wbNotice}
                    </div>
                )}
                {removeNotice && (
                    <div className="absolute bottom-12 left-1/2 -translate-x-1/2 z-40 glass-strong text-white text-sm px-5 py-2.5 rounded-lg shadow-2xl">
                        {removeNotice}
                    </div>
                )}

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
