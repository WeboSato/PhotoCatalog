import React, { useState, useEffect } from 'react';
import { User } from 'lucide-react';
import { getImageUrl as toLocalUrl } from '../utils/imageUrl';

export interface PersonWithThumbnail {
    id: string;
    name: string;
    face_count: number;
    thumbnail_face_id?: string;
    // Face data for thumbnail cropping
    face?: {
        id: string;
        photo_id: string;
        box_x: number;
        box_y: number;
        box_width: number;
        box_height: number;
        thumbnail_path?: string;
        file_path?: string;
        face_crop_path?: string; // pre-generated square crop (Layer 2)
    };
}

interface PersonCardProps {
    person: PersonWithThumbnail;
    onClick: () => void;
    onRename?: (person: PersonWithThumbnail, newName: string) => void;
    isActive?: boolean;
}

export const PersonCard: React.FC<PersonCardProps> = ({
    person,
    onClick,
    onRename,
    isActive = false
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(person.name);
    const [imgError, setImgError] = useState(false);

    const face = person.face;

    // Prefer the pre-generated square face crop; otherwise the DECODABLE 512 webp
    // thumbnail (never the raw/.nef/.psd original — that is the blank-card cause).
    // URLs are encoded via utils/imageUrl (the exact inverse of the protocol
    // handler's per-segment decodeURIComponent).
    const imageUrl = face?.face_crop_path
        ? toLocalUrl(face.face_crop_path)
        : (face?.thumbnail_path ? toLocalUrl(face.thumbnail_path) : null);
    const usingCrop = !!face?.face_crop_path;

    // For the thumbnail fallback: statically position the cover-crop on the face
    // box center (the pre-generated crop is already square+centered, so it needs none).
    const objectPosition = face && face.box_width > 0
        ? `${Math.min(100, Math.max(0, (face.box_x + face.box_width / 2) * 100))}% ` +
          `${Math.min(100, Math.max(0, (face.box_y + face.box_height / 2) * 100))}%`
        : '50% 50%';

    // Reset the error state if the person's face source changes.
    useEffect(() => { setImgError(false); }, [imageUrl]);

    const handleNameClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(true);
    };

    const handleNameSubmit = async () => {
        const trimmed = editName.trim();
        if (trimmed && trimmed !== person.name) {
            await window.api.updatePerson(person.id, trimmed);
            onRename?.(person, trimmed);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleNameSubmit();
        } else if (e.key === 'Escape') {
            setEditName(person.name);
            setIsEditing(false);
        }
    };

    // Sync editName when person.name changes externally
    useEffect(() => {
        setEditName(person.name);
    }, [person.name]);

    return (
        <div
            onClick={onClick}
            className={`group relative rounded-2xl overflow-hidden bg-gray-800
                        shadow-lg hover:shadow-2xl transition-all cursor-pointer
                        hover:scale-[1.03] ${isActive ? 'ring-3 ring-blue-500' : ''}`}
        >
            {/* Face image container - square aspect ratio */}
            <div className="relative w-full aspect-square overflow-hidden bg-gray-700">
                {imageUrl && !imgError ? (
                    <img
                        src={imageUrl}
                        alt={person.name}
                        className="absolute inset-0 w-full h-full object-cover"
                        style={usingCrop ? undefined : { objectPosition }}
                        loading="lazy"
                        onError={() => setImgError(true)}
                    />
                ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-600 to-gray-700">
                        <User size={80} className="text-gray-500" />
                    </div>
                )}

                {/* Gradient overlay at bottom for text readability */}
                <div className="absolute inset-x-0 bottom-0 h-24
                                bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

                {/* Name overlay inside the image */}
                <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
                    {isEditing ? (
                        <input
                            type="text"
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            onBlur={handleNameSubmit}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            className="bg-black/50 border border-white/30 rounded px-2 py-1 text-white font-semibold
                                       text-base focus:outline-none focus:border-white w-full"
                            onClick={(e) => e.stopPropagation()}
                        />
                    ) : (
                        <div
                            onClick={handleNameClick}
                            className="cursor-text hover:bg-white/10 rounded px-1 -mx-1 transition-colors"
                        >
                            <span className="text-white font-semibold text-base drop-shadow-lg
                                           [text-shadow:_0_1px_4px_rgb(0_0_0_/_80%)]">
                                {person.name}
                            </span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default PersonCard;
