import React, { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useCatalogStore, Photo } from '../stores/catalogStore';
import { getThumbnailUrl, PLACEHOLDER_IMAGE } from '../utils/imageUrl';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with bundlers
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

// Create a custom marker icon based on color label
const createColoredIcon = (colorLabel: string) => {
    const colors: Record<string, string> = {
        none: '#9a9aa2',
        red: '#ef4444',
        yellow: '#eab308',
        green: '#22c55e',
        blue: '#3b82f6',
        purple: '#a855f7'
    };

    const color = colors[colorLabel] || colors.none;

    return L.divIcon({
        className: 'custom-marker',
        html: `<div style="
            background-color: ${color};
            width: 24px;
            height: 24px;
            border-radius: 50%;
            border: 3px solid white;
            box-shadow: 0 2px 5px rgba(0,0,0,0.3);
        "></div>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
        popupAnchor: [0, -12]
    });
};

// Component to fit bounds to markers
const FitBounds: React.FC<{ photos: Photo[] }> = ({ photos }) => {
    const map = useMap();

    useEffect(() => {
        const geoPhotos = photos.filter(p => p.gps_latitude && p.gps_longitude);
        if (geoPhotos.length > 0) {
            const bounds = L.latLngBounds(
                geoPhotos.map(p => [p.gps_latitude!, p.gps_longitude!])
            );
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 12 });
        }
    }, [photos, map]);

    return null;
};

// Photo marker component
const PhotoMarker: React.FC<{
    photo: Photo;
    onClick: (photo: Photo) => void;
}> = ({ photo, onClick }) => {
    if (!photo.gps_latitude || !photo.gps_longitude) return null;

    const thumbnailSrc = getThumbnailUrl(photo);

    return (
        <Marker
            position={[photo.gps_latitude, photo.gps_longitude]}
            icon={createColoredIcon(photo.color_label)}
        >
            <Popup>
                <div className="text-center" style={{ minWidth: 150 }}>
                    <img
                        src={thumbnailSrc}
                        alt={photo.file_name}
                        className="w-full h-24 object-cover rounded mb-2"
                        onError={(e) => {
                            (e.target as HTMLImageElement).src = PLACEHOLDER_IMAGE;
                        }}
                    />
                    <p className="text-sm font-medium text-gray-900 truncate">{photo.file_name}</p>
                    <p className="text-xs text-gray-500">{photo.date_taken ? new Date(photo.date_taken).toLocaleDateString() : 'No date'}</p>
                    {photo.camera_model && (
                        <p className="text-xs text-gray-400">{photo.camera_model}</p>
                    )}
                    <button
                        onClick={() => onClick(photo)}
                        className="mt-2 px-3 py-1 bg-white/10 text-white text-xs rounded hover:bg-white/15"
                    >
                        View
                    </button>
                </div>
            </Popup>
        </Marker>
    );
};

// Cluster photos by location (within ~100m)
interface PhotoCluster {
    lat: number;
    lng: number;
    photos: Photo[];
}

const clusterPhotos = (photos: Photo[], precision: number = 3): PhotoCluster[] => {
    const clusters = new Map<string, PhotoCluster>();

    photos.forEach(photo => {
        if (!photo.gps_latitude || !photo.gps_longitude) return;

        // Round to precision decimal places for clustering
        const key = `${photo.gps_latitude.toFixed(precision)},${photo.gps_longitude.toFixed(precision)}`;

        if (!clusters.has(key)) {
            clusters.set(key, {
                lat: photo.gps_latitude,
                lng: photo.gps_longitude,
                photos: []
            });
        }
        clusters.get(key)!.photos.push(photo);
    });

    return Array.from(clusters.values());
};

export const MapView: React.FC = () => {
    const photos = useCatalogStore((s) => s.photos);
    const setActivePhotoId = useCatalogStore((s) => s.setActivePhotoId);
    const setViewMode = useCatalogStore((s) => s.setViewMode);

    // Filter photos with GPS coordinates
    const geoPhotos = useMemo(() =>
        photos.filter(p => p.gps_latitude && p.gps_longitude),
        [photos]
    );

    const handlePhotoClick = (photo: Photo) => {
        setActivePhotoId(photo.id);
        setViewMode('loupe');
    };

    // Default center (will be overridden by FitBounds if there are photos)
    const defaultCenter: [number, number] = [46.8, -71.2]; // Quebec
    const defaultZoom = 4;

    if (geoPhotos.length === 0) {
        return (
            <div className="flex-1 flex items-center justify-center bg-gray-900">
                <div className="text-center">
                    <div className="text-6xl mb-4">🗺️</div>
                    <h3 className="text-xl font-semibold text-white mb-2">No Geotagged Photos</h3>
                    <p className="text-gray-400 max-w-md">
                        None of your photos have GPS coordinates. Photos with location data will appear on this map.
                    </p>
                    <p className="text-gray-500 text-sm mt-4">
                        {photos.length} photos in library, 0 with GPS
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex-1 relative">
            {/* Stats overlay */}
            <div className="absolute top-4 left-4 z-[1000] bg-gray-900/90 text-white px-4 py-2 rounded-lg shadow-lg">
                <p className="text-sm">
                    <span className="font-semibold">{geoPhotos.length}</span> geotagged photos
                    <span className="text-gray-400 ml-2">of {photos.length} total</span>
                </p>
            </div>

            <MapContainer
                center={defaultCenter}
                zoom={defaultZoom}
                className="w-full h-full"
                style={{ background: '#1a1a2e' }}
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <FitBounds photos={geoPhotos} />

                {geoPhotos.map(photo => (
                    <PhotoMarker
                        key={photo.id}
                        photo={photo}
                        onClick={handlePhotoClick}
                    />
                ))}
            </MapContainer>
        </div>
    );
};

export default MapView;
