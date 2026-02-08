import React, { useState } from 'react';
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
    isActive?: boolean;
}

export const PersonCard: React.FC<PersonCardProps> = ({
    person,
    onClick,
    isActive = false
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editName, setEditName] = useState(person.name);

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

    // Calculate cropping styles to center face in thumbnail
    const getCropStyles = (): React.CSSProperties => {
        if (!person.face) return {};

        const { box_x, box_y, box_width, box_height } = person.face;

        // Add some padding around the face (20% extra on each side)
        const padding = 0.3;
        const faceSize = Math.max(box_width, box_height) * (1 + padding);

        // Scale so face fills the container
        const scale = 1 / faceSize;

        // Calculate face center
        const faceCenterX = box_x + box_width / 2;
        const faceCenterY = box_y + box_height / 2;

        // Position image so face center is at container center (50%)
        // After scaling, face center would be at faceCenterX * scale * 100%
        // We want it at 50%, so offset = 50 - faceCenterX * scale * 100
        const left = 50 - faceCenterX * scale * 100;
        const top = 50 - faceCenterY * scale * 100;

        return {
            position: 'absolute',
            width: `${scale * 100}%`,
            height: `${scale * 100}%`,
            left: `${left}%`,
            top: `${top}%`,
            objectFit: 'cover'
        };
    };

    const handleNameClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsEditing(true);
    };

    const handleNameSubmit = async () => {
        if (editName.trim() && editName !== person.name) {
            await window.api.updatePerson(person.id, editName.trim());
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

    return (
        <div
            onClick={onClick}
            className={`group relative rounded-2xl overflow-hidden bg-gray-800
                        shadow-lg hover:shadow-2xl transition-all cursor-pointer
                        hover:scale-[1.03] ${isActive ? 'ring-3 ring-blue-500' : ''}`}
        >
            {/* Face image container - square aspect ratio */}
            <div className="relative w-full aspect-square overflow-hidden bg-gray-700">
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={person.name}
                        style={getCropStyles()}
                        className="transition-transform duration-300 group-hover:scale-110"
                        loading="lazy"
                    />
                ) : (
                    // Placeholder when no face image
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-600 to-gray-700">
                        <User size={80} className="text-gray-500" />
                    </div>
                )}

                {/* Gradient overlay at bottom for text readability - like Apple Photos */}
                <div className="absolute inset-x-0 bottom-0 h-24
                                bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

                {/* Name overlay inside the image - Apple Photos style */}
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
