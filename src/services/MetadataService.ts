import ExifReader from 'exifreader';
import fs from 'fs';
import path from 'path';
import { RAW_EXTENSIONS, IMAGE_EXTENSIONS } from '../database/schema';

export interface ExtractedMetadata {
    // Dimensions
    width?: number;
    height?: number;
    orientation?: number;

    // Dates
    dateTaken?: string;
    dateModified?: string;

    // Camera
    cameraMake?: string;
    cameraModel?: string;
    lensModel?: string;
    focalLength?: number;
    aperture?: number;
    shutterSpeed?: string;
    iso?: number;
    flashUsed?: boolean;

    // GPS
    gpsLatitude?: number;
    gpsLongitude?: number;
    gpsAltitude?: number;

    // IPTC
    title?: string;
    caption?: string;
    copyright?: string;
    creator?: string;
    keywords?: string[];

    // File info
    fileType?: string;
    mimeType?: string;
    isRaw?: boolean;
    rawType?: string;
}

// Helper to safely get string value from tag
function getStringValue(tag: any): string | undefined {
    if (!tag) return undefined;
    if (typeof tag.description === 'string') return tag.description;
    if (typeof tag.value === 'string') return tag.value;
    if (Array.isArray(tag.value) && tag.value.length > 0) {
        return String(tag.value[0]);
    }
    if (tag.value !== undefined) return String(tag.value);
    return undefined;
}

// Helper to safely get number value from tag
function getNumberValue(tag: any): number | undefined {
    if (!tag) return undefined;
    if (typeof tag.value === 'number') return tag.value;
    if (typeof tag.description === 'string') {
        const num = parseFloat(tag.description);
        return isNaN(num) ? undefined : num;
    }
    if (Array.isArray(tag.value) && tag.value.length > 0) {
        return typeof tag.value[0] === 'number' ? tag.value[0] : undefined;
    }
    return undefined;
}

class MetadataService {
    async extractMetadata(filePath: string): Promise<ExtractedMetadata> {
        const metadata: ExtractedMetadata = {};

        try {
            // Check file exists
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            // Determine file type
            const ext = path.extname(filePath).toLowerCase();
            metadata.isRaw = RAW_EXTENSIONS.includes(ext);
            if (metadata.isRaw) {
                metadata.rawType = ext.substring(1).toUpperCase();
            }

            // Get file stats
            const stats = fs.statSync(filePath);
            metadata.dateModified = stats.mtime.toISOString();

            // Determine MIME type
            metadata.mimeType = this.getMimeType(ext);
            metadata.fileType = ext.substring(1).toUpperCase();

            // Read EXIF data
            const buffer = fs.readFileSync(filePath);
            const tags = ExifReader.load(buffer, { expanded: true });

            // Extract dimensions
            if (tags.file) {
                metadata.width = getNumberValue(tags.file['Image Width']);
                metadata.height = getNumberValue(tags.file['Image Height']);
            }
            if (tags.exif) {
                metadata.width = metadata.width || getNumberValue(tags.exif['PixelXDimension']);
                metadata.height = metadata.height || getNumberValue(tags.exif['PixelYDimension']);
                metadata.orientation = getNumberValue(tags.exif['Orientation']);
            }

            // Extract camera info
            if (tags.exif) {
                metadata.cameraMake = getStringValue(tags.exif['Make']);
                metadata.cameraModel = getStringValue(tags.exif['Model']);
                metadata.lensModel = getStringValue(tags.exif['LensModel']);

                // Focal length
                const focalLength = tags.exif['FocalLength'];
                if (focalLength) {
                    metadata.focalLength = getNumberValue(focalLength);
                }

                // Aperture (FNumber)
                const fNumber = tags.exif['FNumber'];
                if (fNumber) {
                    const val = getNumberValue(fNumber);
                    if (val !== undefined) {
                        metadata.aperture = val;
                    } else if (fNumber.description) {
                        const parsed = parseFloat(String(fNumber.description).replace('f/', ''));
                        if (!isNaN(parsed)) metadata.aperture = parsed;
                    }
                }

                // Shutter speed
                const exposureTime = tags.exif['ExposureTime'];
                if (exposureTime) {
                    metadata.shutterSpeed = getStringValue(exposureTime) || `${exposureTime.value}s`;
                }

                // ISO
                const iso = tags.exif['ISOSpeedRatings'];
                if (iso) {
                    metadata.iso = getNumberValue(iso);
                }

                // Flash
                const flash = tags.exif['Flash'];
                if (flash) {
                    const flashValue = getNumberValue(flash);
                    if (flashValue !== undefined) {
                        metadata.flashUsed = (flashValue & 0x01) === 1;
                    }
                }

                // Date taken
                const dateTime = tags.exif['DateTimeOriginal'] || tags.exif['DateTimeDigitized'] || tags.exif['DateTime'];
                if (dateTime) {
                    const dateStr = getStringValue(dateTime);
                    if (dateStr) {
                        metadata.dateTaken = this.parseExifDate(dateStr);
                    }
                }
            }

            // Extract GPS
            if (tags.gps) {
                if (tags.gps['Latitude'] !== undefined && tags.gps['Longitude'] !== undefined) {
                    metadata.gpsLatitude = tags.gps['Latitude'];
                    metadata.gpsLongitude = tags.gps['Longitude'];
                }
                if (tags.gps['Altitude'] !== undefined) {
                    metadata.gpsAltitude = tags.gps['Altitude'];
                }
            }

            // Extract IPTC
            if (tags.iptc) {
                metadata.title = getStringValue(tags.iptc['Object Name']);
                metadata.caption = getStringValue(tags.iptc['Caption/Abstract']);
                metadata.copyright = getStringValue(tags.iptc['Copyright Notice']);
                metadata.creator = getStringValue(tags.iptc['By-line']);

                // Keywords
                const keywords = tags.iptc['Keywords'];
                if (keywords) {
                    if (Array.isArray(keywords)) {
                        metadata.keywords = keywords.map(k => getStringValue(k) || '').filter(Boolean);
                    } else {
                        const kw = getStringValue(keywords);
                        if (kw) metadata.keywords = [kw];
                    }
                }
            }

            // Extract XMP
            if (tags.xmp) {
                metadata.title = metadata.title || getStringValue(tags.xmp['title']);
                metadata.caption = metadata.caption || getStringValue(tags.xmp['description']);
                metadata.creator = metadata.creator || getStringValue(tags.xmp['creator']);
                metadata.copyright = metadata.copyright || getStringValue(tags.xmp['rights']);

                // XMP keywords/subjects
                if (!metadata.keywords) {
                    const subject = tags.xmp['subject'];
                    if (subject) {
                        if (Array.isArray(subject.value)) {
                            metadata.keywords = subject.value.map((v: any) => String(v)).filter(Boolean);
                        } else if (typeof subject.value === 'string') {
                            metadata.keywords = [subject.value];
                        }
                    }
                }
            }

        } catch (error) {
            console.error(`[MetadataService] Error extracting metadata from ${filePath}:`, error);
            // Return partial metadata even if there's an error
        }

        return metadata;
    }

