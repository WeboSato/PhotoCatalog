import React, { useState } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface DeleteConfirmDialogProps {
    photoName: string;
    photoCount: number;
    onConfirm: (deleteFromDisk: boolean) => void;
    onCancel: () => void;
}

export const DeleteConfirmDialog: React.FC<DeleteConfirmDialogProps> = ({
    photoName,
    photoCount,
    onConfirm,
    onCancel
}) => {
    const [deleteFromDisk, setDeleteFromDisk] = useState(false);
    const [confirmed, setConfirmed] = useState(false);

    const handleConfirm = () => {
        if (deleteFromDisk && !confirmed) {
            return; // Must confirm if deleting from disk
        }
        onConfirm(deleteFromDisk);
    };

    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
            <div className="bg-gray-800 rounded-lg shadow-2xl w-[450px] overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
                    <div className="flex items-center gap-2">
                        <Trash2 size={18} className="text-red-400" />
                        <h2 className="text-lg font-semibold text-white">Delete Photo{photoCount > 1 ? 's' : ''}</h2>
                    </div>
                    <button
                        onClick={onCancel}
                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 space-y-4">
                    <p className="text-gray-300">
                        {photoCount === 1
                            ? `Are you sure you want to delete "${photoName}"?`
                            : `Are you sure you want to delete ${photoCount} photos?`
                        }
                    </p>

                    {/* Options */}
                    <div className="space-y-3">
                        {/* Remove from library only */}
                        <label className="flex items-start gap-3 p-3 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700">
                            <input
                                type="radio"
                                name="deleteOption"
                                checked={!deleteFromDisk}
                                onChange={() => {
                                    setDeleteFromDisk(false);
                                    setConfirmed(false);
                                }}
                                className="mt-1"
                            />
                            <div>
                                <p className="text-white font-medium">Remove from library only</p>
                                <p className="text-sm text-gray-400">
                                    The photo{photoCount > 1 ? 's' : ''} will be removed from PhotoCatalog but remain on disk
                                </p>
                            </div>
                        </label>

                        {/* Delete from disk */}
                        <label className="flex items-start gap-3 p-3 bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-700 border border-transparent hover:border-red-500/30">
                            <input
                                type="radio"
                                name="deleteOption"
                                checked={deleteFromDisk}
                                onChange={() => setDeleteFromDisk(true)}
                                className="mt-1"
                            />
                            <div>
                                <p className="text-red-400 font-medium flex items-center gap-2">
                                    <AlertTriangle size={14} />
                                    Delete from disk (IRREVERSIBLE)
                                </p>
                                <p className="text-sm text-gray-400">
                                    The photo{photoCount > 1 ? 's' : ''} will be permanently deleted from your computer
                                </p>
                            </div>
                        </label>

                        {/* Confirmation checkbox for disk deletion */}
                        {deleteFromDisk && (
                            <label className="flex items-center gap-3 p-3 bg-red-900/20 border border-red-500/30 rounded-lg cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={confirmed}
                                    onChange={(e) => setConfirmed(e.target.checked)}
                                    className="w-4 h-4"
                                />
                                <span className="text-red-300 text-sm">
                                    I understand this action cannot be undone
                                </span>
                            </label>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 px-4 py-3 border-t border-gray-700 bg-gray-800/50">
                    <button
                        onClick={onCancel}
                        className="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-gray-700 rounded"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleConfirm}
                        disabled={deleteFromDisk && !confirmed}
                        className={`px-4 py-2 text-sm rounded font-medium flex items-center gap-2
                            ${deleteFromDisk
                                ? confirmed
                                    ? 'bg-red-600 text-white hover:bg-red-700'
                                    : 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                : 'bg-blue-600 text-white hover:bg-blue-700'
                            }`}
                    >
                        <Trash2 size={14} />
                        {deleteFromDisk ? 'Delete Permanently' : 'Remove from Library'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeleteConfirmDialog;
