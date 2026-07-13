import React, { useEffect, useState } from 'react';
import { Plus, BookOpen, Trash2, Sparkles } from 'lucide-react';
import { useAlbumStore } from '../../stores/albumStore';
import { PAGE_FORMATS } from '../../services/LayoutEngine';
import { PageFormat } from '../../../shared/albumTypes';
import { AlbumPageCanvas } from './AlbumPageCanvas';
import { AgentPanel } from './AgentPanel';
import { AlbumCreationModal } from './AlbumCreationModal';

export const AlbumView: React.FC = () => {
    const albums = useAlbumStore(s => s.albums);
    const activeAlbum = useAlbumStore(s => s.activeAlbum);
    const loadAlbums = useAlbumStore(s => s.loadAlbums);
    const openAlbum = useAlbumStore(s => s.openAlbum);
    const deleteAlbum = useAlbumStore(s => s.deleteAlbum);
    const setProgress = useAlbumStore(s => s.setProgress);
    const [showCreate, setShowCreate] = useState(false);

    useEffect(() => {
        loadAlbums();
        // Live progress narration from the main process (build + export).
        const unsub = window.api.onAlbumProgress((p) => setProgress(p));
        return unsub;
    }, [loadAlbums, setProgress]);

    return (
        <div className="flex-1 flex overflow-hidden bg-[#0a0a0a]">
            {/* Album list */}
            <div className="w-60 border-r border-white/10 bg-[#111]/60 backdrop-blur-2xl flex flex-col">
                <div className="p-3 border-b border-[#333]">
                    <button
                        onClick={() => setShowCreate(true)}
                        className="w-full flex items-center justify-center gap-2 py-2 rounded bg-white/10 hover:bg-white/15 text-white text-sm"
                    >
                        <Plus size={15} /> Nouvel album
                    </button>
                </div>
                <div className="flex-1 overflow-auto p-2 space-y-1">
                    {albums.length === 0 && (
                        <div className="text-xs text-gray-600 p-3 text-center">Aucun album pour l'instant.</div>
                    )}
                    {albums.map(a => {
                        const fmt = PAGE_FORMATS[a.page_format as PageFormat];
                        const active = activeAlbum?.id === a.id;
                        return (
                            <div
                                key={a.id}
                                onClick={() => openAlbum(a.id)}
                                className={`group flex items-center gap-2 px-2 py-2 rounded cursor-pointer ${active ? 'bg-white/10 ring-1 ring-white/40/40' : 'hover:bg-[#1d1d1d]'}`}
                            >
                                <BookOpen size={15} className={active ? 'text-gray-200' : 'text-gray-500'} />
                                <div className="flex-1 min-w-0">
                                    <div className="text-sm text-gray-200 truncate">{a.name}</div>
                                    <div className="text-[11px] text-gray-500">{fmt ? fmt.label : a.page_format} · {a.page_count || 0} pages</div>
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); if (confirm(`Supprimer l'album « ${a.name} » ?`)) deleteAlbum(a.id); }}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400"
                                    title="Supprimer"
                                >
                                    <Trash2 size={13} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Center: pages or empty state */}
            {activeAlbum ? (
                <AlbumPageCanvas />
            ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 gap-3">
                    <Sparkles size={32} className="text-gray-700" />
                    <div className="text-sm">Sélectionne des photos dans la grille, puis crée un album.</div>
                    <button
                        onClick={() => setShowCreate(true)}
                        className="flex items-center gap-2 px-4 py-2 rounded bg-white/10 hover:bg-white/15 text-white text-sm"
                    >
                        <Plus size={15} /> Nouvel album
                    </button>
                </div>
            )}

            {/* Right: agent panel */}
            <AgentPanel />

            {showCreate && <AlbumCreationModal onClose={() => setShowCreate(false)} />}
        </div>
    );
};

export default AlbumView;
