import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import catalogDb, { Photo } from '../database/Database';
import metadataService, { ExtractedMetadata } from './MetadataService';
import thumbnailService, { ThumbnailResult } from './ThumbnailService';
import { SUPPORTED_EXTENSIONS, AFFINITY_EXTENSIONS, RAW_EXTENSIONS } from '../database/schema';
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
    keywords?: string[];          // user keywords applied to every imported photo
    deleteAfterImport?: boolean;  // remove the source (card) file once its copy is verified
}

export interface ImportProgress {
    phase: 'scanning' | 'copying' | 'importing' | 'thumbnails' | 'complete' | 'error';
    current: number;
    total: number;
    currentFile?: string;
    importedCount?: number;
    skippedCount?: number;
    errorCount?: number;
    errors?: string[];
    copiedBytes?: number;   // copy phase: bytes landed on the destination
    totalBytes?: number;    // copy phase: bytes to transfer in total
    mbps?: number;          // copy phase: live throughput
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
                    // Check for duplicates — by path AND by name+size, so photos
                    // already imported from this card (to a new path) are skipped
                    // instead of duplicated on every re-import.
                    if (options.skipDuplicates !== false && this.isAlreadyInCatalog(filePath)) {
                        result.skippedFiles.push(filePath);
                        continue;
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

        // Dedup UP FRONT (path AND name+size) so a duplicate is never copied
        // off the card just to be thrown away afterwards.
        const toImport: string[] = [];
        for (const f of imageFiles) {
            if (options.skipDuplicates !== false && this.isAlreadyInCatalog(f)) result.skippedFiles.push(f);
            else toImport.push(f);
        }

        // ---- Fast copy phase (card → destination) --------------------------
        // A small pool of concurrent copies: a card reader feeds 4 streams far
        // better than 1, and the old one-file-at-a-time copyFileSync also froze
        // the main process. Byte-level progress with live MB/s, and a disk-space
        // watchdog: checked before anything is copied (abort with the missing
        // amount) and re-checked during the run (stop cleanly, never fill the
        // destination drive to the last gigabyte).
        const precopied = new Map<string, string>();
        if (options.destinationPath && toImport.length > 0) {
            fs.mkdirSync(options.destinationPath, { recursive: true });

            const sizes = new Map<string, number>();
            let totalBytes = 0;
            for (const f of toImport) {
                try { const sz = fs.statSync(f).size; sizes.set(f, sz); totalBytes += sz; }
                catch { sizes.set(f, 0); }
            }

            const MARGIN = 1024 ** 3; // keep at least 1 GB free on the destination
            const free = await this.freeBytes(options.destinationPath);
            if (free < totalBytes + MARGIN) {
                const missing = (totalBytes + MARGIN - free) / 1024 ** 3;
                const msg = `Espace insuffisant sur le disque de destination : il manque ${missing.toFixed(1)} Go pour copier ${(totalBytes / 1024 ** 3).toFixed(1)} Go. Libère de l'espace ou décoche des photos.`;
                result.success = false;
                result.errors.push({ file: options.destinationPath, error: msg });
                onProgress?.({ phase: 'error', current: 0, total: toImport.length, errors: [msg] });
                result.duration = Date.now() - startTime;
                return result;
            }

            // Collision-safe destination names planned before any copy starts —
            // including collisions WITHIN this batch (two cards, same IMG_0001).
            const planned = new Set<string>();
            for (const f of toImport) {
                const size = sizes.get(f) || 0;
                const ext = path.extname(f);
                const base = path.basename(f, ext);
                let dest = path.join(options.destinationPath, path.basename(f));
                let n = 1;
                while (planned.has(dest) || (fs.existsSync(dest) && fs.statSync(dest).size !== size)) {
                    dest = path.join(options.destinationPath, `${base}_${n++}${ext}`);
                }
                planned.add(dest);
                precopied.set(f, dest);
            }

            let copiedBytes = 0;
            let done = 0;
            let aborted = false;
            const t0 = Date.now();
            const queue = [...toImport];
            const emit = (currentFile?: string) => onProgress?.({
                phase: 'copying',
                current: done,
                total: toImport.length,
                currentFile,
                copiedBytes,
                totalBytes,
                mbps: Math.round(copiedBytes / 1048576 / Math.max(0.5, (Date.now() - t0) / 1000)),
                importedCount: 0,
                skippedCount: result.skippedFiles.length,
                errorCount: result.errors.length
            });
            emit();
            const worker = async () => {
                for (;;) {
                    const src = queue.shift();
                    if (src === undefined || aborted) return;
                    const dest = precopied.get(src)!;
                    try {
                        // Already there from an interrupted run? Skip the bytes.
                        if (!(fs.existsSync(dest) && fs.statSync(dest).size === sizes.get(src))) {
                            await fs.promises.copyFile(src, dest);
                        }
                        copiedBytes += sizes.get(src) || 0;
                    } catch (e: any) {
                        result.errors.push({ file: src, error: String(e?.message || e) });
                        precopied.delete(src);
                    }
                    done++;
                    emit(path.basename(src));
                    if (!aborted && done % 10 === 0 && await this.freeBytes(options.destinationPath!) < MARGIN) {
                        aborted = true;
                        for (const rest of queue.splice(0)) {
                            result.errors.push({ file: rest, error: 'Espace disque insuffisant — import interrompu' });
                            precopied.delete(rest);
                        }
                    }
                }
            };
            await Promise.all([0, 1, 2, 3].map(() => worker()));
        }

        // ---- Register phase (sequential: DB writes stay race-free) ---------
        const files = options.destinationPath ? toImport.filter(f => precopied.has(f)) : toImport;
        for (let i = 0; i < files.length; i++) {
            const filePath = files[i];

            onProgress?.({
                phase: 'importing',
                current: i + 1,
                total: files.length,
                currentFile: path.basename(filePath),
                importedCount: result.importedIds.length,
                skippedCount: result.skippedFiles.length,
                errorCount: result.errors.length
            });

            try {
                const photoId = await this.processFile(filePath, { ...options, sourcePath: filePath }, precopied.get(filePath));
                if (photoId) {
                    result.importedIds.push(photoId);

                    // "Delete from card": only now — the copy has been verified
                    // byte-for-byte in size AND registered in the catalog.
                    if (options.deleteAfterImport && !options.moveFiles && precopied.has(filePath)) {
                        try {
                            const dest = precopied.get(filePath)!;
                            if (fs.statSync(dest).size === fs.statSync(filePath).size) {
                                fs.unlinkSync(filePath);
                            }
                        } catch { /* card may be read-only */ }
                    }
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

    private async processFile(filePath: string, options: ImportOptions, precopiedDest?: string): Promise<string | null> {
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
        if (precopiedDest) {
            // The fast copy phase already landed the file — just take the XMP
            // sidecar along and register against the copy.
            finalPath = precopiedDest;
            if (XmpSvc) {
                const xmpSourcePath = XmpSvc.getXmpPath(filePath);
                if (fs.existsSync(xmpSourcePath)) {
                    try { fs.copyFileSync(xmpSourcePath, XmpSvc.getXmpPath(precopiedDest)); } catch { /* sidecar optional */ }
                }
            }
        } else if (options.destinationPath) {
            // The destination (incl. the dated subfolder) may not exist yet — the
            // copy used to fail with ENOENT on every single file without this.
            fs.mkdirSync(options.destinationPath, { recursive: true });

            // Collision-safe name: two cards both have IMG_0001.JPG; never
            // silently overwrite a different photo that's already there.
            let destFilePath = path.join(options.destinationPath, fileInfo.fileName);
            if (fs.existsSync(destFilePath) && fs.statSync(destFilePath).size !== fileInfo.fileSize) {
                const ext = path.extname(fileInfo.fileName);
                const base = path.basename(fileInfo.fileName, ext);
                let n = 1;
                do {
                    destFilePath = path.join(options.destinationPath, `${base}_${n}${ext}`);
                    n++;
                } while (fs.existsSync(destFilePath) && fs.statSync(destFilePath).size !== fileInfo.fileSize);
            }

            if (options.moveFiles) {
                try {
                    fs.renameSync(filePath, destFilePath);
                } catch (e: any) {
                    // rename can't cross devices (card → disk): copy then remove.
                    if (e?.code !== 'EXDEV') throw e;
                    fs.copyFileSync(filePath, destFilePath);
                    fs.unlinkSync(filePath);
                }
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
                        try {
                            fs.renameSync(xmpSourcePath, xmpDestPath);
                        } catch (e: any) {
                            if (e?.code !== 'EXDEV') throw e;
                            fs.copyFileSync(xmpSourcePath, xmpDestPath);
                            fs.unlinkSync(xmpSourcePath);
                        }
                    } else {
                        fs.copyFileSync(xmpSourcePath, xmpDestPath);
                    }
                }
            }

            // "Delete from card after import": only once the copy is verified
            // byte-for-byte in size — never trade the original for a bad copy.
            if (options.deleteAfterImport && !options.moveFiles) {
                const copied = fs.statSync(destFilePath);
                if (copied.size === fileInfo.fileSize) {
                    try { fs.unlinkSync(filePath); } catch { /* card may be read-only */ }
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

        // Handle keywords - merge from metadata, XMP and the import dialog
        const allKeywords = new Set<string>();

        // Add keywords from embedded metadata
        if (metadata.keywords) {
            metadata.keywords.forEach(k => allKeywords.add(k));
        }

        // Add keywords from XMP sidecar
        if (xmpData?.keywords) {
            xmpData.keywords.forEach(k => allKeywords.add(k));
        }

        // Keywords typed by the user in the import dialog (previously accepted
        // by the UI but silently dropped here).
        if (options.keywords) {
            options.keywords.forEach(k => { if (k && k.trim()) allKeywords.add(k.trim()); });
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

                    // Auto AI tagging: analyze image and store keywords.
                    // Opt-in (same switch as startup tagging) — loading the ONNX
                    // model per import made card imports crawl on an external HDD.
                    try {
                        const { settingsService } = require('../main/services/SettingsService');
                        if (!settingsService.get('autoTagOnStartup')) throw { skipped: true };
                        const { analyzeImage, initializeAI } = require('../main/services/AITaggingService');
                        const aiReady = await initializeAI();
                        if (aiReady) {
                            const imagePath = result.thumbnailPath || photo.file_path;
                            const keywords = await analyzeImage(imagePath);
                            if (keywords.length > 0) {
                                catalogDb.addKeywordsByNameToPhoto(photo.id, keywords);
                                console.log(`[ImportService] AI tagged ${photo.file_name}: [${keywords.join(', ')}]`);
                            }
                        }
                    } catch (aiError) {
                        // AI tagging failure should not block import
                        console.warn(`[ImportService] AI tagging skipped for ${photo.file_name}:`, aiError);
                    }
                }
            } catch (error) {
                console.error(`[ImportService] Failed to generate thumbnails for ${photo.file_path}:`, error);
            }

            onProgress?.(i + 1, photoIds.length);
        }
    }

    /** Available bytes on the volume holding dir (statfs; optimistic on error). */
    private async freeBytes(dir: string): Promise<number> {
        try {
            const st = await (fs.promises as any).statfs(dir);
            return st.bavail * st.bsize;
        } catch {
            return Number.MAX_SAFE_INTEGER;
        }
    }

    // Duplicate fingerprint: exact path, or same name+size anywhere in the
    // catalog (the path changes when a card file is copied to its destination).
    private isAlreadyInCatalog(filePath: string): boolean {
        if (catalogDb.getPhotoByPath(filePath)) return true;
        try {
            const size = fs.statSync(filePath).size;
            return !!catalogDb.findPhotoByNameAndSize(path.basename(filePath), size);
        } catch {
            return false;
        }
    }

    /** Flat listing of a card's importable photos, newest first — feeds the
     *  visual import dialog. No thumbnails here; previews stream separately. */
    async scanCardFiles(dirPath: string): Promise<{
        path: string; name: string; size: number; mtimeMs: number; ext: string; isRaw: boolean;
    }[]> {
        const files = await this.scanDirectory(dirPath, true);
        const out: { path: string; name: string; size: number; mtimeMs: number; ext: string; isRaw: boolean }[] = [];
        for (const f of files) {
            if (!this.isSupportedFile(f)) continue;
            try {
                const st = fs.statSync(f);
                const ext = path.extname(f).toLowerCase();
                out.push({
                    path: f,
                    name: path.basename(f),
                    size: st.size,
                    mtimeMs: st.mtimeMs,
                    ext,
                    isRaw: RAW_EXTENSIONS.includes(ext)
                });
            } catch { /* unreadable entry — leave it out */ }
        }
        out.sort((a, b) => b.mtimeMs - a.mtimeMs);
        return out;
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
