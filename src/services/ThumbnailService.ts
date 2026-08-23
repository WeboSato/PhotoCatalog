import sharp from 'sharp';
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { execSync } from 'child_process';
import { RAW_EXTENSIONS } from '../database/schema';
import { encode } from 'blurhash';

// Cap libvips concurrency so background thumbnail (re)generation never saturates
// every core while the user is scrolling. Leave one core free for the UI/main
// process. sharp.cache(false) avoids holding decoded originals in memory across
// the batch jobs (main.ts runs regen + AI tagging in the background on startup).
sharp.concurrency(Math.max(1, os.cpus().length - 1));
sharp.cache(false);

// Safe logging to prevent EPIPE errors when console pipe is closed
const timestamp = () => new Date().toISOString();
const safeLog = (message: string, ...args: any[]) => {
    try { console.log(`[${timestamp()}] ${message}`, ...args); } catch {}
};
const safeError = (message: string, ...args: any[]) => {
    try { console.error(`[${timestamp()}] ${message}`, ...args); } catch {}
};

export interface ThumbnailOptions {
    width?: number;
    height?: number;
    fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
    quality?: number;
    format?: 'jpeg' | 'webp' | 'png' | 'avif';
    generateAllSizes?: boolean; // Generate small, medium, large, preview
}

export interface ThumbnailResult {
    thumbnailPath: string;      // medium (512px)
    previewPath: string;        // preview (2048px)
    smallPath: string;          // small (256px)
    largePath: string;          // large (1024px)
    width: number;
    height: number;
    blurHash?: string;          // BlurHash for placeholder
    format: 'webp';
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
    private faceCropDir: string = '';
    private useLightroomStructure: boolean = false;

    // --- SSD mirror --------------------------------------------------------
    // When the thumbnail cache lives on an external volume (catalog kept next to
    // the photos on a USB HDD), every cold grid read pays a seek penalty — and
    // Chromium's HTTP cache can't be trusted to hold 20k+ entries "forever".
    // Lightroom solves this with a local preview cache on the internal disk; we
    // do the same: each thumbnail served is mirrored once into userData, and all
    // later reads — including after a relaunch — come from the SSD. Mirror files
    // keep the source's mtime so ETags are identical whichever disk serves.
    private mirrorDir: string = '';
    private mirrorActive: boolean = false;
    private mirrorInflight = new Set<string>();

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

        // Square face crops for the people view (Layer 2).
        this.faceCropDir = path.join(this.cacheDir, 'faces');
        fs.mkdirSync(this.faceCropDir, { recursive: true });

