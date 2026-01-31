import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { execSync } from 'child_process';
import { RAW_EXTENSIONS } from '../database/schema';

// Safe logging to prevent EPIPE errors when console pipe is closed
const safeLog = (message: string, ...args: any[]) => {
    try { console.log(message, ...args); } catch {}
};
const safeError = (message: string, ...args: any[]) => {
    try { console.error(message, ...args); } catch {}
};

export interface ThumbnailOptions {
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    quality?: number;
    format?: 'jpeg' | 'webp' | 'png';
}

export interface ThumbnailResult {
    thumbnailPath: string;
    previewPath: string;
    width: number;
    height: number;
}

const THUMBNAIL_SIZES = {
    small: { width: 256, height: 256 },
    medium: { width: 512, height: 512 },
    large: { width: 1024, height: 1024 },
    preview: { width: 2048, height: 2048 }
};

// Lightroom-style structure uses 16 hex folders (0-F)
const HEX_FOLDERS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];

class ThumbnailService {
    private cacheDir: string = '';
    private thumbnailDir: string = '';
    private previewDir: string = '';
    private useLightroomStructure: boolean = false;

    initialize(customCacheDir?: string, lightroomStyle: boolean = false): void {
        this.cacheDir = customCacheDir || path.join(
            app?.getPath('userData') || process.cwd(),
            'thumbnails'
        );
        this.useLightroomStructure = lightroomStyle;

        if (this.useLightroomStructure) {
            // Lightroom-style: single level with 16 hex subfolders
            this.thumbnailDir = this.cacheDir;
            this.previewDir = this.cacheDir;

            // Create 16 hex folders
            for (const hex of HEX_FOLDERS) {
                fs.mkdirSync(path.join(this.cacheDir, hex), { recursive: true });
            }
            safeLog(`[ThumbnailService] Initialized Lightroom-style at ${this.cacheDir}`);
        } else {
            // Legacy structure with thumbs/previews subdirectories
            this.thumbnailDir = path.join(this.cacheDir, 'thumbs');
            this.previewDir = path.join(this.cacheDir, 'previews');

            fs.mkdirSync(this.thumbnailDir, { recursive: true });
            fs.mkdirSync(this.previewDir, { recursive: true });
            safeLog(`[ThumbnailService] Initialized at ${this.cacheDir}`);
        }
    }

    private getHashedPath(filePath: string): string {
        const hash = crypto.createHash('md5').update(filePath).digest('hex');

        if (this.useLightroomStructure) {
            // Lightroom-style: use first character for folder (0-F), rest for filename
            const folder = hash.charAt(0).toUpperCase();
            return path.join(folder, hash);
        } else {
            // Legacy: use first 2 characters for nested folders
            return path.join(hash.substring(0, 2), hash.substring(2, 4), hash);
        }
    }

