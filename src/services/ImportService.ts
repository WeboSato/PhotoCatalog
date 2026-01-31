import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import catalogDb, { Photo } from '../database/Database';
import metadataService, { ExtractedMetadata } from './MetadataService';
import thumbnailService, { ThumbnailResult } from './ThumbnailService';
import { SUPPORTED_EXTENSIONS, AFFINITY_EXTENSIONS } from '../database/schema';
// XMP Service is in main process, so we import it conditionally
// This service runs in main process so we can import directly
let XmpService: any;
let xmpServiceLoaded = false;

const loadXmpService = () => {
    if (!xmpServiceLoaded) {
        try {
            XmpService = require('../main/services/XmpService').XmpService;
            xmpServiceLoaded = true;
        } catch (e) {
            console.warn('[ImportService] XmpService not available');
        }
    }
    return XmpService;
};

interface XmpMetadata {
    rating?: number;
    label?: string;
    flag?: string;
    keywords?: string[];
    title?: string;
    caption?: string;
    creator?: string;
    copyright?: string;
    develop?: any;
    gpsLatitude?: number;
    gpsLongitude?: number;
}

export interface ImportOptions {
    sourcePath: string;
    recursive?: boolean;
    generateThumbnails?: boolean;
    extractMetadata?: boolean;
    skipDuplicates?: boolean;
    addToCollection?: string;
    moveFiles?: boolean;
    destinationPath?: string;
}

export interface ImportProgress {
    phase: 'scanning' | 'importing' | 'thumbnails' | 'complete' | 'error';
    current: number;
    total: number;
    currentFile?: string;
    importedCount?: number;
    skippedCount?: number;
    errorCount?: number;
    errors?: string[];
}

export interface ImportResult {
    success: boolean;
    importedIds: string[];
    skippedFiles: string[];
    errors: { file: string; error: string }[];
    totalProcessed: number;
    duration: number;
}

type ProgressCallback = (progress: ImportProgress) => void;

class ImportService {
    async importFromPath(
        options: ImportOptions,
        onProgress?: ProgressCallback
    ): Promise<ImportResult> {
        const startTime = Date.now();
        const result: ImportResult = {
            success: true,
            importedIds: [],
            skippedFiles: [],
            errors: [],
            totalProcessed: 0,
            duration: 0
        };

        try {
            // Phase 1: Scan for files
            onProgress?.({
                phase: 'scanning',
                current: 0,
                total: 0,
                currentFile: options.sourcePath
            });

            const files = await this.scanDirectory(options.sourcePath, options.recursive ?? true);
            const imageFiles = files.filter(f => this.isSupportedFile(f));

            if (imageFiles.length === 0) {
                onProgress?.({
                    phase: 'complete',
                    current: 0,
                    total: 0,
                    importedCount: 0,
                    skippedCount: 0,
                    errorCount: 0
                });
                return result;
            }

            result.totalProcessed = imageFiles.length;

            // Phase 2: Import files
            for (let i = 0; i < imageFiles.length; i++) {
                const filePath = imageFiles[i];

                onProgress?.({
                    phase: 'importing',
                    current: i + 1,
                    total: imageFiles.length,
                    currentFile: path.basename(filePath),
                    importedCount: result.importedIds.length,
                    skippedCount: result.skippedFiles.length,
                    errorCount: result.errors.length
                });

                try {
                    // Check for duplicates
                    if (options.skipDuplicates !== false) {
                        const existing = catalogDb.getPhotoByPath(filePath);
                        if (existing) {
                            result.skippedFiles.push(filePath);
                            continue;
                        }
                    }

                    // Process file
                    const photoId = await this.processFile(filePath, options);
                    if (photoId) {
                        result.importedIds.push(photoId);

                        // Add to collection if specified
                        if (options.addToCollection) {
                            catalogDb.addPhotosToCollection(options.addToCollection, [photoId]);
                        }
                    }
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    result.errors.push({ file: filePath, error: errorMsg });
                }
            }

            // Phase 3: Generate thumbnails
            if (options.generateThumbnails !== false && result.importedIds.length > 0) {
                onProgress?.({
                    phase: 'thumbnails',
                    current: 0,
                    total: result.importedIds.length,
                    importedCount: result.importedIds.length,
                    skippedCount: result.skippedFiles.length,
                    errorCount: result.errors.length
                });

                await this.generateThumbnailsForPhotos(result.importedIds, (current, total) => {
                    onProgress?.({
                        phase: 'thumbnails',
                        current,
                        total,
                        importedCount: result.importedIds.length,
                        skippedCount: result.skippedFiles.length,
                        errorCount: result.errors.length
                    });
                });
            }

            // Phase 4: Detect and link edit copies (.afphoto files)
            const affinityFiles = files.filter(f => this.isAffinityFile(f));
            if (affinityFiles.length > 0) {
                console.log(`[ImportService] Found ${affinityFiles.length} Affinity files, linking to originals...`);
                for (const afFile of affinityFiles) {
                    await this.linkAffinityFileToOriginal(afFile);
                }
            }

            result.success = result.errors.length === 0;
            result.duration = Date.now() - startTime;

            onProgress?.({
                phase: 'complete',
                current: imageFiles.length,
                total: imageFiles.length,
                importedCount: result.importedIds.length,
                skippedCount: result.skippedFiles.length,
                errorCount: result.errors.length,
                errors: result.errors.map(e => `${e.file}: ${e.error}`)
            });

        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            result.success = false;
            result.errors.push({ file: options.sourcePath, error: errorMsg });
            result.duration = Date.now() - startTime;

            onProgress?.({
                phase: 'error',
                current: 0,
                total: 0,
                errors: [errorMsg]
            });
        }

        return result;
    }

