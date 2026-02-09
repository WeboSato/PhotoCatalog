import React, { useState, useEffect, useRef } from 'react';
import { User } from 'lucide-react';

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
    const [imgStyle, setImgStyle] = useState<React.CSSProperties>({
        position: 'absolute',
        width: '100%',
        height: '100%',
        objectFit: 'cover' as const,
        opacity: 0,
    });
    const [imgError, setImgError] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Get the image URL for the face thumbnail
    const getImageUrl = () => {
        if (person.face?.thumbnail_path) {
            return `local-image://${person.face.thumbnail_path}`;
        }
        if (person.face?.file_path) {
            return `local-image://${person.face.file_path}`;
        }
        return null;
    };

    const imageUrl = getImageUrl();

    // When image loads, calculate positioning to center the face
    const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const container = containerRef.current;
        if (!container || !person.face) {
            setImgStyle({
                position: 'absolute',
                width: '100%',
                height: '100%',
                objectFit: 'cover' as const,
                opacity: 1,
            });
            return;
        }

        const { box_x, box_y, box_width, box_height } = person.face;
        if (!box_width || !box_height || box_width <= 0 || box_height <= 0) {
            setImgStyle({
                position: 'absolute',
                width: '100%',
                height: '100%',
                objectFit: 'cover' as const,
                opacity: 1,
            });
            return;
        }

        const imgNatW = img.naturalWidth;
        const imgNatH = img.naturalHeight;
        const containerSize = container.clientWidth; // square container

        // Face region in pixels on the original image
        const faceX = box_x * imgNatW;
        const faceY = box_y * imgNatH;
        const faceW = box_width * imgNatW;
        const faceH = box_height * imgNatH;
        const faceCenterX = faceX + faceW / 2;
        const faceCenterY = faceY + faceH / 2;

        // We want the face to occupy about 50% of the card
        // so we need to scale such that face dimension = 50% of container
        const faceLargestDim = Math.max(faceW, faceH);
        const targetFaceSize = containerSize * 0.5;
        let scale = targetFaceSize / faceLargestDim;

        // Clamp scale: don't shrink below fitting the container, don't zoom more than 5x
        const minScaleToFit = containerSize / Math.min(imgNatW, imgNatH);
        scale = Math.max(scale, minScaleToFit);
        scale = Math.min(scale, 5);

        // Scaled image dimensions
        const scaledW = imgNatW * scale;
        const scaledH = imgNatH * scale;

        // Position image so face center is at container center
        let left = containerSize / 2 - faceCenterX * scale;
        let top = containerSize / 2 - faceCenterY * scale;

        // Clamp so we don't show empty space outside the image
        // Image must cover the entire container
        left = Math.min(left, 0);
        top = Math.min(top, 0);
        left = Math.max(left, containerSize - scaledW);
        top = Math.max(top, containerSize - scaledH);

        setImgStyle({
            position: 'absolute',
            left: `${left}px`,
            top: `${top}px`,
            width: `${scaledW}px`,
            height: `${scaledH}px`,
            opacity: 1,
        });
    };

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
            <div ref={containerRef} className="relative w-full aspect-square overflow-hidden bg-gray-700">
                {imageUrl && !imgError ? (
                    <img
                        src={imageUrl}
                        alt={person.name}
                        style={imgStyle}
                        loading="lazy"
                        onLoad={handleImageLoad}
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
