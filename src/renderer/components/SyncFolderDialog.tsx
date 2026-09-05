import React, { useState, useEffect } from 'react';
import { X, RefreshCw, Loader2, AlertTriangle, ChevronDown, ChevronRight, Check } from 'lucide-react';

// Lightroom's "Synchronize Folder": the disk is the truth, the user decides.
//  - New photos on disk        → imported in place (checked by default)
//  - Suspected duplicates      → same name+size as a cataloged photo elsewhere:
//                                shown with where the original lives, NOT
//                                imported unless the user opts in
//  - Missing photos            → in the catalog, gone from disk: removed only
//                                if the user asks (loses their ratings/keywords)
interface Analysis {
    newFiles: string[];
    duplicates: { path: string; existingPath: string }[];
    missing: { id: string; path: string }[];
    onDisk: number;
    inCatalog: number;
}

interface Props {
    isOpen: boolean;
    folderPath: string;
    folderName: string;
    onClose: () => void;
    onDone: () => void;
}

const shortPath = (p: string, root: string) => {
    const rel = p.startsWith(root) ? p.slice(root.length).replace(/^\//, '') : p;
    return rel.length > 90 ? '…' + rel.slice(-88) : rel;
};

const Expandable: React.FC<{ title: React.ReactNode; count: number; children: React.ReactNode }> = ({ title, count, children }) => {
    const [open, setOpen] = useState(false);
    return (
        <div>
            <button onClick={() => setOpen(o => !o)} disabled={count === 0}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-40">
                {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} {title}
            </button>
            {open && <div className="mt-1 max-h-40 overflow-y-auto rounded bg-black/30 p-2 text-[10px] font-mono text-gray-400 space-y-0.5">{children}</div>}
        </div>
    );
};

export const SyncFolderDialog: React.FC<Props> = ({ isOpen, folderPath, folderName, onClose, onDone }) => {
    const [phase, setPhase] = useState<'analyzing' | 'ready' | 'running' | 'done' | 'error'>('analyzing');
    const [analysis, setAnalysis] = useState<Analysis | null>(null);
    const [importNew, setImportNew] = useState(true);
    const [importDuplicates, setImportDuplicates] = useState(false);
    const [removeMissing, setRemoveMissing] = useState(false);
    const [progress, setProgress] = useState<{ current: number; total: number; file?: string } | null>(null);
    const [summary, setSummary] = useState<{ imported: number; errors: number; removed: number } | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        let cancelled = false;
        setPhase('analyzing');
        setAnalysis(null);
        setSummary(null);
        setError('');
        setImportNew(true);
        setImportDuplicates(false);
        setRemoveMissing(false);
        window.api.syncAnalyze(folderPath).then(a => {
            if (cancelled) return;
            setAnalysis(a);
            setPhase('ready');
        }).catch(e => {
            if (cancelled) return;
            setError(String(e?.message || e));
            setPhase('error');
        });
        return () => { cancelled = true; };
    }, [isOpen, folderPath]);

    useEffect(() => {
        if (!isOpen) return;
        return window.api.onImportProgress((p: any) => {
            if (p.phase === 'importing') setProgress({ current: p.current || 0, total: p.total || 0, file: p.currentFile });
        });
    }, [isOpen]);

    if (!isOpen) return null;

    const toImport = analysis
        ? [...(importNew ? analysis.newFiles : []), ...(importDuplicates ? analysis.duplicates.map(d => d.path) : [])]
        : [];
    const toRemove = analysis && removeMissing ? analysis.missing.map(m => m.id) : [];
    const nothing = toImport.length === 0 && toRemove.length === 0;

    const run = async () => {
        if (!analysis) return;
        setPhase('running');
        setProgress({ current: 0, total: toImport.length });
        try {
            const r = await window.api.syncRun({ importPaths: toImport, removeMissingIds: toRemove });
            setSummary(r);
            setPhase('done');
            onDone();
        } catch (e: any) {
            setError(String(e?.message || e));
            setPhase('error');
        }
    };

    const busy = phase === 'running';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={busy ? undefined : onClose} />
            <div className="relative glass-strong rounded-xl shadow-2xl w-[640px] max-w-[92vw] max-h-[88vh] flex flex-col overflow-hidden"
                onKeyDown={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                        <RefreshCw size={20} className={`text-gray-200 ${phase === 'analyzing' ? 'animate-spin' : ''}`} />
                        <div>
                            <h2 className="text-base font-semibold text-white">Synchroniser « {folderName} »</h2>
                            <p className="text-xs text-gray-400 truncate max-w-[480px]">{folderPath}</p>
                        </div>
                    </div>
                    <button onClick={onClose} disabled={busy} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded disabled:opacity-40"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-4 overflow-y-auto text-sm">
                    {phase === 'analyzing' && (
                        <div className="flex items-center gap-2 text-gray-300 py-6 justify-center">
                            <Loader2 size={18} className="animate-spin" /> Comparaison du disque et du catalogue…
                        </div>
                    )}
                    {phase === 'error' && <div className="text-red-400">⚠️ {error}</div>}

                    {analysis && phase !== 'analyzing' && phase !== 'done' && (
                        <>
                            <div className="text-xs text-gray-400">
                                Sur le disque : <b className="text-gray-200">{analysis.onDisk}</b> photos · au catalogue : <b className="text-gray-200">{analysis.inCatalog}</b>
                            </div>

                            {/* New photos */}
                            <label className={`flex items-start gap-3 p-3 rounded-lg border ${analysis.newFiles.length ? 'border-white/15 bg-white/5' : 'border-white/5 opacity-50'}`}>
                                <input type="checkbox" className="mt-0.5" checked={importNew && analysis.newFiles.length > 0}
                                    disabled={busy || analysis.newFiles.length === 0} onChange={e => setImportNew(e.target.checked)} />
                                <div className="flex-1 space-y-1">
                                    <div className="text-gray-100">Importer les <b>{analysis.newFiles.length}</b> nouvelles photos</div>
                                    <div className="text-[11px] text-gray-500">Présentes sur le disque, inconnues du catalogue, sans équivalent ailleurs. Importées en place — aucun fichier déplacé.</div>
                                    <Expandable title="voir les fichiers" count={analysis.newFiles.length}>
                                        {analysis.newFiles.slice(0, 200).map(f => <div key={f}>{shortPath(f, folderPath)}</div>)}
                                        {analysis.newFiles.length > 200 && <div>… et {analysis.newFiles.length - 200} autres</div>}
                                    </Expandable>
                                </div>
                            </label>

                            {/* Suspected duplicates */}
                            <label className={`flex items-start gap-3 p-3 rounded-lg border ${analysis.duplicates.length ? 'border-amber-500/30 bg-amber-500/5' : 'border-white/5 opacity-50'}`}>
                                <input type="checkbox" className="mt-0.5" checked={importDuplicates && analysis.duplicates.length > 0}
                                    disabled={busy || analysis.duplicates.length === 0} onChange={e => setImportDuplicates(e.target.checked)} />
                                <div className="flex-1 space-y-1">
                                    <div className="text-gray-100 flex items-center gap-2">
                                        <AlertTriangle size={14} className="text-amber-400" />
                                        Importer aussi les <b>{analysis.duplicates.length}</b> doublons présumés
                                    </div>
                                    <div className="text-[11px] text-gray-500">
                                        Même nom et même taille qu'une photo <b>déjà au catalogue</b> dans un autre dossier — très probablement des copies.
                                        Décochés par défaut : les importer les ferait apparaître en double dans la bibliothèque.
                                    </div>
                                    <Expandable title="voir où sont les originaux" count={analysis.duplicates.length}>
                                        {analysis.duplicates.slice(0, 200).map(d => (
                                            <div key={d.path}>
                                                <span className="text-amber-300/80">{shortPath(d.path, folderPath)}</span>
                                                <span className="text-gray-600"> → déjà : {shortPath(d.existingPath, folderPath)}</span>
                                            </div>
                                        ))}
                                        {analysis.duplicates.length > 200 && <div>… et {analysis.duplicates.length - 200} autres</div>}
                                    </Expandable>
                                </div>
                            </label>

                            {/* Missing */}
                            <label className={`flex items-start gap-3 p-3 rounded-lg border ${analysis.missing.length ? 'border-red-500/30 bg-red-500/5' : 'border-white/5 opacity-50'}`}>
                                <input type="checkbox" className="mt-0.5" checked={removeMissing && analysis.missing.length > 0}
                                    disabled={busy || analysis.missing.length === 0} onChange={e => setRemoveMissing(e.target.checked)} />
                                <div className="flex-1 space-y-1">
                                    <div className="text-gray-100">Retirer du catalogue les <b>{analysis.missing.length}</b> photos dont le fichier a disparu</div>
                                    <div className="text-[11px] text-gray-500">
                                        Au catalogue mais plus sur le disque (déplacées ou supprimées dans le Finder). Ne touche à aucun fichier ;
                                        <span className="text-red-300/80"> leurs notes, mots-clés et libellés seront perdus.</span>
                                    </div>
                                    <Expandable title="voir les fichiers manquants" count={analysis.missing.length}>
                                        {analysis.missing.slice(0, 200).map(m => <div key={m.id}>{shortPath(m.path, folderPath)}</div>)}
                                        {analysis.missing.length > 200 && <div>… et {analysis.missing.length - 200} autres</div>}
                                    </Expandable>
                                </div>
                            </label>

                            {busy && progress && (
                                <div>
                                    <div className="flex justify-between text-[10px] text-gray-400 mb-1">
                                        <span className="truncate mr-2">{progress.file || 'Import…'}</span>
                                        <span>{progress.current}/{progress.total}</span>
                                    </div>
                                    <div className="h-1.5 bg-white/10 rounded overflow-hidden">
                                        <div className="h-full bg-white/60 transition-all" style={{ width: progress.total ? `${(100 * progress.current) / progress.total}%` : '0%' }} />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    {phase === 'done' && summary && (
                        <div className="space-y-2 py-2">
                            <div className="text-white font-medium flex items-center gap-2"><Check size={16} className="text-emerald-400" /> Synchronisation terminée</div>
                            <div className="text-gray-300 text-sm space-y-1">
                                <div>✅ {summary.imported} photo{summary.imported > 1 ? 's' : ''} importée{summary.imported > 1 ? 's' : ''}</div>
                                {summary.removed > 0 && <div>🗑 {summary.removed} entrée{summary.removed > 1 ? 's' : ''} retirée{summary.removed > 1 ? 's' : ''} du catalogue</div>}
                                {summary.errors > 0 && <div className="text-red-400">⚠️ {summary.errors} erreur{summary.errors > 1 ? 's' : ''}</div>}
                            </div>
                            {summary.imported > 0 && (
                                <div className="text-[11px] text-gray-500">Les vignettes se construisent en arrière-plan — les photos apparaissent au fur et à mesure dans la grille.</div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-white/10">
                    {phase === 'done' ? (
                        <button onClick={onClose} className="px-4 py-2 text-sm rounded bg-white/10 hover:bg-white/15 text-white">Fermer</button>
                    ) : (
                        <>
                            <button onClick={onClose} disabled={busy} className="px-4 py-2 text-sm text-gray-400 hover:text-white disabled:opacity-40">Annuler</button>
                            <button onClick={run} disabled={busy || phase !== 'ready' || nothing}
                                className="px-4 py-2 text-sm rounded bg-white/10 hover:bg-white/15 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2">
                                {busy ? <><Loader2 size={15} className="animate-spin" /> Synchronisation…</> : <><RefreshCw size={15} /> Synchroniser</>}
                            </button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default SyncFolderDialog;