    private parseExifDate(dateStr: string): string | undefined {
        if (!dateStr) return undefined;

        // EXIF date format: "YYYY:MM:DD HH:MM:SS"
        const match = dateStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
        if (match) {
            const [, year, month, day, hour, minute, second] = match;
            return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}`).toISOString();
        }

        // Try parsing as standard date
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date.toISOString();
        }

        return undefined;
    }

    private getMimeType(ext: string): string {
        const mimeTypes: Record<string, string> = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.tiff': 'image/tiff',
            '.tif': 'image/tiff',
            '.bmp': 'image/bmp',
            '.heic': 'image/heic',
            '.heif': 'image/heif',
            '.cr2': 'image/x-canon-cr2',
            '.cr3': 'image/x-canon-cr3',
            '.nef': 'image/x-nikon-nef',
            '.arw': 'image/x-sony-arw',
            '.raf': 'image/x-fuji-raf',
            '.orf': 'image/x-olympus-orf',
            '.rw2': 'image/x-panasonic-rw2',
            '.dng': 'image/x-adobe-dng',
            '.pef': 'image/x-pentax-pef',
            '.raw': 'image/x-raw',
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    async extractBulkMetadata(filePaths: string[], onProgress?: (current: number, total: number) => void): Promise<Map<string, ExtractedMetadata>> {
        const results = new Map<string, ExtractedMetadata>();
        const total = filePaths.length;

        for (let i = 0; i < total; i++) {
            const filePath = filePaths[i];
            try {
                const metadata = await this.extractMetadata(filePath);
                results.set(filePath, metadata);
            } catch (error) {
                console.error(`[MetadataService] Failed to extract metadata from ${filePath}:`, error);
                results.set(filePath, {});
            }

            if (onProgress) {
                onProgress(i + 1, total);
            }
        }

        return results;
    }

    isSupported(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return [...IMAGE_EXTENSIONS, ...RAW_EXTENSIONS].includes(ext);
    }

    getFileInfo(filePath: string): { fileName: string; fileSize: number; fileType: string } | null {
        try {
            const stats = fs.statSync(filePath);
            const fileName = path.basename(filePath);
            const ext = path.extname(filePath).toLowerCase();
            return {
                fileName,
                fileSize: stats.size,
                fileType: ext.substring(1).toUpperCase()
            };
        } catch {
            return null;
        }
    }
}

export const metadataService = new MetadataService();
export default metadataService;