        // Mirror only earns its keep when the cache is NOT on the internal disk.
        const userData = app?.getPath('userData') || '';
        this.mirrorDir = path.join(userData, 'thumb-mirror');
        this.mirrorActive = userData !== '' && (process.platform === 'darwin'
            ? this.cacheDir.startsWith('/Volumes/')
            : !this.cacheDir.startsWith(userData));
        if (this.mirrorActive) {
            try {
                fs.mkdirSync(this.mirrorDir, { recursive: true });
                safeLog(`[ThumbnailService] SSD mirror active at ${this.mirrorDir}`);
            } catch {
                this.mirrorActive = false;
            }
        }
    }

    /** True for files living inside the thumbnail cache (thumbs/previews/faces). */
    isCachedFile(filePath: string): boolean {
        return this.cacheDir !== '' && filePath.startsWith(this.cacheDir + path.sep);
    }

    private mirrorKeyFor(filePath: string): string {
        const hash = crypto.createHash('md5').update(filePath).digest('hex');
        return path.join(this.mirrorDir, `${hash}.webp`);
    }

    private async mirrorFreeBytes(): Promise<number> {
        try {
            const s = await (fs.promises as any).statfs(this.mirrorDir);
            return s.bavail * s.bsize;
        } catch {
            return Number.MAX_SAFE_INTEGER; // can't tell — don't block on it
        }
    }

    /** SSD copy of this cached file if we have one — lets serving skip the HDD entirely. */
    async mirrorLookup(filePath: string): Promise<{ path: string; size: number; mtimeMs: number; mtime: Date } | null> {
        if (!this.mirrorActive || !this.isCachedFile(filePath)) return null;
        const m = this.mirrorKeyFor(filePath);
        try {
            const stat = await fs.promises.stat(m);
            return stat.size > 0 ? { path: m, size: stat.size, mtimeMs: stat.mtimeMs, mtime: stat.mtime } : null;
        } catch {
            return null;
        }
    }

    /** Copy a served file into the SSD mirror (atomic rename, mtime preserved). */
    async mirrorStore(filePath: string, srcTimes?: { atime: Date; mtime: Date }): Promise<boolean> {
        if (!this.mirrorActive || !this.isCachedFile(filePath)) return false;
        const dest = this.mirrorKeyFor(filePath);
        if (this.mirrorInflight.has(dest)) return false;
        this.mirrorInflight.add(dest);
        const tmp = `${dest}.${process.pid}.tmp`;
        try {
            const times = srcTimes ?? await fs.promises.stat(filePath);
            await fs.promises.copyFile(filePath, tmp);
            await fs.promises.utimes(tmp, times.atime, times.mtime); // keep ETag identical
            await fs.promises.rename(tmp, dest);
            return true;
        } catch {
            fs.promises.unlink(tmp).catch(() => {});
            return false;
        } finally {
            this.mirrorInflight.delete(dest);
        }
    }

    /**
     * Full-resolution TIFF for the "linked edit copy" round-trip. Affinity (and
     * any editor) can re-save a TIFF in place with a plain Cmd+S — which a RAW
     * can never do — so this is what makes the Lightroom-style flow possible.
     * Quality ladder: darktable-cli (real demosaic) → sips → embedded JPEG.
     */
    async renderEditableTiff(sourcePath: string, outPath: string): Promise<boolean> {
        const ext = path.extname(sourcePath).toLowerCase();
        try {
            if (!RAW_EXTENSIONS.includes(ext)) {
                // Standard formats: one sharp pass, full resolution.
                await sharp(sourcePath).rotate().withMetadata().tiff({ compression: 'lzw' }).toFile(outPath);
                return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
            }

            // RAW: darktable gives a real full-res demosaic when installed.
            const darktablePath = '/Applications/darktable.app/Contents/MacOS/darktable-cli';
            if (fs.existsSync(darktablePath)) {
                try {
                    execSync(`"${darktablePath}" "${sourcePath}" "${outPath}" 2>/dev/null`, {
                        timeout: 120000,
                        env: { ...process.env, HOME: process.env.HOME || '/tmp' }
                    });
                    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return true;
                } catch { /* fall through */ }
            }

            // sips (macOS built-in) decodes most RAW formats at full size.
            try {
                execSync(`sips -s format tiff "${sourcePath}" --out "${outPath}" 2>/dev/null`, { timeout: 60000 });
                if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) return true;
            } catch { /* fall through */ }

            // Last resort: the RAW's embedded JPEG (smaller, but always available).
            const buffer = fs.readFileSync(sourcePath);
            const jpegStart = this.findJpegMarker(buffer);
            if (jpegStart >= 0) {
                await sharp(buffer.slice(jpegStart)).rotate().withMetadata().tiff({ compression: 'lzw' }).toFile(outPath);
                return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
            }
            return false;
        } catch {
            fs.promises.unlink(outPath).catch(() => {});
            return false;
        }
    }

    /**
     * Fast 320px preview for the card-import dialog. Speed over fidelity:
     * RAW files use their embedded JPEG (milliseconds) with a sips fallback —
     * never the darktable pipeline, which can take a minute per file.
     */
    async quickPreview(sourcePath: string, outPath: string): Promise<boolean> {
        let tempJpeg: string | null = null;
        try {
            const ext = path.extname(sourcePath).toLowerCase();
            let src: string | Buffer = sourcePath;
            if (RAW_EXTENSIONS.includes(ext)) {
                const buffer = fs.readFileSync(sourcePath);
                const jpegStart = this.findJpegMarker(buffer);
                if (jpegStart >= 0) {
                    src = buffer.slice(jpegStart);
                } else {
                    tempJpeg = path.join(this.cacheDir, `temp_qp_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`);
                    execSync(`sips -s format jpeg "${sourcePath}" --out "${tempJpeg}" 2>/dev/null`, { timeout: 15000 });
                    if (!fs.existsSync(tempJpeg) || fs.statSync(tempJpeg).size === 0) return false;
                    src = tempJpeg;
                }
            }
            await sharp(src)
                .rotate() // honour EXIF orientation
                .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 72 })
                .toFile(outPath);
            return true;
        } catch {
            return false;
        } finally {
            if (tempJpeg) fs.promises.unlink(tempJpeg).catch(() => {});
        }
    }

    /** Compute a BlurHash from an existing (thumbnail-sized) file — backfill path. */
    async blurHashFromFile(filePath: string): Promise<string | null> {
        try {
            const { data, info } = await sharp(filePath)
                .resize(32, 32, { fit: 'inside' })
                .ensureAlpha()
                .raw()
                .toBuffer({ resolveWithObject: true });
            return encode(new Uint8ClampedArray(data), info.width, info.height, 4, 3);
        } catch {
            return null;
        }
    }

    /** Drop mirror entries for outputs about to be rewritten (rotation, re-edit). */
    mirrorInvalidate(...filePaths: string[]): void {
        if (!this.mirrorActive) return;
        for (const fp of filePaths) {
            fs.promises.unlink(this.mirrorKeyFor(fp)).catch(() => {});
        }
    }

    /**
     * Background trickle-copy of the thumbnail set to the SSD: a few files at a
     * time with pauses, so interactive reads keep priority on the slow disk.
     * After one warm pass the grid never touches the HDD again for known thumbs.
     */
    async warmMirror(paths: string[]): Promise<{ copied: number; skipped: number }> {
        if (!this.mirrorActive) return { copied: 0, skipped: 0 };
        let existing: Set<string>;
        try {
            existing = new Set(await fs.promises.readdir(this.mirrorDir));
        } catch {
            existing = new Set();
        }
        const todo = paths.filter(p =>
            p && this.isCachedFile(p) && !existing.has(path.basename(this.mirrorKeyFor(p))));
        const skipped = paths.length - todo.length;

        const MIN_FREE = 8 * 1024 * 1024 * 1024; // never eat the last 8 GB of the SSD
        if (todo.length === 0 || await this.mirrorFreeBytes() < MIN_FREE) {
            if (todo.length > 0) safeLog('[ThumbMirror] low disk space — warm pass skipped');
            return { copied: 0, skipped };
        }

        let copied = 0;
        for (let i = 0; i < todo.length; i++) {
            if (await this.mirrorStore(todo[i])) copied++;
            if (i % 4 === 3) await new Promise(r => setTimeout(r, 350)); // ~11 files/s
            if (i % 400 === 399 && await this.mirrorFreeBytes() < MIN_FREE) break;
            if (copied > 0 && copied % 2000 === 0) safeLog(`[ThumbMirror] warming… ${copied}/${todo.length}`);
        }
        return { copied, skipped };
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
            const smallPath = path.join(this.thumbnailDir, `${hashedPath}_sm.webp`);
            const thumbnailPath = path.join(this.thumbnailDir, `${hashedPath}.webp`);
            const largePath = path.join(this.thumbnailDir, `${hashedPath}_lg.webp`);
            const previewPath = path.join(this.previewDir, `${hashedPath}_pv.webp`);

            // Check if thumbnails already exist (use medium as sentinel)
            if (!forceRegenerate) {
                const thumbExists = await fs.promises.access(thumbnailPath, fs.constants.F_OK).then(() => true).catch(() => false);

                if (thumbExists) {
                    const metadata = await sharp(thumbnailPath).metadata();
                    return {
                        thumbnailPath,
                        previewPath,
                        smallPath,
                        largePath,
                        width: metadata.width || 0,
                        height: metadata.height || 0,
                        format: 'webp' as const
                    };
                }
            }

            // These files are about to be (re)written — drop stale SSD mirror copies
            // so rotations/edits never serve an outdated image.
            this.mirrorInvalidate(smallPath, thumbnailPath, largePath, previewPath);

            // Ensure output directories exist
            const thumbnailDir = path.dirname(thumbnailPath);
            const previewDir = path.dirname(previewPath);
            if (thumbnailDir !== previewDir) {
                fs.mkdirSync(thumbnailDir, { recursive: true });
                fs.mkdirSync(previewDir, { recursive: true });
            } else {
                fs.mkdirSync(thumbnailDir, { recursive: true });
            }

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

            // Verify buffer is valid before processing
            if (!imageBuffer || imageBuffer.length === 0) {
                throw new Error(`Empty image buffer generated for: ${sourcePath}`);
            }

            // Adaptive quality per size
            const sizeConfigs = [
                { key: 'small',   size: THUMBNAIL_SIZES.small,   quality: 75, output: smallPath },
                { key: 'medium',  size: THUMBNAIL_SIZES.medium,  quality: 85, output: thumbnailPath },
                { key: 'large',   size: THUMBNAIL_SIZES.large,   quality: 88, output: largePath },
                { key: 'preview', size: THUMBNAIL_SIZES.preview, quality: 92, output: previewPath },
            ];

            // Generate all 4 sizes in parallel
            await Promise.all(sizeConfigs.map(({ size, quality, output }) =>
                sharp(imageBuffer)
                    .rotate() // Auto-rotate based on EXIF orientation
                    .resize(size.width, size.height, {
                        fit: 'inside',
                        withoutEnlargement: true
                    })
                    .webp({ quality })
                    .toFile(output)
            ));

            // Generate BlurHash from a tiny version of the image
            let blurHash: string | undefined;
            try {
                const { data: rawPixels, info: rawInfo } = await sharp(imageBuffer)
                    .rotate()
                    .resize(32, 32, { fit: 'inside' })
                    .ensureAlpha()
                    .raw()
                    .toBuffer({ resolveWithObject: true });

                blurHash = encode(
                    new Uint8ClampedArray(rawPixels),
                    rawInfo.width,
                    rawInfo.height,
                    4, 3
                );
            } catch (blurError: any) {
                safeError(`[ThumbnailService] BlurHash generation failed for ${sourcePath}:`, blurError?.message);
            }

            return {
                thumbnailPath,
                previewPath,
                smallPath,
                largePath,
                width: originalWidth,
                height: originalHeight,
                blurHash,
                format: 'webp' as const
            };

        } catch (error: any) {
            safeError(`[ThumbnailService] Error generating thumbnails`, {
                sourcePath,
                error: error?.message || error,
                stack: error?.stack
            });
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

        // Adaptive batch size: scale with total count, min 3, max 10
        const batchSize = Math.min(10, Math.max(3, Math.floor(total / 20)));
        safeLog(`[ThumbnailService] Bulk processing ${total} files, batch size: ${batchSize}`);

        for (let i = 0; i < total; i += batchSize) {
            const batch = filePaths.slice(i, i + batchSize);

            try {
                const promises = batch.map(async (filePath) => {
                    const result = await this.generateThumbnails(filePath);
                    results.set(filePath, result);
                    return { filePath, result };
                });

                await Promise.all(promises);
            } catch (batchError: any) {
                safeError(`[ThumbnailService] Batch failed at index ${i}`, {
                    error: batchError?.message || batchError,
                    batchFiles: batch
                });
                // Mark failed files as null and continue
                for (const filePath of batch) {
                    if (!results.has(filePath)) {
                        results.set(filePath, null);
                    }
                }
            }

            if (onProgress) {
                const completed = Math.min(i + batchSize, total);
                onProgress(completed, total, batch[batch.length - 1]);
            }
        }

        safeLog(`[ThumbnailService] Bulk processing complete: ${results.size}/${total} processed`);
        return results;
    }

    getSmallPath(sourcePath: string): string | null {
        const hashedPath = this.getHashedPath(sourcePath);
        const smallPath = path.join(this.thumbnailDir, `${hashedPath}_sm.webp`);
        return fs.existsSync(smallPath) ? smallPath : null;
    }

    getThumbnailPath(sourcePath: string): string | null {
        const hashedPath = this.getHashedPath(sourcePath);
        const thumbnailPath = path.join(this.thumbnailDir, `${hashedPath}.webp`);
        return fs.existsSync(thumbnailPath) ? thumbnailPath : null;
    }

    getLargePath(sourcePath: string): string | null {
        const hashedPath = this.getHashedPath(sourcePath);
        const largePath = path.join(this.thumbnailDir, `${hashedPath}_lg.webp`);
        return fs.existsSync(largePath) ? largePath : null;
    }

    getPreviewPath(sourcePath: string): string | null {
        const hashedPath = this.getHashedPath(sourcePath);
        const previewPath = path.join(this.previewDir, `${hashedPath}_pv.webp`);
        return fs.existsSync(previewPath) ? previewPath : null;
    }

    async deleteThumbnails(sourcePath: string): Promise<void> {
        const hashedPath = this.getHashedPath(sourcePath);
        const pathsToDelete = [
            path.join(this.thumbnailDir, `${hashedPath}_sm.webp`),
            path.join(this.thumbnailDir, `${hashedPath}.webp`),
            path.join(this.thumbnailDir, `${hashedPath}_lg.webp`),
            path.join(this.previewDir, `${hashedPath}_pv.webp`),
        ];

        try {
            for (const filePath of pathsToDelete) {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
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
            fs.mkdirSync(this.faceCropDir, { recursive: true });
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
            case 'avif':
                pipeline = pipeline.avif({ quality });
                break;
            case 'jpeg':
            default:
                pipeline = pipeline.jpeg({ quality });
                break;
        }

        await pipeline.toFile(outputPath);
    }

    getFaceCropDir(): string {
        return this.faceCropDir;
    }

    getFaceCropPath(faceId: string): string {
        // faceId is the faces PK — stable, so a representative change just points
        // at an already-generated file.
        return path.join(this.faceCropDir, `${faceId}.webp`);
    }

    /**
     * Generate a square, tightly-cropped face image.
     * sourceWebpPath MUST be a decodable webp (2048 _pv preview or 512 thumb),
     * NEVER the raw/.nef/.psd original — those are the blank-card root cause.
     * The 0..1 box was measured on the .rotate()-baked thumbnail and the 512/2048
     * webps are written post-.rotate(), so pixels are upright and the box maps 1:1
     * — read metadata WITHOUT another .rotate().
     */
    async generateFaceCrop(
        sourceWebpPath: string,
        faceId: string,
        box: { box_x: number; box_y: number; box_width: number; box_height: number },
        opts: { margin?: number; size?: number; force?: boolean } = {}
    ): Promise<string | null> {
        const { margin = 0.6, size = 512, force = false } = opts;
        const out = this.getFaceCropPath(faceId);
        try {
            if (!force) {
                const done = await fs.promises.access(out, fs.constants.F_OK).then(() => true).catch(() => false);
                if (done) return out; // idempotent
            }
            if (!fs.existsSync(sourceWebpPath)) return null;

            const meta = await sharp(sourceWebpPath).metadata(); // NO .rotate()
            const W = meta.width || 0, H = meta.height || 0;
            if (!W || !H) return null;

            const cx = (box.box_x + box.box_width / 2) * W;
            const cy = (box.box_y + box.box_height / 2) * H;

            // square side = larger face dim + margin (hair/chin room); guard tiny boxes
            const s = Math.round(Math.max(box.box_width * W, box.box_height * H) * (1 + margin));
            const side = Math.max(1, Math.min(s, W, H)); // never exceed image; never 0

            let left = Math.round(cx - side / 2);
            let top = Math.round(cy - side / 2);
            left = Math.max(0, Math.min(left, W - side)); // clamp INTO [0, dim-side]
            top = Math.max(0, Math.min(top, H - side));

            await sharp(sourceWebpPath)
                .extract({ left, top, width: side, height: side })
                .resize(size, size, { fit: 'cover' })
                .webp({ quality: 85 })
                .toFile(out);
            return out;
        } catch (e: any) {
            // The clamp prevents 'extract_area: bad extract area', but one bad face
            // must never abort a batch.
            safeError(`[ThumbnailService] generateFaceCrop failed for ${sourceWebpPath}:`, e?.message);
            return null;
        }
    }
}

export const thumbnailService = new ThumbnailService();
export default thumbnailService;