    async generateThumbnails(
        sourcePath: string,
        options: { forceRegenerate?: boolean; generatePreview?: boolean } = {}
    ): Promise<ThumbnailResult | null> {
        const { forceRegenerate = false, generatePreview = true } = options;

        try {
            // Check if source file exists
            if (!fs.existsSync(sourcePath)) {
                throw new Error(`Source file not found: ${sourcePath}`);
            }

            const hashedPath = this.getHashedPath(sourcePath);
            const thumbnailPath = path.join(this.thumbnailDir, `${hashedPath}.webp`);
            const previewPath = path.join(this.previewDir, `${hashedPath}.webp`);

            // Check if thumbnails already exist
            if (!forceRegenerate && fs.existsSync(thumbnailPath)) {
                // Get dimensions from existing thumbnail
                const metadata = await sharp(thumbnailPath).metadata();
                return {
                    thumbnailPath,
                    previewPath: fs.existsSync(previewPath) ? previewPath : thumbnailPath,
                    width: metadata.width || 0,
                    height: metadata.height || 0
                };
            }

            // Ensure thumbnail directory exists
            const thumbnailDir = path.dirname(thumbnailPath);
            const previewDir = path.dirname(previewPath);
            fs.mkdirSync(thumbnailDir, { recursive: true });
            fs.mkdirSync(previewDir, { recursive: true });

            // Check file type
            const ext = path.extname(sourcePath).toLowerCase();
            const isRaw = RAW_EXTENSIONS.includes(ext);
            const isPsd = ext === '.psd';
            const isAffinity = ext === '.af' || ext === '.afphoto';
            const isVideo = ['.mov', '.mp4', '.avi', '.m4v', '.mkv', '.webm'].includes(ext);

            let imageBuffer: Buffer;
            let originalWidth = 0;
            let originalHeight = 0;

            if (isVideo) {
                // Handle video files - extract first frame using ffmpeg
                const tempJpeg = path.join(this.cacheDir, `temp_video_${Date.now()}.jpg`);
                try {
                    // Try ffmpeg first
                    execSync(`ffmpeg -i "${sourcePath}" -ss 00:00:01 -vframes 1 -y "${tempJpeg}" 2>/dev/null`, {
                        timeout: 30000
                    });
                    if (fs.existsSync(tempJpeg) && fs.statSync(tempJpeg).size > 0) {
                        const jpegImage = sharp(tempJpeg);
                        const metadata = await jpegImage.metadata();
                        originalWidth = metadata.width || 0;
                        originalHeight = metadata.height || 0;
                        imageBuffer = await jpegImage.toBuffer();
                        fs.unlinkSync(tempJpeg);
                    } else {
                        throw new Error('ffmpeg failed to extract frame');
                    }
                } catch (videoError) {
                    if (fs.existsSync(tempJpeg)) {
                        try { fs.unlinkSync(tempJpeg); } catch {}
                    }
                    safeError(`[ThumbnailService] Cannot extract frame from video: ${sourcePath}`);
                    throw new Error(`Cannot extract frame from video: ${sourcePath}`);
                }
            } else if (isAffinity) {
                // Handle Affinity Photo files (.af, .afphoto) using Quick Look
                const tempPng = path.join(this.cacheDir, `temp_affinity_${Date.now()}.png`);
                let converted = false;
                try {
                    // Use qlmanage (Quick Look) to generate preview
                    try {
                        execSync(`qlmanage -t -s 2048 -o "${this.cacheDir}" "${sourcePath}" 2>/dev/null`, {
                            timeout: 60000
                        });
                        // qlmanage creates file with .png extension added to original name
                        const qlOutput = path.join(this.cacheDir, path.basename(sourcePath) + '.png');
                        if (fs.existsSync(qlOutput) && fs.statSync(qlOutput).size > 0) {
                            fs.renameSync(qlOutput, tempPng);
                            converted = true;
                        }
                    } catch {}

                    // Try sips as fallback
                    if (!converted) {
                        try {
                            execSync(`sips -s format png "${sourcePath}" --out "${tempPng}" 2>/dev/null`, {
                                timeout: 60000
                            });
                            if (fs.existsSync(tempPng) && fs.statSync(tempPng).size > 0) {
                                converted = true;
                            }
                        } catch {}
                    }

                    if (converted && fs.existsSync(tempPng)) {
                        const pngImage = sharp(tempPng);
                        const metadata = await pngImage.metadata();
                        originalWidth = metadata.width || 0;
                        originalHeight = metadata.height || 0;
                        imageBuffer = await pngImage.toBuffer();
                        fs.unlinkSync(tempPng);
                        safeLog(`[ThumbnailService] Generated thumbnail from Affinity file: ${sourcePath}`);
                    } else {
                        throw new Error('Cannot convert Affinity file');
                    }
                } catch (affinityError) {
                    if (fs.existsSync(tempPng)) {
                        try { fs.unlinkSync(tempPng); } catch {}
                    }
                    safeError(`[ThumbnailService] Cannot process Affinity file: ${sourcePath}`);
                    throw new Error(`Cannot process Affinity file: ${sourcePath}`);
                }
            } else if (isPsd) {
                // Handle PSD files using sips (macOS) or ImageMagick
                const tempJpeg = path.join(this.cacheDir, `temp_psd_${Date.now()}.jpg`);
                let converted = false;
                try {
                    // Try sips first (macOS built-in)
                    try {
                        execSync(`sips -s format jpeg "${sourcePath}" --out "${tempJpeg}" 2>/dev/null`, {
                            timeout: 60000
                        });
                        if (fs.existsSync(tempJpeg) && fs.statSync(tempJpeg).size > 0) {
                            converted = true;
                        }
                    } catch {}

                    // Try ImageMagick if sips failed
                    if (!converted) {
                        try {
                            execSync(`convert "${sourcePath}[0]" "${tempJpeg}" 2>/dev/null`, {
                                timeout: 60000
                            });
                            if (fs.existsSync(tempJpeg) && fs.statSync(tempJpeg).size > 0) {
                                converted = true;
                            }
                        } catch {}
                    }

                    if (converted && fs.existsSync(tempJpeg)) {
                        const jpegImage = sharp(tempJpeg);
                        const metadata = await jpegImage.metadata();
                        originalWidth = metadata.width || 0;
                        originalHeight = metadata.height || 0;
                        imageBuffer = await jpegImage.toBuffer();
                        fs.unlinkSync(tempJpeg);
                    } else {
                        throw new Error('Cannot convert PSD file');
                    }
                } catch (psdError) {
                    if (fs.existsSync(tempJpeg)) {
                        try { fs.unlinkSync(tempJpeg); } catch {}
                    }
                    safeError(`[ThumbnailService] Cannot process PSD file: ${sourcePath}`);
                    throw new Error(`Cannot process PSD file: ${sourcePath}`);
                }
            } else if (isRaw) {
                // For RAW files, try multiple methods
                const tempJpeg = path.join(this.cacheDir, `temp_${Date.now()}.jpg`);
                let converted = false;

                try {
                    // Method 1: Use darktable-cli (best quality)
                    const darktablePath = '/Applications/darktable.app/Contents/MacOS/darktable-cli';
                    if (fs.existsSync(darktablePath)) {
                        try {
                            safeLog(`[ThumbnailService] Using darktable-cli for: ${sourcePath}`);
                            execSync(`"${darktablePath}" "${sourcePath}" "${tempJpeg}" --width 2048 --height 2048 2>/dev/null`, {
                                timeout: 60000,
                                env: { ...process.env, HOME: process.env.HOME || '/tmp' }
                            });
                            if (fs.existsSync(tempJpeg) && fs.statSync(tempJpeg).size > 0) {
                                converted = true;
                            }
                        } catch (dtError) {
                            safeLog(`[ThumbnailService] darktable-cli failed, trying sips`);
                        }
                    }

                    // Method 2: Use sips (macOS built-in)
                    if (!converted) {
                        try {
                            execSync(`sips -s format jpeg "${sourcePath}" --out "${tempJpeg}" 2>/dev/null`, {
                                timeout: 30000
                            });
                            if (fs.existsSync(tempJpeg) && fs.statSync(tempJpeg).size > 0) {
                                converted = true;
                            }
                        } catch (sipsError) {
                            safeLog(`[ThumbnailService] sips failed, trying embedded JPEG extraction`);
                        }
                    }

                    // Method 3: Extract embedded JPEG
                    if (!converted) {
                        const buffer = fs.readFileSync(sourcePath);
                        const jpegStart = this.findJpegMarker(buffer);
                        if (jpegStart >= 0) {
                            fs.writeFileSync(tempJpeg, buffer.slice(jpegStart));
                            converted = true;
                        }
                    }

                    if (converted && fs.existsSync(tempJpeg)) {
                        const jpegImage = sharp(tempJpeg);
                        const metadata = await jpegImage.metadata();
                        originalWidth = metadata.width || 0;
                        originalHeight = metadata.height || 0;
                        imageBuffer = await jpegImage.toBuffer();
                        fs.unlinkSync(tempJpeg);
                    } else {
                        throw new Error('All RAW conversion methods failed');
                    }
                } catch (rawError) {
                    // Clean up temp file
                    if (fs.existsSync(tempJpeg)) {
                        try { fs.unlinkSync(tempJpeg); } catch {}
                    }
                    safeError(`[ThumbnailService] Cannot process RAW file: ${sourcePath}`, rawError);
                    throw new Error(`Cannot extract preview from RAW file: ${sourcePath}`);
                }
            } else {
                // Standard image formats
                const image = sharp(sourcePath);
                const metadata = await image.metadata();
                originalWidth = metadata.width || 0;
                originalHeight = metadata.height || 0;
                imageBuffer = await image.toBuffer();
            }

            // Generate thumbnail (medium size)
            await sharp(imageBuffer)
                .rotate() // Auto-rotate based on EXIF orientation
                .resize(THUMBNAIL_SIZES.medium.width, THUMBNAIL_SIZES.medium.height, {
                    fit: 'inside',
                    withoutEnlargement: true
                })
                .webp({ quality: 85 })
                .toFile(thumbnailPath);

            // Generate preview (larger size)
            if (generatePreview) {
                await sharp(imageBuffer)
                    .rotate()
                    .resize(THUMBNAIL_SIZES.preview.width, THUMBNAIL_SIZES.preview.height, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .webp({ quality: 90 })
                    .toFile(previewPath);
            }

            return {
                thumbnailPath,
                previewPath: generatePreview ? previewPath : thumbnailPath,
                width: originalWidth,
                height: originalHeight
            };

        } catch (error) {
            safeError(`[ThumbnailService] Error generating thumbnails for ${sourcePath}:`, error);
            return null;
        }
    }

    private findJpegMarker(buffer: Buffer): number {
        // Look for JPEG SOI marker (0xFFD8)
        for (let i = 0; i < buffer.length - 1; i++) {
            if (buffer[i] === 0xFF && buffer[i + 1] === 0xD8) {
                // Verify it's followed by a valid JPEG marker
                if (buffer[i + 2] === 0xFF) {
                    return i;
                }
            }
        }
        return -1;
    }

    async generateBulkThumbnails(
        filePaths: string[],
        onProgress?: (current: number, total: number, filePath: string) => void
    ): Promise<Map<string, ThumbnailResult | null>> {
        const results = new Map<string, ThumbnailResult | null>();
        const total = filePaths.length;

        // Process in batches for better performance
        const batchSize = 5;
        for (let i = 0; i < total; i += batchSize) {
            const batch = filePaths.slice(i, i + batchSize);
            const promises = batch.map(async (filePath) => {
                const result = await this.generateThumbnails(filePath);
                results.set(filePath, result);
                return { filePath, result };
            });

            await Promise.all(promises);

            if (onProgress) {
                const completed = Math.min(i + batchSize, total);
                onProgress(completed, total, batch[batch.length - 1]);
            }
        }

        return results;
    }

    getThumbnailPath(sourcePath: string): string | null {
        const hashedPath = this.getHashedPath(sourcePath);
        const thumbnailPath = path.join(this.thumbnailDir, `${hashedPath}.webp`);
        return fs.existsSync(thumbnailPath) ? thumbnailPath : null;
    }

    getPreviewPath(sourcePath: string): string | null {
        const hashedPath = this.getHashedPath(sourcePath);
        const previewPath = path.join(this.previewDir, `${hashedPath}.webp`);
        return fs.existsSync(previewPath) ? previewPath : null;
    }

    async deleteThumbnails(sourcePath: string): Promise<void> {
        const hashedPath = this.getHashedPath(sourcePath);
        const thumbnailPath = path.join(this.thumbnailDir, `${hashedPath}.webp`);
        const previewPath = path.join(this.previewDir, `${hashedPath}.webp`);

        try {
            if (fs.existsSync(thumbnailPath)) {
                fs.unlinkSync(thumbnailPath);
            }
            if (fs.existsSync(previewPath)) {
                fs.unlinkSync(previewPath);
            }
        } catch (error) {
            safeError(`[ThumbnailService] Error deleting thumbnails for ${sourcePath}:`, error);
        }
    }

    async clearAllThumbnails(): Promise<void> {
        try {
            fs.rmSync(this.cacheDir, { recursive: true, force: true });
            fs.mkdirSync(this.thumbnailDir, { recursive: true });
            fs.mkdirSync(this.previewDir, { recursive: true });
            safeLog('[ThumbnailService] All thumbnails cleared');
        } catch (error) {
            safeError('[ThumbnailService] Error clearing thumbnails:', error);
        }
    }

    getCacheSize(): { thumbnails: number; previews: number; total: number } {
        const getDirectorySize = (dir: string): number => {
            if (!fs.existsSync(dir)) return 0;
            let size = 0;
            const walkSync = (currentPath: string) => {
                const files = fs.readdirSync(currentPath);
                for (const file of files) {
                    const filePath = path.join(currentPath, file);
                    const stat = fs.statSync(filePath);
                    if (stat.isDirectory()) {
                        walkSync(filePath);
                    } else {
                        size += stat.size;
                    }
                }
            };
            walkSync(dir);
            return size;
        };

        const thumbnails = getDirectorySize(this.thumbnailDir);
        const previews = getDirectorySize(this.previewDir);
        return { thumbnails, previews, total: thumbnails + previews };
    }

    async resizeImage(
        sourcePath: string,
        outputPath: string,
        options: ThumbnailOptions
    ): Promise<void> {
        const { width, height, fit = 'inside', quality = 90, format = 'jpeg' } = options;

        let pipeline = sharp(sourcePath).rotate();

        if (width || height) {
            pipeline = pipeline.resize(width, height, { fit, withoutEnlargement: true });
        }

        switch (format) {
            case 'webp':
                pipeline = pipeline.webp({ quality });
                break;
            case 'png':
                pipeline = pipeline.png({ quality });
                break;
            case 'jpeg':
            default:
                pipeline = pipeline.jpeg({ quality });
                break;
        }

        await pipeline.toFile(outputPath);
    }
}

export const thumbnailService = new ThumbnailService();
export default thumbnailService;