    async importFiles(
        filePaths: string[],
        options: Omit<ImportOptions, 'sourcePath' | 'recursive'>,
        onProgress?: ProgressCallback
    ): Promise<ImportResult> {
        const startTime = Date.now();
        const result: ImportResult = {
            success: true,
            importedIds: [],
            skippedFiles: [],
            errors: [],
            totalProcessed: filePaths.length,
            duration: 0
        };

        const imageFiles = filePaths.filter(f => this.isSupportedFile(f));

        for (let i = 0; i < imageFiles.length; i++) {
            const filePath = imageFiles[i];

            onProgress?.({
                phase: 'importing',
                current: i + 1,
                total: imageFiles.length,
                currentFile: path.basename(filePath),
                importedCount: result.importedIds.length,
                skippedCount: result.skippedFiles.length,
                errorCount: result.errors.length
            });

            try {
                // Check for duplicates
                if (options.skipDuplicates !== false) {
                    const existing = catalogDb.getPhotoByPath(filePath);
                    if (existing) {
                        result.skippedFiles.push(filePath);
                        continue;
                    }
                }

                const photoId = await this.processFile(filePath, { ...options, sourcePath: filePath });
                if (photoId) {
                    result.importedIds.push(photoId);
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                result.errors.push({ file: filePath, error: errorMsg });
            }
        }

        // Generate thumbnails
        if (options.generateThumbnails !== false && result.importedIds.length > 0) {
            await this.generateThumbnailsForPhotos(result.importedIds, (current, total) => {
                onProgress?.({
                    phase: 'thumbnails',
                    current,
                    total,
                    importedCount: result.importedIds.length,
                    skippedCount: result.skippedFiles.length,
                    errorCount: result.errors.length
                });
            });
        }

        result.success = result.errors.length === 0;
        result.duration = Date.now() - startTime;

        onProgress?.({
            phase: 'complete',
            current: imageFiles.length,
            total: imageFiles.length,
            importedCount: result.importedIds.length,
            skippedCount: result.skippedFiles.length,
            errorCount: result.errors.length
        });

        return result;
    }

    private async processFile(filePath: string, options: ImportOptions): Promise<string | null> {
        // Get file info
        const fileInfo = metadataService.getFileInfo(filePath);
        if (!fileInfo) {
            throw new Error(`Cannot read file info: ${filePath}`);
        }

        // Extract metadata
        let metadata: ExtractedMetadata = {};
        if (options.extractMetadata !== false) {
            metadata = await metadataService.extractMetadata(filePath);
        }

        // Read XMP sidecar file if it exists
        let xmpData: XmpMetadata | null = null;
        const XmpSvc = loadXmpService();
        if (XmpSvc) {
            try {
                xmpData = XmpSvc.readXmp(filePath);
                if (xmpData) {
                    console.log(`[Import] Found XMP sidecar for: ${path.basename(filePath)}`);
                }
            } catch (error) {
                console.warn(`[Import] Failed to read XMP for ${filePath}:`, error);
            }
        }

        // Handle file copy/move if destination is specified
        let finalPath = filePath;
        if (options.destinationPath) {
            const destFilePath = path.join(options.destinationPath, fileInfo.fileName);
            if (options.moveFiles) {
                fs.renameSync(filePath, destFilePath);
            } else {
                fs.copyFileSync(filePath, destFilePath);
            }
            finalPath = destFilePath;

            // Also copy XMP file if it exists
            if (XmpSvc) {
                const xmpSourcePath = XmpSvc.getXmpPath(filePath);
                if (fs.existsSync(xmpSourcePath)) {
                    const xmpDestPath = XmpSvc.getXmpPath(destFilePath);
                    if (options.moveFiles) {
                        fs.renameSync(xmpSourcePath, xmpDestPath);
                    } else {
                        fs.copyFileSync(xmpSourcePath, xmpDestPath);
                    }
                }
            }
        }

        // Create photo record - merge XMP data with extracted metadata
        const photo: Partial<Photo> = {
            id: uuidv4(),
            file_path: finalPath,
            file_name: fileInfo.fileName,
            file_size: fileInfo.fileSize,
            file_type: fileInfo.fileType,
            mime_type: metadata.mimeType,
            width: metadata.width,
            height: metadata.height,
            orientation: metadata.orientation,
            date_taken: metadata.dateTaken,
            date_modified: metadata.dateModified,
            camera_make: metadata.cameraMake,
            camera_model: metadata.cameraModel,
            lens_model: metadata.lensModel,
            focal_length: metadata.focalLength,
            aperture: metadata.aperture,
            shutter_speed: metadata.shutterSpeed,
            iso: metadata.iso,
            flash_used: metadata.flashUsed ? 1 : 0,
            gps_latitude: xmpData?.gpsLatitude || metadata.gpsLatitude,
            gps_longitude: xmpData?.gpsLongitude || metadata.gpsLongitude,
            gps_altitude: metadata.gpsAltitude,
            title: xmpData?.title || metadata.title,
            caption: xmpData?.caption || metadata.caption,
            copyright: xmpData?.copyright || metadata.copyright,
            creator: xmpData?.creator || metadata.creator,
            is_raw: metadata.isRaw || false,
            raw_type: metadata.rawType,
            // Use XMP data for rating/flag/color if available
            rating: xmpData?.rating || 0,
            flag: 'none',
            color_label: (xmpData?.label as any) || 'none',
            indexed: false
        };

        // Store develop settings from XMP if available
        if (xmpData?.develop) {
            (photo as any).develop_settings = JSON.stringify(xmpData.develop);
        }

        // Insert into database
        const photoId = catalogDb.insertPhoto(photo);

        // Handle keywords - merge from metadata and XMP
        const allKeywords = new Set<string>();

        // Add keywords from embedded metadata
        if (metadata.keywords) {
            metadata.keywords.forEach(k => allKeywords.add(k));
        }

        // Add keywords from XMP sidecar
        if (xmpData?.keywords) {
            xmpData.keywords.forEach(k => allKeywords.add(k));
        }

        if (allKeywords.size > 0) {
            const keywordIds: string[] = [];
            for (const keywordName of allKeywords) {
                // Find or create keyword
                const existingKeywords = catalogDb.getKeywords();
                let keyword = existingKeywords.find(k => k.name.toLowerCase() === keywordName.toLowerCase());
                if (!keyword) {
                    const keywordId = catalogDb.createKeyword({ name: keywordName });
                    keywordIds.push(keywordId);
                } else {
                    keywordIds.push(keyword.id);
                }
            }
            if (keywordIds.length > 0) {
                catalogDb.addKeywordsToPhoto(photoId, keywordIds);
            }
        }

        // Update folder tracking
        const folderPath = path.dirname(finalPath);
        const folderName = path.basename(folderPath);
        catalogDb.upsertFolder({
            path: folderPath,
            name: folderName
        });

        return photoId;
    }

    private async generateThumbnailsForPhotos(
        photoIds: string[],
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        for (let i = 0; i < photoIds.length; i++) {
            const photo = catalogDb.getPhoto(photoIds[i]);
            if (!photo) continue;

            try {
                const result = await thumbnailService.generateThumbnails(photo.file_path);
                if (result) {
                    catalogDb.updatePhoto(photo.id, {
                        thumbnail_path: result.thumbnailPath,
                        preview_path: result.previewPath,
                        width: result.width || photo.width,
                        height: result.height || photo.height,
                        indexed: true
                    });
                }
            } catch (error) {
                console.error(`[ImportService] Failed to generate thumbnails for ${photo.file_path}:`, error);
            }

            onProgress?.(i + 1, photoIds.length);
        }
    }

    private async scanDirectory(dirPath: string, recursive: boolean): Promise<string[]> {
        const files: string[] = [];

        const scan = async (currentPath: string): Promise<void> => {
            const entries = fs.readdirSync(currentPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(currentPath, entry.name);

                // Skip hidden files and directories
                if (entry.name.startsWith('.')) continue;

                if (entry.isDirectory() && recursive) {
                    await scan(fullPath);
                } else if (entry.isFile()) {
                    files.push(fullPath);
                }
            }
        };

        await scan(dirPath);
        return files;
    }

    private isSupportedFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return SUPPORTED_EXTENSIONS.includes(ext);
    }

