import React, { useState, useEffect, useCallback } from 'react';
import { useCatalogStore } from '../stores/catalogStore';
import { PersonCard, PersonWithThumbnail } from './PersonCard';
import { getImageUrl as toLocalUrl } from '../utils/imageUrl';
import {
    ScanFace,
    Loader2,
    ChevronDown,
    X,
    ArrowLeft,
    SortAsc,
    SortDesc,
    Users,
    Trash2,
    ThumbsUp,
    ThumbsDown,
    UserX,
    Check
} from 'lucide-react';

type SortOption = 'name' | 'photo_count' | 'recent';
type SortDirection = 'asc' | 'desc';

interface PersonPhoto {
    id: string;
    file_path: string;
    file_name: string;
    thumbnail_path?: string;
    date_taken?: string;
    face_id?: string; // The face ID associated with this photo for this person
}

export const AIFaceView: React.FC = () => {
    const [people, setPeople] = useState<PersonWithThumbnail[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isScanning, setIsScanning] = useState(false);
    const [scanProgress, setScanProgress] = useState<{ current: number; total: number; phase?: string }>({ current: 0, total: 0 });
    const [sortBy, setSortBy] = useState<SortOption>('name');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [showSortMenu, setShowSortMenu] = useState(false);
    const [selectedPerson, setSelectedPerson] = useState<PersonWithThumbnail | null>(null);
    const [personPhotos, setPersonPhotos] = useState<PersonPhoto[]>([]);
    const [loadingPhotos, setLoadingPhotos] = useState(false);

    // Load people with their thumbnail faces
    const loadPeople = useCallback(async () => {
        setIsLoading(true);
        try {
            // Use the optimized API that loads people with thumbnails in one call
            const peopleWithThumbnails = await window.api.getPeopleWithThumbnails();
            setPeople(peopleWithThumbnails);
        } catch (error) {
            console.error('[AIFaceView] Failed to load people:', error);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        loadPeople();
    }, [loadPeople]);

    // When the background face-crop backfill finishes, refresh so tight crops appear.
    useEffect(() => window.api.onFacesCropProgress(p => { if (p.done) loadPeople(); }), [loadPeople]);

    // Sort people based on current sort options
    const sortedPeople = React.useMemo(() => {
        const sorted = [...people].sort((a, b) => {
            switch (sortBy) {
                case 'name':
                    return a.name.localeCompare(b.name);
                case 'photo_count':
                    return b.face_count - a.face_count;
                case 'recent':
                    // For now, sort by face_count as a proxy for "recent"
                    return b.face_count - a.face_count;
                default:
                    return 0;
            }
        });

        if (sortDirection === 'desc' && sortBy === 'name') {
            sorted.reverse();
        } else if (sortDirection === 'asc' && sortBy !== 'name') {
            sorted.reverse();
        }

        return sorted;
    }, [people, sortBy, sortDirection]);

    // Face scanning function
    const scanFaces = async () => {
        if (isScanning) return;

        setIsScanning(true);
        setScanProgress({ current: 0, total: 0, phase: 'scanning' });

        try {
            // Import FaceRecognitionService dynamically
            const { faceRecognitionService } = await import('../services/FaceRecognitionService');

            // Load models first
            await faceRecognitionService.loadModels();

            // Get all photos
            const photos = await window.api.getPhotos(10000, 0);
            setScanProgress({ current: 0, total: photos.length, phase: 'scanning' });

            let facesFound = 0;

            for (let i = 0; i < photos.length; i++) {
                const photo = photos[i];
                setScanProgress({ current: i + 1, total: photos.length, phase: 'scanning' });

                // Skip if no thumbnail
                if (!photo.thumbnail_path) continue;

                try {
                    // Use thumbnail for faster processing
                    const imageUrl = `local-image://${photo.thumbnail_path}`;
                    const faces = await faceRecognitionService.detectFacesFromUrl(imageUrl);

                    // Save detected faces to database
                    for (const face of faces) {
                        await window.api.insertFace({
                            id: face.id,
                            photo_id: photo.id,
                            box_x: face.box.x,
                            box_y: face.box.y,
                            box_width: face.box.width,
                            box_height: face.box.height,
                            descriptor: face.descriptor ? JSON.stringify(Array.from(face.descriptor)) : null,
                            confidence: face.confidence
                        });
                        facesFound++;
                    }
                } catch (err) {
                    // Skip photos that fail
                    console.warn(`[FaceScan] Failed to process ${photo.file_name}:`, err);
                }

                // Small delay to keep UI responsive
                if (i % 10 === 0) {
                    await new Promise(r => setTimeout(r, 10));
                }
            }

            console.log(`[FaceScan] Complete! Found ${facesFound} faces in ${photos.length} photos`);

            // Now cluster the faces automatically
            setScanProgress({ current: 0, total: 0, phase: 'clustering' });
            console.log('[FaceScan] Starting face clustering...');

            const clusterResult = await window.api.clusterFaces();
            console.log(`[FaceScan] Clustering done: ${clusterResult.clustersCreated} people, ${clusterResult.facesAssigned} faces`);

            // Generate tight square crops for the new representatives before showing them.
            await window.api.regenerateFaceCrops();

            // Refresh people list
            await loadPeople();

        } catch (error) {
            console.error('[FaceScan] Error:', error);
            alert('Error during scan: ' + (error as Error).message);
        } finally {
            setIsScanning(false);
            setScanProgress({ current: 0, total: 0, phase: '' });
        }
    };

    // Re-group all detected faces with the improved clustering (keeps renamed people).
    const handleRecluster = async () => {
        if (isScanning) return;
        setIsScanning(true);
        setScanProgress({ current: 0, total: 0, phase: 'clustering' });
        const unsub = window.api.onReclusterProgress((p) => {
            setScanProgress({ current: p.current || 0, total: p.total || 0, phase: p.phase === 'crops' ? 'clustering' : p.phase });
        });
        try {
            const res = await window.api.reclusterFaces();
            console.log('[Recluster]', res);
            await loadPeople();
        } catch (e) {
            console.error('[Recluster] failed:', e);
        } finally {
            unsub();
            setIsScanning(false);
            setScanProgress({ current: 0, total: 0, phase: '' });
        }
    };

    // Handle person card click - show their photos with face info
    const handlePersonClick = async (person: PersonWithThumbnail) => {
        setSelectedPerson(person);
        setLoadingPhotos(true);
        try {
            const photos = await window.api.getPhotosByPerson(person.id);

            // Get face IDs for each photo
            const photosWithFaces = await Promise.all(
                photos.map(async (photo: any) => {
                    const faces = await window.api.getFacesForPhoto(photo.id);
                    const personFace = faces.find((f: any) => f.person_id === person.id);
                    return {
                        ...photo,
                        face_id: personFace?.id
                    };
                })
            );

            setPersonPhotos(photosWithFaces);
        } catch (error) {
            console.error('[AIFaceView] Failed to load person photos:', error);
        } finally {
            setLoadingPhotos(false);
        }
    };

    // Remove a photo from this person (mark as "not this person")
    const handleRemoveFromPerson = async (photo: PersonPhoto) => {
        if (!selectedPerson || !photo.face_id) return;

        try {
            // Delete the face assignment (unassign from person)
            await window.api.deleteFace(photo.face_id);

            // Remove from local state
            setPersonPhotos(prev => prev.filter(p => p.id !== photo.id));

            // Update the person's face count
            setSelectedPerson(prev => prev ? { ...prev, face_count: prev.face_count - 1 } : null);

            // Update people list
            await loadPeople();

            console.log(`[AIFaceView] Removed photo ${photo.id} from ${selectedPerson.name}`);
        } catch (error) {
            console.error('[AIFaceView] Failed to remove photo from person:', error);
        }
    };

    // Confirm a face assignment (positive feedback)
    const handleConfirmFace = async (photo: PersonPhoto) => {
        if (!selectedPerson || !photo.face_id) return;

        try {
            // Mark the face as confirmed
            await window.api.assignFaceToPerson(photo.face_id, selectedPerson.id);
            console.log(`[AIFaceView] Confirmed face ${photo.face_id} for ${selectedPerson.name}`);
        } catch (error) {
            console.error('[AIFaceView] Failed to confirm face:', error);
        }
    };

    // Handle rename person
    const handleRenamePerson = async (person: PersonWithThumbnail) => {
        const newName = prompt('Rename person:', person.name);
        if (newName && newName !== person.name) {
            await window.api.updatePerson(person.id, newName);
            await loadPeople();
            if (selectedPerson?.id === person.id) {
                setSelectedPerson({ ...person, name: newName });
            }
        }
    };

    // Handle photo click in expanded view
    const handlePhotoClick = (photo: PersonPhoto) => {
        const { setActivePhotoId, setViewMode } = useCatalogStore.getState();
        setActivePhotoId(photo.id);
        setViewMode('loupe');
    };

    // Clear all faces
    const handleClearAllFaces = async () => {
        if (confirm('Are you sure you want to clear all face data? This will remove all people and detected faces.')) {
            await window.api.clearAllFaces();
            setPeople([]);
            setSelectedPerson(null);
            setPersonPhotos([]);
        }
    };

    // Close expanded view
    const closeExpandedView = () => {
        setSelectedPerson(null);
        setPersonPhotos([]);
    };

    // Render expanded person view
    if (selectedPerson) {
        return (
            <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                    <div className="flex items-center gap-4">
                        <button
                            onClick={closeExpandedView}
                            className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            <ArrowLeft size={20} />
                        </button>
                        <div>
                            <h1
                                className="text-2xl font-bold text-white cursor-pointer hover:text-white"
                                onDoubleClick={() => handleRenamePerson(selectedPerson)}
                                title="Double-click to rename"
                            >
                                {selectedPerson.name}
                            </h1>
                            <p className="text-sm text-gray-400">
                                {selectedPerson.face_count} {selectedPerson.face_count === 1 ? 'photo' : 'photos'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Photos grid */}
                <div className="flex-1 overflow-auto p-6">
                    {loadingPhotos ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="animate-spin text-gray-400" size={32} />
                        </div>
                    ) : personPhotos.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-500">
                            <Users size={48} className="mb-4" />
                            <p>No photos found for this person</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                            {personPhotos.map((photo) => (
                                <div
                                    key={photo.id}
                                    className="group relative aspect-square rounded-lg overflow-hidden bg-gray-800"
                                >
                                    <img
                                        src={toLocalUrl(photo.thumbnail_path || photo.file_path)}
                                        alt={photo.file_name}
                                        onClick={() => handlePhotoClick(photo)}
                                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
                                        className="w-full h-full object-cover cursor-pointer transition-transform group-hover:scale-105"
                                        loading="lazy"
                                    />

                                    {/* Action buttons - show on hover */}
                                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        {/* Confirm button */}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleConfirmFace(photo); }}
                                            className="p-1.5 bg-green-600/90 hover:bg-green-500 rounded-full text-white transition-colors"
                                            title="Confirm - This is correct"
                                        >
                                            <Check size={14} />
                                        </button>
                                        {/* Remove button */}
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleRemoveFromPerson(photo); }}
                                            className="p-1.5 bg-red-600/90 hover:bg-red-500 rounded-full text-white transition-colors"
                                            title="Not this person - Remove"
                                        >
                                            <UserX size={14} />
                                        </button>
                                    </div>

                                    {/* Hover overlay */}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // Main view - grid of people
    return (
        <div className="flex-1 flex flex-col overflow-hidden bg-gray-950">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold text-white">AIFACE</h1>
                    {isScanning && (
                        <div className="flex items-center gap-2 text-gray-200 text-sm">
                            <Loader2 className="animate-spin" size={16} />
                            {scanProgress.phase === 'clustering' ? (
                                <span>Grouping similar faces...</span>
                            ) : (
                                <span>Finding people... {scanProgress.current}/{scanProgress.total}</span>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Scan button */}
                    <button
                        onClick={scanFaces}
                        disabled={isScanning}
                        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20
                                   disabled:bg-white/10 text-white rounded-lg transition-colors"
                    >
                        {isScanning ? (
                            <Loader2 className="animate-spin" size={18} />
                        ) : (
                            <ScanFace size={18} />
                        )}
                        <span>Scan Faces</span>
                    </button>

                    {/* Re-group button — re-runs the improved clustering, keeps renamed people */}
                    {people.length > 0 && (
                        <button
                            onClick={handleRecluster}
                            disabled={isScanning}
                            title="Re-grouper les visages (améliore le regroupement, garde les noms)"
                            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600
                                       disabled:opacity-50 text-white rounded-lg transition-colors"
                        >
                            <Users size={18} />
                            <span>Re-grouper</span>
                        </button>
                    )}

                    {/* Clear all button */}
                    {people.length > 0 && (
                        <button
                            onClick={handleClearAllFaces}
                            disabled={isScanning}
                            className="p-2 text-gray-400 hover:text-red-400 hover:bg-gray-800
                                       disabled:opacity-50 rounded-lg transition-colors"
                            title="Clear all face data"
                        >
                            <Trash2 size={18} />
                        </button>
                    )}

                    {/* Sort dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSortMenu(!showSortMenu)}
                            className="flex items-center gap-2 px-3 py-2 text-gray-300 hover:text-white
                                       hover:bg-gray-800 rounded-lg transition-colors"
                        >
                            {sortDirection === 'asc' ? <SortAsc size={18} /> : <SortDesc size={18} />}
                            <span className="text-sm">Sort</span>
                            <ChevronDown size={14} />
                        </button>

                        {showSortMenu && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowSortMenu(false)}
                                />
                                <div className="absolute right-0 top-full mt-1 bg-gray-800 border border-gray-700
                                                rounded-lg shadow-xl z-20 py-1 min-w-[150px]">
                                    <button
                                        onClick={() => { setSortBy('name'); setShowSortMenu(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700
                                                    ${sortBy === 'name' ? 'text-gray-200' : 'text-gray-300'}`}
                                    >
                                        By Name
                                    </button>
                                    <button
                                        onClick={() => { setSortBy('photo_count'); setShowSortMenu(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700
                                                    ${sortBy === 'photo_count' ? 'text-gray-200' : 'text-gray-300'}`}
                                    >
                                        By Photo Count
                                    </button>
                                    <button
                                        onClick={() => { setSortBy('recent'); setShowSortMenu(false); }}
                                        className={`w-full text-left px-4 py-2 text-sm hover:bg-gray-700
                                                    ${sortBy === 'recent' ? 'text-gray-200' : 'text-gray-300'}`}
                                    >
                                        By Recent
                                    </button>
                                    <div className="border-t border-gray-700 my-1" />
                                    <button
                                        onClick={() => {
                                            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
                                            setShowSortMenu(false);
                                        }}
                                        className="w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
                                    >
                                        {sortDirection === 'asc' ? 'Descending' : 'Ascending'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* People grid */}
            <div className="flex-1 overflow-auto p-6">
                {isLoading ? (
                    <div className="flex items-center justify-center h-full">
                        <Loader2 className="animate-spin text-gray-400" size={32} />
                    </div>
                ) : people.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-gray-500">
                        <Users size={64} className="mb-4" />
                        <p className="text-lg mb-2">No people found</p>
                        <p className="text-sm">Click "Scan Faces" to detect faces in your photos</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-5">
                        {sortedPeople.map((person) => (
                            <PersonCard
                                key={person.id}
                                person={person}
                                onClick={() => handlePersonClick(person)}
                                onRename={(p, newName) => {
                                    // Update local state immediately for instant feedback
                                    setPeople(prev => prev.map(pp =>
                                        pp.id === p.id ? { ...pp, name: newName } : pp
                                    ));
                                }}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default AIFaceView;
