import React from 'react';
import { Trash2, Pin } from 'lucide-react';
import { useAlbumStore } from '../../stores/albumStore';
import { PAGE_FORMATS, SLIDESHOW_SPEC, LayoutPhoto } from '../../services/LayoutEngine';
import { getPreviewUrl, PLACEHOLDER_IMAGE } from '../../utils/imageUrl';
import { PageFormat, AlbumPage } from '../../../shared/albumTypes';

// Renders the working album as an OPEN BOOK: facing pages side by side (horizontal
// spreads) with a centre spine. Uses 2048px previews (screen only — export
// re-resamples originals to true print resolution).
export const AlbumPageCanvas: React.FC = () => {
    const pages = useAlbumStore(s => s.pages);
    const photosById = useAlbumStore(s => s.photosById);
    const activeAlbum = useAlbumStore(s => s.activeAlbum);
    const settings = useAlbumStore(s => s.settings);
    const removePage = useAlbumStore(s => s.removePage);
    const togglePin = useAlbumStore(s => s.togglePin);

    if (!activeAlbum) return null;

    const slideshow = activeAlbum.target_type === 'slideshow';
    const geom = slideshow ? SLIDESHOW_SPEC : PAGE_FORMATS[activeAlbum.page_format as PageFormat];
    const aspect = geom.aspect;
    const bg = settings.backgroundColor || '#ffffff';

    // Group pages into facing spreads: [cover alone], then [2,3], [4,5], …
    // (classic book: the cover is a right-hand page on its own).
    const spreads: (AlbumPage | null)[][] = [];
    if (pages.length > 0) {
        spreads.push([null, pages[0]]); // cover on the right
        for (let i = 1; i < pages.length; i += 2) {
            spreads.push([pages[i], pages[i + 1] || null]);
        }
    }

    const renderPage = (page: AlbumPage | null, side: 'left' | 'right') => {
        if (!page) {
            // empty half of a spread (e.g. facing the cover)
            return <div className="flex-1" style={{ aspectRatio: `${aspect}` }} />;
        }
        const slots = page.layout_data?.slots || [];
        const idx = pages.indexOf(page);
        return (
            <div className="relative flex-1 group/page" style={{ aspectRatio: `${aspect}` }}>
                <div
                    className="relative w-full h-full overflow-hidden ring-1 ring-black/50"
                    style={{
                        background: bg,
                        borderTopLeftRadius: side === 'left' ? 4 : 0,
                        borderBottomLeftRadius: side === 'left' ? 4 : 0,
                        borderTopRightRadius: side === 'right' ? 4 : 0,
                        borderBottomRightRadius: side === 'right' ? 4 : 0,
                        // page curvature shading toward the spine
                        boxShadow: side === 'left'
                            ? 'inset -18px 0 24px -18px rgba(0,0,0,0.45)'
                            : 'inset 18px 0 24px -18px rgba(0,0,0,0.45)',
                    }}
                >
                    {page.photos.map((sp) => {
                        const rect = slots[sp.slot_index] || { x: 0, y: 0, w: 1, h: 1 };
                        const photo = photosById.get(sp.photo_id) as LayoutPhoto | undefined;
                        const url = photo ? getPreviewUrl(photo as any) : PLACEHOLDER_IMAGE;
                        const c = sp.crop_data || {};
                        const transform = (c.scale || c.offsetX || c.offsetY)
                            ? `translate(${(c.offsetX || 0) * 100}%, ${(c.offsetY || 0) * 100}%) scale(${c.scale || 1})`
                            : undefined;
                        const objectPosition = (c.focalX != null || c.focalY != null)
                            ? `${(c.focalX ?? 0.5) * 100}% ${(c.focalY ?? 0.5) * 100}%`
                            : undefined;
                        return (
                            <div
                                key={sp.slot_index}
                                style={{
                                    position: 'absolute',
                                    left: `${rect.x * 100}%`, top: `${rect.y * 100}%`,
                                    width: `${rect.w * 100}%`, height: `${rect.h * 100}%`,
                                    overflow: 'hidden',
                                }}
                            >
                                <img
                                    src={url} alt="" decoding="async"
                                    style={{ width: '100%', height: '100%', objectFit: slideshow ? 'contain' : 'cover', objectPosition, transform }}
                                />
                                <button
                                    onClick={(e) => { e.stopPropagation(); togglePin(page.id, sp.photo_id); }}
                                    title={c.pinned ? 'Désépingler' : 'Épingler'}
                                    className={`absolute top-1.5 right-1.5 p-1 rounded-full transition-opacity ${c.pinned ? 'bg-white/20 text-white opacity-100' : 'bg-black/50 text-white opacity-0 group-hover/page:opacity-100'} backdrop-blur`}
                                >
                                    <Pin size={12} fill={c.pinned ? 'currentColor' : 'none'} />
                                </button>
                            </div>
                        );
                    })}
                </div>
                {/* page number + remove */}
                <div className="absolute -bottom-6 inset-x-0 flex items-center justify-center gap-2 opacity-0 group-hover/page:opacity-100 transition-opacity">
                    <span className="text-[11px] text-gray-500">Page {idx + 1}</span>
                    <button onClick={() => removePage(page.id)} className="p-1 text-gray-500 hover:text-red-400" title="Retirer la page">
                        <Trash2 size={12} />
                    </button>
                </div>
            </div>
        );
    };

    return (
        <div className="flex-1 overflow-auto p-10 bg-gradient-to-b from-[#0c0c0f] to-[#050506]">
            <div className="mx-auto flex flex-col items-center gap-10" style={{ maxWidth: 960 }}>
                {spreads.map((spread, si) => (
                    <div key={si} className="w-full">
                        <div className="text-center text-[11px] text-gray-600 mb-2">
                            {si === 0 ? 'Couverture' : `Double-page ${si}`}
                        </div>
                        {/* Open-book spread: two facing pages + centre spine */}
                        <div
                            className="relative flex w-full rounded-md"
                            style={{ boxShadow: '0 30px 60px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.04)' }}
                        >
                            {renderPage(spread[0], 'left')}
                            {/* centre spine */}
                            <div className="w-px self-stretch" style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.5), rgba(255,255,255,0.06), rgba(0,0,0,0.5))' }} />
                            {renderPage(spread[1], 'right')}
                        </div>
                    </div>
                ))}
                {pages.length === 0 && (
                    <div className="text-gray-600 text-sm mt-20">Cet album est vide.</div>
                )}
            </div>
        </div>
    );
};

export default AlbumPageCanvas;
