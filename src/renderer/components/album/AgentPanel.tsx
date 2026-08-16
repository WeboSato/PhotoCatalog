import React from 'react';
import { Sparkles, FileText, MonitorPlay, AlertTriangle, Loader2, CheckCircle2, RefreshCw } from 'lucide-react';
import { useAlbumStore } from '../../stores/albumStore';
import { PAGE_FORMATS } from '../../services/LayoutEngine';
import { PageFormat } from '../../../shared/albumTypes';

const DENSITIES: { key: 'minimal' | 'balanced' | 'dense'; label: string }[] = [
    { key: 'minimal', label: 'Aéré' },
    { key: 'balanced', label: 'Équilibré' },
    { key: 'dense', label: 'Dense' },
];

// The "mini agent" surface: narrates what the local-AI curator did, and drives export.
export const AgentPanel: React.FC = () => {
    const activeAlbum = useAlbumStore(s => s.activeAlbum);
    const summary = useAlbumStore(s => s.summary);
    const pages = useAlbumStore(s => s.pages);
    const busy = useAlbumStore(s => s.busy);
    const progress = useAlbumStore(s => s.progress);
    const lastExport = useAlbumStore(s => s.lastExport);
    const exportActive = useAlbumStore(s => s.exportActive);
    const clearLastExport = useAlbumStore(s => s.clearLastExport);
    const settings = useAlbumStore(s => s.settings);
    const regenerate = useAlbumStore(s => s.regenerate);

    if (!activeAlbum) {
        return (
            <div className="w-72 border-l border-white/10 bg-[#111]/60 backdrop-blur-2xl p-4 text-sm text-gray-500">
                <div className="flex items-center gap-2 text-gray-400 mb-2">
                    <Sparkles size={16} /> Assistant album
                </div>
                Crée un album depuis ta sélection pour commencer. L'assistant choisit et ordonne
                automatiquement les photos, puis tu exportes en PDF ou diaporama.
            </div>
        );
    }

    const fmt = PAGE_FORMATS[activeAlbum.page_format as PageFormat];
    const exporting = busy === 'exporting';
    const building = busy === 'building';
    const activeDensity = settings.density || 'balanced';

    return (
        <div className="w-72 border-l border-white/10 bg-[#111]/60 backdrop-blur-2xl flex flex-col">
            <div className="p-4 border-b border-[#333]">
                <div className="flex items-center gap-2 text-gray-200 mb-1">
                    <Sparkles size={16} className="text-gray-200" /> Assistant album
                </div>
                <div className="text-xs text-gray-500">{fmt ? fmt.label : activeAlbum.page_format}</div>
            </div>

            {/* What the agent did */}
            <div className="p-4 border-b border-[#333] text-sm">
                <div className="text-gray-300 font-medium mb-2">Ce que j'ai fait</div>
                {summary ? (
                    <ul className="space-y-1.5 text-xs text-gray-400">
                        <li>• <span className="text-gray-200">{summary.keeperCount}</span> photos retenues</li>
                        <li>• <span className="text-gray-200">{pages.length}</span> pages</li>
                        <li className="text-gray-500">{summary.strategy}</li>
                    </ul>
                ) : (
                    <div className="text-xs text-gray-500">—</div>
                )}
            </div>

            {/* Re-curate controls */}
            <div className="p-4 border-b border-[#333]">
                <div className="text-gray-300 font-medium mb-2 text-sm">Régénérer</div>
                <div className="flex gap-1 mb-2">
                    {DENSITIES.map(d => (
                        <button
                            key={d.key}
                            disabled={building || exporting}
                            onClick={() => regenerate(d.key)}
                            className={`flex-1 py-1.5 rounded text-xs border ${activeDensity === d.key ? 'border-white/25 bg-white/5 text-gray-300' : 'border-[#333] text-gray-400 hover:border-[#555]'} disabled:opacity-40`}
                            title={`Densité : ${d.label}`}
                        >
                            {d.label}
                        </button>
                    ))}
                </div>
                <button
                    disabled={building || exporting}
                    onClick={() => regenerate(activeDensity)}
                    className="w-full flex items-center justify-center gap-2 py-1.5 rounded bg-[#2a2a2a] hover:bg-[#333] text-gray-200 text-xs disabled:opacity-40"
                >
                    <RefreshCw size={13} className={building ? 'animate-spin' : ''} /> Régénérer les pages
                </button>
                <div className="text-[11px] text-gray-600 mt-1.5">Change la densité (photos par page). Les photos épinglées restent en vedette.</div>
            </div>

            {/* Progress */}
            {(busy !== 'idle' || progress) && (
                <div className="p-4 border-b border-[#333] text-xs text-gray-400 flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-gray-200" />
                    {progressLabel(progress?.phase)}
                    {progress?.total ? ` ${progress.current || 0}/${progress.total}` : ''}
                </div>
            )}

            {/* Export result */}
            {lastExport && (
                <div className="p-4 border-b border-[#333] text-xs">
                    {lastExport.ok ? (
                        <div className="text-green-400 flex items-start gap-2">
                            <CheckCircle2 size={14} className="mt-0.5" />
                            <div>
                                Export réussi.
                                {lastExport.warnings && lastExport.warnings.length > 0 && (
                                    <div className="mt-2 text-amber-400/90">
                                        <div className="flex items-center gap-1 mb-1"><AlertTriangle size={12} /> {lastExport.warnings.length} avertissement(s) de résolution :</div>
                                        <ul className="space-y-1 max-h-32 overflow-auto">
                                            {lastExport.warnings.slice(0, 12).map((w, i) => <li key={i} className="text-amber-300/80">• {w}</li>)}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="text-red-400 flex items-start gap-2">
                            <AlertTriangle size={14} className="mt-0.5" /> Échec : {lastExport.error}
                        </div>
                    )}
                    <button onClick={clearLastExport} className="mt-2 text-gray-500 hover:text-gray-300">Fermer</button>
                </div>
            )}

            {/* Export actions */}
            <div className="mt-auto p-4 space-y-2">
                <button
                    disabled={exporting || pages.length === 0}
                    onClick={() => exportActive('book')}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded bg-white/10 hover:bg-white/15 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm"
                >
                    <FileText size={15} /> Exporter le livre PDF
                </button>
                <button
                    disabled={exporting || pages.length === 0}
                    onClick={() => exportActive('slideshow')}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded bg-[#2a2a2a] hover:bg-[#333] disabled:opacity-40 disabled:cursor-not-allowed text-gray-200 text-sm"
                >
                    <MonitorPlay size={15} /> Exporter le diaporama (16:9)
                </button>
            </div>
        </div>
    );
};

function progressLabel(phase?: string): string {
    switch (phase) {
        case 'scan': return 'Analyse…';
        case 'curate': return 'Sélection…';
        case 'resample': return 'Préparation des images…';
        case 'render': return 'Rendu des pages…';
        case 'write': return 'Écriture du PDF…';
        case 'done': return 'Terminé';
        default: return 'Traitement…';
    }
}

export default AgentPanel;
