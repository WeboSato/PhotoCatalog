import React, { useState } from 'react';
import { X, BookOpen, MonitorPlay, Sparkles } from 'lucide-react';
import { useCatalogStore } from '../../stores/catalogStore';
import { useAlbumStore } from '../../stores/albumStore';
import { PAGE_FORMATS } from '../../services/LayoutEngine';
import { PageFormat, AlbumTargetType } from '../../../shared/albumTypes';

const FORMAT_ORDER: PageFormat[] = ['4x6', '5x7', '8x10', 'sq20', 'sq30'];

export const AlbumCreationModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const selectedCount = useCatalogStore(s => s.selectedPhotoIds.size);
    const totalInGrid = useCatalogStore(s => s.photos.length);
    const buildFromSelection = useAlbumStore(s => s.buildFromSelection);
    const busy = useAlbumStore(s => s.busy);

    const [name, setName] = useState('Nouvel album');
    const [format, setFormat] = useState<PageFormat>('4x6');
    const [target, setTarget] = useState<AlbumTargetType>('book');

    const usingSelection = selectedCount > 0;
    const sourceCount = usingSelection ? selectedCount : totalInGrid;

    const handleCreate = async () => {
        const id = await buildFromSelection(name.trim() || 'Nouvel album', format, target);
        if (id) onClose();
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div
                className="glass-strong rounded-xl shadow-2xl w-[560px] max-w-[92vw] max-h-[90vh] overflow-auto"
                onClick={e => e.stopPropagation()}
                // Keep keystrokes inside the dialog — otherwise the app's global
                // g/e/n/… shortcuts fire and switch views, closing the dialog.
                onKeyDown={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-5 py-3 border-b border-[#333]">
                    <div className="flex items-center gap-2 text-gray-100">
                        <Sparkles size={16} className="text-gray-200" /> Nouvel album — assistant
                    </div>
                    <button onClick={onClose} className="text-gray-500 hover:text-white"><X size={18} /></button>
                </div>

                <div className="p-5 space-y-5">
                    <div className="text-sm text-gray-400">
                        {usingSelection
                            ? <>L'assistant va composer un album à partir de tes <span className="text-gray-200">{selectedCount}</span> photos sélectionnées.</>
                            : <>Aucune sélection : l'assistant utilisera les <span className="text-gray-200">{totalInGrid}</span> photos affichées dans la grille.</>}
                        <div className="text-xs text-gray-600 mt-1">Les photos rejetées sont exclues automatiquement, l'ordre suit la date de prise de vue.</div>
                    </div>

                    <div>
                        <label className="block text-xs text-gray-500 mb-1">Nom</label>
                        <input
                            value={name}
                            onChange={e => setName(e.target.value)}
                            autoFocus
                            onFocus={e => e.target.select()}
                            className="w-full bg-[#0f0f0f] border border-[#333] rounded px-3 py-2 text-sm text-gray-200 focus:border-white/40 outline-none"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-gray-500 mb-2">Format de page</label>
                        <div className="grid grid-cols-5 gap-2">
                            {FORMAT_ORDER.map(f => {
                                const spec = PAGE_FORMATS[f];
                                const active = format === f;
                                return (
                                    <button
                                        key={f}
                                        onClick={() => setFormat(f)}
                                        className={`flex flex-col items-center gap-1 p-2 rounded border ${active ? 'border-white/25 bg-white/5' : 'border-[#333] hover:border-[#555]'}`}
                                    >
                                        <div className="flex items-end justify-center h-10 w-full">
                                            <div
                                                className={active ? 'bg-gray-200' : 'bg-gray-600'}
                                                style={{
                                                    width: spec.aspect >= 1 ? 28 : 28 * spec.aspect,
                                                    height: spec.aspect >= 1 ? 28 / spec.aspect : 28,
                                                }}
                                            />
                                        </div>
                                        <span className={`text-[10px] leading-tight text-center ${active ? 'text-gray-300' : 'text-gray-500'}`}>{spec.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs text-gray-500 mb-2">Type</label>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setTarget('book')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded border text-sm ${target === 'book' ? 'border-white/25 bg-white/5 text-gray-300' : 'border-[#333] text-gray-400 hover:border-[#555]'}`}
                            >
                                <BookOpen size={15} /> Livre imprimable
                            </button>
                            <button
                                onClick={() => setTarget('book')}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded border text-sm border-[#333] text-gray-500 cursor-default`}
                                title="Le diaporama s'exporte depuis un album livre"
                                disabled
                            >
                                <MonitorPlay size={15} /> Diaporama à l'export
                            </button>
                        </div>
                        <div className="text-[11px] text-gray-600 mt-1">Un même album s'exporte en livre PDF <b>ou</b> en diaporama 16:9.</div>
                    </div>
                </div>

                <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#333]">
                    <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white">Annuler</button>
                    <button
                        onClick={handleCreate}
                        disabled={busy !== 'idle' || sourceCount === 0}
                        className="px-4 py-2 text-sm rounded bg-white/10 hover:bg-white/15 text-white disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Sparkles size={15} /> {busy === 'building' ? 'Composition…' : 'Composer l’album'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AlbumCreationModal;
