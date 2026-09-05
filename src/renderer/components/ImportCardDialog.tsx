import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { X, Camera, FolderOpen, Tag, Check, Loader2, ImageOff, CheckSquare, Square, Sparkles } from 'lucide-react';
import { getImageUrl } from '../utils/imageUrl';

// One photo found on the card, as returned by import:scanCard.
interface CardFile {
    path: string;
    name: string;
    size: number;
    mtimeMs: number;
    ext: string;
    isRaw: boolean;
    alreadyImported: boolean;
}

interface ImportCardDialogProps {
    isOpen: boolean;
    dcimPath: string;
    volumeName: string;
    onClose: () => void;
    onImported: () => void; // parent refreshes the library
}

const formatBytes = (n: number) => {
    if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} Go`;
    if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} Mo`;
    return `${Math.round(n / 1024)} Ko`;
};

// How many previews to generate at once. The card is slow; keep it gentle.
const PREVIEW_CONCURRENCY = 3;

export const ImportCardDialog: React.FC<ImportCardDialogProps> = ({
    isOpen, dcimPath, volumeName, onClose, onImported
}) => {
    const [phase, setPhase] = useState<'scanning' | 'ready' | 'importing' | 'done' | 'error'>('scanning');
    const [files, setFiles] = useState<CardFile[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [previews, setPreviews] = useState<Record<string, string | null>>({});
    const [progress, setProgress] = useState<{ current: number; total: number; file?: string }>({ current: 0, total: 0 });
    const [result, setResult] = useState<{ imported: number; skipped: number; errors: string[] } | null>(null);
    const [scanError, setScanError] = useState('');

    const [destination, setDestination] = useState(() => localStorage.getItem('lastImportDestination') || '');
    const [subfolder, setSubfolder] = useState('');
    const [keywordsInput, setKeywordsInput] = useState('');
    const [deleteAfter, setDeleteAfter] = useState(false);
    const [freeSpace, setFreeSpace] = useState<number | null>(null);
    // Live copy telemetry (speed + bytes) from the fast copy phase.
    const [copyStats, setCopyStats] = useState<{ copiedBytes: number; totalBytes: number; mbps: number } | null>(null);

    // Bumped on close so in-flight preview loops from a previous open stop cleanly.
    const generationRef = useRef(0);

    // Scan the card when the dialog opens.
    useEffect(() => {
        if (!isOpen) return;
        const gen = ++generationRef.current;
        setPhase('scanning');
        setFiles([]);
        setPreviews({});
        setResult(null);
        setScanError('');
        const now = new Date();
        setSubfolder(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);

        // Respect the current library: default to its root (where the "Année
        // XXXX" folders live) unless the remembered destination is already
        // inside it. A stale path on another disk/root is never reused blindly.
        window.api.getLibraryRoot().then((root: string) => {
            if (generationRef.current !== gen || !root) return;
            setDestination(prev => (prev && prev.startsWith(root)) ? prev : root);
        }).catch(() => { /* keep whatever we have */ });

        window.api.scanCard(dcimPath).then((scanned: CardFile[]) => {
            if (generationRef.current !== gen) return;
            setFiles(scanned);
            // Everything new is pre-selected; already-imported photos start unchecked.
            setSelected(new Set(scanned.filter(f => !f.alreadyImported).map(f => f.path)));
            // Library-style destination: "Année <année de la prise de vue>/<date
            // du jour>" — recognized from the newest photo on the card, so the
            // dated folder lands in the right year automatically.
            const shootYear = scanned.length
                ? new Date(Math.max(...scanned.map(f => f.mtimeMs))).getFullYear()
                : now.getFullYear();
            const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
            setSubfolder(`Année ${shootYear}/${dateStr}`);
            setPhase('ready');
        }).catch((e: any) => {
            if (generationRef.current !== gen) return;
            setScanError(String(e?.message || e));
            setPhase('error');
        });

        return () => { generationRef.current++; };
    }, [isOpen, dcimPath]);

    // Stream previews progressively: a small worker pool walks the listing order.
    useEffect(() => {
        if (phase !== 'ready' || files.length === 0) return;
        const gen = generationRef.current;
        let index = 0;

        const worker = async () => {
            while (generationRef.current === gen && index < files.length) {
                const file = files[index++];
                if (previews[file.path] !== undefined) continue;
                try {
                    const p = await window.api.cardPreview(file.path);
                    if (generationRef.current !== gen) return;
                    setPreviews(prev => ({ ...prev, [file.path]: p }));
                } catch {
                    if (generationRef.current !== gen) return;
                    setPreviews(prev => ({ ...prev, [file.path]: null }));
                }
            }
        };
        for (let i = 0; i < PREVIEW_CONCURRENCY; i++) void worker();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, files]);

    // Watchdog: how much room the destination volume actually has.
    useEffect(() => {
        if (!isOpen || !destination) { setFreeSpace(null); return; }
        let cancelled = false;
        window.api.getFreeSpace(destination).then(r => { if (!cancelled) setFreeSpace(r?.free ?? null); });
        return () => { cancelled = true; };
    }, [isOpen, destination, phase]);

    // Live progress from the import pipeline (copy phase carries bytes + speed).
    useEffect(() => {
        if (!isOpen) return;
        const unsubscribe = window.api.onImportProgress((p: any) => {
            if (p.phase === 'copying' || p.phase === 'importing' || p.phase === 'thumbnails') {
                setProgress({ current: p.current || 0, total: p.total || 0, file: p.currentFile });
                if (p.phase === 'copying' && p.totalBytes) {
                    setCopyStats({ copiedBytes: p.copiedBytes || 0, totalBytes: p.totalBytes, mbps: p.mbps || 0 });
                } else if (p.phase !== 'copying') {
                    setCopyStats(null);
                }
            }
        });
        return unsubscribe;
    }, [isOpen]);

    const toggle = useCallback((path: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path); else next.add(path);
            return next;
        });
    }, []);

    const selectedFiles = useMemo(() => files.filter(f => selected.has(f.path)), [files, selected]);
    const selectedBytes = useMemo(() => selectedFiles.reduce((s, f) => s + f.size, 0), [selectedFiles]);
    const SPACE_MARGIN = 1024 ** 3; // the import keeps 1 GB free, mirror it here
    const spaceOk = freeSpace == null || selectedBytes + SPACE_MARGIN <= freeSpace;
    const missingBytes = freeSpace == null ? 0 : Math.max(0, selectedBytes + SPACE_MARGIN - freeSpace);
    const newCount = useMemo(() => files.filter(f => !f.alreadyImported).length, [files]);

    const handleImport = async () => {
        if (selectedFiles.length === 0 || !destination) return;
        localStorage.setItem('lastImportDestination', destination);
        setPhase('importing');
        setProgress({ current: 0, total: selectedFiles.length });
        try {
            const keywords = keywordsInput.split(',').map(k => k.trim()).filter(Boolean);
            const destinationPath = `${destination.replace(/\/+$/, '')}${subfolder ? '/' + subfolder : ''}`;
            const r = await window.api.importFiles(selectedFiles.map(f => f.path), {
                destinationPath,
                generateThumbnails: true,
                extractMetadata: true,
                keywords,
                deleteAfterImport: deleteAfter
            });
            setResult({
                imported: r?.importedIds?.length ?? 0,
                skipped: r?.skippedFiles?.length ?? 0,
                errors: (r?.errors || []).map((e: any) => `${e.file?.split('/').pop()}: ${e.error}`)
            });
            setPhase('done');
            onImported();
        } catch (e: any) {
            setResult({ imported: 0, skipped: 0, errors: [String(e?.message || e)] });
            setPhase('done');
        }
    };

    if (!isOpen) return null;

    const busy = phase === 'importing';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose} />

            {/* Keystrokes stay inside the dialog — global g/e/n… shortcuts must not fire. */}
            <div
                className="relative glass-strong rounded-xl shadow-2xl w-[92vw] max-w-[1200px] h-[86vh] flex flex-col overflow-hidden"
                onKeyDown={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                        <Camera size={22} className="text-gray-200" />
                        <div>
                            <h2 className="text-base font-semibold text-white">Importer depuis {volumeName}</h2>
                            <p className="text-xs text-gray-400">
                                {phase === 'scanning'
                                    ? 'Lecture de la carte…'
                                    : `${files.length} photos sur la carte · ${newCount} nouvelles · ${selected.size} sélectionnées (${formatBytes(selectedBytes)})`}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        disabled={busy}
                        className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded disabled:opacity-40"
                    >
                        <X size={18} />
                    </button>
                </div>

                <div className="flex-1 flex min-h-0">
                    {/* Visual grid */}
                    <div className="flex-1 flex flex-col min-w-0 border-r border-white/10">
                        {/* Selection toolbar */}
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 text-xs">
                            <button
                                onClick={() => setSelected(new Set(files.map(f => f.path)))}
                                disabled={busy || files.length === 0}
                                className="flex items-center gap-1.5 px-2 py-1 rounded text-gray-300 hover:bg-white/10 hover:text-white"
                            >
                                <CheckSquare size={13} /> Tout
                            </button>
                            <button
                                onClick={() => setSelected(new Set())}
                                disabled={busy || files.length === 0}
                                className="flex items-center gap-1.5 px-2 py-1 rounded text-gray-300 hover:bg-white/10 hover:text-white"
                            >
                                <Square size={13} /> Aucune
                            </button>
                            <button
                                onClick={() => setSelected(new Set(files.filter(f => !f.alreadyImported).map(f => f.path)))}
                                disabled={busy || files.length === 0}
                                className="flex items-center gap-1.5 px-2 py-1 rounded text-gray-300 hover:bg-white/10 hover:text-white"
                            >
                                <Sparkles size={13} /> Nouvelles seulement
                            </button>
                        </div>

                        {/* Grid */}
                        <div className="flex-1 overflow-y-auto p-3">
                            {phase === 'scanning' && (
                                <div className="h-full flex items-center justify-center text-gray-400 gap-2">
                                    <Loader2 size={18} className="animate-spin" /> Lecture de la carte…
                                </div>
                            )}
                            {phase === 'error' && (
                                <div className="h-full flex items-center justify-center text-red-400 text-sm px-8 text-center">
                                    Impossible de lire la carte : {scanError}
                                </div>
                            )}
                            {phase !== 'scanning' && phase !== 'error' && files.length === 0 && (
                                <div className="h-full flex items-center justify-center text-gray-500">
                                    Aucune photo trouvée sur la carte.
                                </div>
                            )}
                            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))' }}>
                                {files.map(file => {
                                    const isSelected = selected.has(file.path);
                                    const preview = previews[file.path];
                                    return (
                                        <div
                                            key={file.path}
                                            onClick={() => !busy && toggle(file.path)}
                                            className={`relative rounded-lg overflow-hidden cursor-pointer border-2 transition-colors ${isSelected ? 'border-white/70' : 'border-transparent opacity-70 hover:opacity-100'}`}
                                            style={{ background: '#141414' }}
                                        >
                                            <div className="aspect-square flex items-center justify-center">
                                                {preview === undefined && (
                                                    <Loader2 size={18} className="animate-spin text-gray-600" />
                                                )}
                                                {preview === null && (
                                                    <div className="flex flex-col items-center gap-1 text-gray-600">
                                                        <ImageOff size={20} />
                                                        <span className="text-[10px]">{file.ext.replace('.', '').toUpperCase()}</span>
                                                    </div>
                                                )}
                                                {preview && (
                                                    <img
                                                        src={getImageUrl(preview)}
                                                        alt=""
                                                        decoding="async"
                                                        loading="lazy"
                                                        className="w-full h-full object-cover"
                                                    />
                                                )}
                                            </div>

                                            {/* Checkbox */}
                                            <div className={`absolute top-1.5 left-1.5 w-5 h-5 rounded flex items-center justify-center ${isSelected ? 'bg-white text-black' : 'bg-black/50 border border-white/40 text-transparent'}`}>
                                                <Check size={14} strokeWidth={3} />
                                            </div>

                                            {/* Badges */}
                                            <div className="absolute top-1.5 right-1.5 flex flex-col items-end gap-1">
                                                {file.isRaw && (
                                                    <span className="px-1 py-px rounded bg-black/60 text-[9px] font-bold text-white">RAW</span>
                                                )}
                                                {file.alreadyImported && (
                                                    <span className="px-1 py-px rounded bg-amber-500/85 text-[9px] font-semibold text-black">Déjà importée</span>
                                                )}
                                            </div>

                                            {/* Name + size */}
                                            <div className="px-1.5 py-1 text-[10px] text-gray-400 truncate bg-black/40">
                                                {file.name} · {formatBytes(file.size)}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Options panel */}
                    <div className="w-[290px] flex flex-col p-4 gap-4 overflow-y-auto">
                        {phase === 'done' && result ? (
                            <div className="flex-1 flex flex-col gap-3">
                                <div className="text-sm text-white font-medium">Import terminé</div>
                                <div className="text-sm text-gray-300 space-y-1">
                                    <div>✅ {result.imported} importées</div>
                                    {result.skipped > 0 && <div>⏭️ {result.skipped} ignorées (déjà dans le catalogue)</div>}
                                    {result.errors.length > 0 && (
                                        <div className="text-red-400">
                                            ⚠️ {result.errors.length} erreur(s)
                                            <ul className="mt-1 text-xs text-red-300/80 space-y-0.5">
                                                {result.errors.slice(0, 5).map((e, i) => <li key={i} className="truncate">{e}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={onClose}
                                    className="mt-auto py-2 rounded bg-white/10 hover:bg-white/15 text-white text-sm"
                                >
                                    Fermer
                                </button>
                            </div>
                        ) : (
                            <>
                                <div>
                                    <label className="flex items-center gap-2 text-xs font-medium text-gray-400 mb-1.5">
                                        <FolderOpen size={14} /> Destination
                                    </label>
                                    <div className="flex gap-1.5">
                                        <input
                                            value={destination}
                                            onChange={e => setDestination(e.target.value)}
                                            disabled={busy}
                                            placeholder="Choisis un dossier…"
                                            className="flex-1 min-w-0 px-2.5 py-1.5 bg-black/40 border border-white/15 rounded text-xs text-white"
                                        />
                                        <button
                                            onClick={async () => {
                                                const r = await window.api.openDirectoryDialog();
                                                if (r) setDestination(r);
                                            }}
                                            disabled={busy}
                                            className="px-2.5 py-1.5 bg-white/10 hover:bg-white/15 text-white rounded text-xs"
                                        >
                                            …
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <label className="block text-xs font-medium text-gray-400 mb-1.5">Sous-dossier</label>
                                    <input
                                        value={subfolder}
                                        onChange={e => setSubfolder(e.target.value)}
                                        disabled={busy}
                                        className="w-full px-2.5 py-1.5 bg-black/40 border border-white/15 rounded text-xs text-white"
                                    />
                                    {destination && (
                                        <p className="mt-1 text-[10px] text-gray-600 break-all">
                                            → {destination.replace(/\/+$/, '')}{subfolder ? '/' + subfolder : ''}
                                        </p>
                                    )}
                                    {destination && freeSpace != null && (
                                        <p className={`mt-1.5 text-[11px] ${spaceOk ? 'text-emerald-400/90' : 'text-red-400'}`}>
                                            {spaceOk
                                                ? `💾 ${formatBytes(freeSpace)} libres — ✓ assez pour la sélection (${formatBytes(selectedBytes)})`
                                                : `⚠️ Espace insuffisant : il manque ${formatBytes(missingBytes)} pour tout copier — décoche des photos ou libère de l'espace.`}
                                        </p>
                                    )}
                                </div>

                                <div>
                                    <label className="flex items-center gap-2 text-xs font-medium text-gray-400 mb-1.5">
                                        <Tag size={14} /> Mots-clés (virgules)
                                    </label>
                                    <input
                                        value={keywordsInput}
                                        onChange={e => setKeywordsInput(e.target.value)}
                                        disabled={busy}
                                        placeholder="mariage, extérieur…"
                                        className="w-full px-2.5 py-1.5 bg-black/40 border border-white/15 rounded text-xs text-white"
                                    />
                                </div>

                                <label className="flex items-start gap-2 cursor-pointer text-xs text-gray-300">
                                    <input
                                        type="checkbox"
                                        checked={deleteAfter}
                                        onChange={e => setDeleteAfter(e.target.checked)}
                                        disabled={busy}
                                        className="mt-0.5"
                                    />
                                    <span>
                                        Supprimer de la carte après import
                                        {deleteAfter && (
                                            <span className="block text-[10px] text-amber-400 mt-0.5">
                                                Chaque fichier n'est effacé qu'une fois sa copie vérifiée.
                                            </span>
                                        )}
                                    </span>
                                </label>

                                <div className="mt-auto space-y-2">
                                    {busy && (
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                                <span className="truncate mr-2">{progress.file || 'Import…'}</span>
                                                <span>{progress.current}/{progress.total}</span>
                                            </div>
                                            {copyStats && (
                                                <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                                                    <span>{formatBytes(copyStats.copiedBytes)} / {formatBytes(copyStats.totalBytes)}</span>
                                                    <span className="text-emerald-400/80">{copyStats.mbps} Mo/s</span>
                                                </div>
                                            )}
                                            <div className="h-1.5 bg-white/10 rounded overflow-hidden">
                                                <div
                                                    className="h-full bg-white/60 transition-all"
                                                    style={{ width: progress.total ? `${(100 * progress.current) / progress.total}%` : '0%' }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                    <button
                                        onClick={handleImport}
                                        disabled={busy || selected.size === 0 || !destination || !spaceOk}
                                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded bg-white/10 hover:bg-white/15 text-white text-sm disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        {busy
                                            ? <><Loader2 size={15} className="animate-spin" /> Import en cours…</>
                                            : <><Check size={15} /> Importer {selected.size} photo{selected.size > 1 ? 's' : ''}</>}
                                    </button>
                                    {!destination && (
                                        <p className="text-[10px] text-gray-500 text-center">Choisis d'abord un dossier de destination.</p>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImportCardDialog;