    private isAffinityFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return AFFINITY_EXTENSIONS.includes(ext);
    }

    private async linkAffinityFileToOriginal(affinityPath: string): Promise<boolean> {
        const dir = path.dirname(affinityPath);
        const baseName = path.basename(affinityPath, path.extname(affinityPath));

        // Try to find matching original photo
        // Patterns: "photo.afphoto" -> "photo.nef", "photo_Edit.afphoto" -> "photo.nef"
        const possibleNames = [
            baseName,
            baseName.replace(/_Edit$/i, ''),
            baseName.replace(/-Edit$/i, ''),
            baseName.replace(/ Edit$/i, ''),
            baseName.replace(/_edited$/i, ''),
        ];

        for (const name of possibleNames) {
            // Try to find original with any supported extension
            for (const ext of SUPPORTED_EXTENSIONS) {
                const originalPath = path.join(dir, name + ext);
                if (fs.existsSync(originalPath)) {
                    // Found a potential original - check if it's in our database
                    const photo = catalogDb.getPhotoByPath(originalPath);
                    if (photo && !photo.edit_copy_path) {
                        // Link the Affinity file to this photo
                        console.log(`[ImportService] Linking ${path.basename(affinityPath)} to ${path.basename(originalPath)}`);

                        // Generate thumbnail from Affinity file
                        try {
                            const thumbResult = await thumbnailService.generateThumbnails(affinityPath, { forceRegenerate: true });

                            catalogDb.updatePhoto(photo.id, {
                                edit_copy_path: affinityPath,
                                thumbnail_path: thumbResult?.thumbnailPath || photo.thumbnail_path,
                                preview_path: thumbResult?.previewPath || photo.preview_path
                            });
                            return true;
                        } catch (e) {
                            // If thumbnail generation fails, just link without updating thumbnail
                            catalogDb.updatePhoto(photo.id, {
                                edit_copy_path: affinityPath
                            });
                            return true;
                        }
                    }
                }
            }
        }

        console.log(`[ImportService] No original found for ${path.basename(affinityPath)}`);
        return false;
    }

    async reindexPhoto(photoId: string): Promise<boolean> {
        const photo = catalogDb.getPhoto(photoId);
        if (!photo) return false;

        try {
            // Re-extract metadata
            const metadata = await metadataService.extractMetadata(photo.file_path);

            // Regenerate thumbnails
            const thumbnailResult = await thumbnailService.generateThumbnails(photo.file_path, {
                forceRegenerate: true
            });

            // Update database
            catalogDb.updatePhoto(photoId, {
                width: metadata.width,
                height: metadata.height,
                orientation: metadata.orientation,
                thumbnail_path: thumbnailResult?.thumbnailPath,
                preview_path: thumbnailResult?.previewPath,
                indexed: true
            });

            return true;
        } catch (error) {
            console.error(`[ImportService] Failed to reindex photo ${photoId}:`, error);
            return false;
        }
    }

    async reindexAllPhotos(
        onProgress?: (current: number, total: number) => void
    ): Promise<{ success: number; failed: number }> {
        const photos = catalogDb.getAllPhotos(999999, 0);
        let success = 0;
        let failed = 0;

        for (let i = 0; i < photos.length; i++) {
            const result = await this.reindexPhoto(photos[i].id);
            if (result) success++;
            else failed++;

            onProgress?.(i + 1, photos.length);
        }

        return { success, failed };
    }
}

export const importService = new ImportService();
export default importService;
