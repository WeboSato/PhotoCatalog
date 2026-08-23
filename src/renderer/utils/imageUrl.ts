/**
 * Convert a local file path to a URL that can be used in img src
 * Uses the custom local-image:// protocol for security
 *
 * `version`: cache-buster appended as ?v=… . Thumbnails are served with a
 * long max-age for speed, so when a thumbnail is REGENERATED at the same path
 * (external edit came back, crop applied, rotation) the browser would keep
 * showing the stale bitmap forever. Versioning the URL with the photo's
 * updated_at makes any content change fetch fresh bytes immediately.
 */
export function getImageUrl(filePath: string | undefined | null, version?: string | number | null): string {
    if (!filePath) {
        return '';
    }

    // Encode only special characters but keep path structure
    // Replace spaces with %20 but don't encode slashes
    const encodedPath = filePath.split('/').map(part => encodeURIComponent(part)).join('/');
    const v = version ? `?v=${encodeURIComponent(String(version))}` : '';
    return `local-image://${encodedPath}${v}`;
}

/**
 * Get thumbnail URL for a photo
 * Returns placeholder if no thumbnail exists (loading original is too slow)
 */
export function getThumbnailUrl(photo: { thumbnail_path?: string; file_path: string; updated_at?: string }): string {
    // Only use thumbnail if it exists - loading original is too slow for grid
    if (photo.thumbnail_path) {
        return getImageUrl(photo.thumbnail_path, photo.updated_at);
    }
    // Return placeholder for photos without thumbnails
    return PLACEHOLDER_IMAGE;
}

/**
 * Get preview URL for a photo
 */
export function getPreviewUrl(photo: { preview_path?: string; thumbnail_path?: string; file_path: string; updated_at?: string }): string {
    return getImageUrl(photo.preview_path || photo.thumbnail_path || photo.file_path, photo.updated_at);
}

/**
 * Placeholder image for loading/error states
 */
export const PLACEHOLDER_IMAGE = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%23333" width="100" height="100"/><text x="50" y="50" text-anchor="middle" dy=".3em" fill="%23666" font-size="12">No Preview</text></svg>';
