import React from 'react';
import { Trash2, Pin } from 'lucide-react';
import { useAlbumStore } from '../../stores/albumStore';
import { PAGE_FORMATS, SLIDESHOW_SPEC, LayoutPhoto } from '../../services/LayoutEngine';
import { getPreviewUrl, PLACEHOLDER_IMAGE } from '../../utils/imageUrl';
import { PageFormat } from '../../../shared/albumTypes';

// Renders the working album pages at screen scale. Uses 2048px previews (screen
// only — export re-resamples originals to true print resolution).
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

    return (
        <div className="flex-1 overflow-auto p-8 bg-[#0a0a0a]">
            <div className="mx-auto flex flex-col items-center gap-6" style={{ maxWidth: 640 }}>
                {pages.map((page, idx) => {
                    const slots = page.layout_data?.slots || [];
                    return (
                        <div key={page.id || idx} className="w-full group">
                            <div className="flex items-center justify-between mb-1 px-1">
                                <span className="text-xs text-gray-500">
                                    Page {idx + 1} / {pages.length}
                                </span>
                                <button
                                    onClick={() => removePage(page.id)}
                                    className="opacity-0 group-hover:opacity-100 p-1 text-gray-500 hover:text-red-400 transition-opacity"
                                    title="Retirer la page"
                                >
                                    <Trash2 size={14} />
                                </button>
                            </div>
                            <div
                                className="relative w-full shadow-2xl rounded-sm overflow-hidden ring-1 ring-black/40"
                                style={{ aspectRatio: `${aspect}`, background: bg }}
                            >
                                {page.photos.map((sp) => {
                                    const rect = slots[sp.slot_index] || { x: 0, y: 0, w: 1, h: 1 };
                                    const photo = photosById.get(sp.photo_id) as LayoutPhoto | undefined;
                                    const url = photo ? getPreviewUrl(photo as any) : PLACEHOLDER_IMAGE;
                                    const c = sp.crop_data || {};
                                    const transform = (c.scale || c.offsetX || c.offsetY)
                                        ? `translate(${(c.offsetX || 0) * 100}%, ${(c.offsetY || 0) * 100}%) scale(${c.scale || 1})`
                                        : undefined;
                                    // Face-aware crop: shift the cover-crop toward the faces.
                                    const objectPosition = (c.focalX != null || c.focalY != null)
                                        ? `${(c.focalX ?? 0.5) * 100}% ${(c.focalY ?? 0.5) * 100}%`
                                        : undefined;
                                    return (
                                        <div
                                            key={sp.slot_index}
                                            style={{
                                                position: 'absolute',
                                                left: `${rect.x * 100}%`,
                                                top: `${rect.y * 100}%`,
                                                width: `${rect.w * 100}%`,
                                                height: `${rect.h * 100}%`,
                                                overflow: 'hidden',
                                            }}
                                        >
                                            <img
                                                src={url}
                                                alt=""
                                                decoding="async"
                                                style={{
                                                    width: '100%',
                                                    height: '100%',
                                                    objectFit: slideshow ? 'contain' : 'cover',
                                                    objectPosition,
                                                    transform,
                                                }}
                                            />
                                            <button
                                                onClick={(e) => { e.stopPropagation(); togglePin(page.id, sp.photo_id); }}
                                                title={c.pinned ? 'Désépingler' : 'Épingler (garder en vedette)'}
                                                className={`absolute top-1.5 right-1.5 p-1 rounded-full transition-opacity ${c.pinned ? 'bg-blue-600 text-white opacity-100' : 'bg-black/50 text-white opacity-0 group-hover:opacity-100'}`}
                                            >
                                                <Pin size={12} fill={c.pinned ? 'currentColor' : 'none'} />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
                {pages.length === 0 && (
                    <div className="text-gray-600 text-sm mt-20">Cet album est vide.</div>
                )}
            </div>
        </div>
    );
};

export default AlbumPageCanvas;
