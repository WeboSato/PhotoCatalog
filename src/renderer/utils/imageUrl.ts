/**
 * Convert a local file path to a URL that can be used in img src
 * Uses the custom local-image:// protocol for security
 */
export function getImageUrl(filePath: string | undefined | null): string {
    if (!filePath) {
        return '';
    }

    // Encode only special characters but keep path structure
    // Replace spaces with %20 but don't encode slashes
    const encodedPath = filePath.split('/').map(part => encodeURIComponent(part)).join('/');
    return `local-image://${encodedPath}`;
}

/**
 * Get thumbnail URL for a photo
 * Returns placeholder if no thumbnail exists (loading original is too slow)
 */
export function getThumbnailUrl(photo: { thumbnail_path?: string; file_path: string }): string {
    // Only use thumbnail if it exists - loading original is too slow for grid
    if (photo.thumbnail_path) {
        return getImageUrl(photo.thumbnail_path);
    }
    // Return placeholder for photos without thumbnails
    return PLACEHOLDER_IMAGE;
}

/**
 * Get preview URL for a photo
 */
export function getPreviewUrl(photo: { preview_path?: string; thumbnail_path?: string; file_path: string }): string {
    return getImageUrl(photo.preview_path || photo.thumbnail_path || photo.file_path);
}

/**
 * Placeholder image for loading/error states
 */
export const PLACEHOLDER_IMAGE = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text x="50" y="50" text-anchor="middle" dy=".3em" fill="%23666" font-size="12">No Preview</text></svg>';
