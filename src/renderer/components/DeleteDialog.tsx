import React from 'react';
import { Trash2, EyeOff, X } from 'lucide-react';
import { Photo } from '../stores/catalogStore';
import { getThumbnailUrl } from '../utils/imageUrl';

interface DeleteDialogProps {
    isOpen: boolean;
    photoCount: number;
    photos?: Photo[];  // Optional: photos to preview before deletion
    showRejectedMode?: boolean;  // If true, shows "Delete rejected photos" mode
    onClose: () => void;
    onDeletePermanently: () => void;
    onHideFromLibrary: () => void;
}

export const DeleteDialog: React.FC<DeleteDialogProps> = ({
    isOpen,
    photoCount,
    photos,
    showRejectedMode,
    onClose,
    onDeletePermanently,
    onHideFromLibrary
}) => {
    if (!isOpen) return null;

    const photoText = photoCount === 1 ? 'this photo' : `these ${photoCount} photos`;
    const hasPhotosToShow = photos && photos.length > 0;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/70"
                onClick={onClose}
            />

            {/* Dialog - wider when showing photos */}
            <div className={`relative bg-gray-800 rounded-lg shadow-2xl border border-gray-700 overflow-hidden ${hasPhotosToShow ? 'w-[700px] max-h-[80vh]' : 'w-[420px]'}`}>
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <h2 className="text-lg font-semibold text-white">
                        {showRejectedMode ? 'Delete rejected photos' : `Delete ${photoCount} photo${photoCount > 1 ? 's' : ''}`}
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Photo grid preview */}
                {hasPhotosToShow && (
                    <div className="p-4 border-b border-gray-700 max-h-[300px] overflow-y-auto">
                        <p className="text-gray-400 text-xs mb-3">
                            {showRejectedMode ? 'Photos marked as rejected:' : 'Selected photos:'}
                        </p>
                        <div className="grid grid-cols-5 gap-2">
                            {photos.map((photo) => (
                                <div
                                    key={photo.id}
                                    className="relative aspect-square rounded overflow-hidden bg-gray-900"
                                >
                                    <img
                                        src={getThumbnailUrl(photo)}
                                        alt={photo.file_name}
                                        className="w-full h-full object-cover"
                                    />
                                    {photo.flag === 'rejected' && (
                                        <div className="absolute inset-0 bg-red-600/30 flex items-center justify-center">
                                            <X size={24} className="text-red-500" />
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-1">
                                        <p className="text-[10px] text-white truncate">{photo.file_name}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Content */}
                <div className="p-4">
                    <p className="text-gray-300 text-sm mb-4">
                        What do you want to do with {photoText}?
                    </p>

                    {/* Option 1: Delete permanently */}
                    <button
                        onClick={onDeletePermanently}
                        className="w-full flex items-start gap-3 p-3 mb-3 bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 rounded-lg text-left transition-colors group"
                    >
                        <div className="p-2 bg-red-600 rounded-lg">
                            <Trash2 size={20} className="text-white" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-white font-medium group-hover:text-red-300">
                                Delete permanently
                            </h3>
                            <p className="text-gray-400 text-xs mt-0.5">
                                Deletes files from disk. This action is irreversible.
                            </p>
                        </div>
                    </button>

                    {/* Option 2: Hide from library */}
                    <button
                        onClick={onHideFromLibrary}
                        className="w-full flex items-start gap-3 p-3 bg-gray-700/50 hover:bg-gray-700 border border-gray-600/50 rounded-lg text-left transition-colors group"
                    >
                        <div className="p-2 bg-gray-600 rounded-lg">
                            <EyeOff size={20} className="text-white" />
                        </div>
                        <div className="flex-1">
                            <h3 className="text-white font-medium group-hover:text-blue-300">
                                Hide from library
                            </h3>
                            <p className="text-gray-400 text-xs mt-0.5">
                                Removes photos from catalog but keeps files on disk.
                            </p>
                        </div>
                    </button>
                </div>

                {/* Footer */}
                <div className="flex justify-end px-4 py-3 border-t border-gray-700 bg-gray-800/50">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded transition-colors"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeleteDialog;
