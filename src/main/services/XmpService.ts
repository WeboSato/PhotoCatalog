import * as fs from 'fs';
import * as path from 'path';

// XMP Sidecar Service - Creates Lightroom/Adobe compatible XMP files
// These files store metadata alongside images and are read by Affinity Photo, Lightroom, etc.

export interface XmpMetadata {
    rating?: number;
    label?: string; // Color label
    flag?: string;
    keywords?: string[];
    title?: string;
    caption?: string;
    creator?: string;
    copyright?: string;
    // Develop settings
    develop?: {
        exposure?: number;
        contrast?: number;
        highlights?: number;
        shadows?: number;
        whites?: number;
        blacks?: number;
        clarity?: number;
        vibrance?: number;
        saturation?: number;
        temperature?: number;
        tint?: number;
    };
    // GPS
    gpsLatitude?: number;
    gpsLongitude?: number;
    // Dates
    dateCreated?: string;
    dateModified?: string;
}

// Color label mapping (Lightroom standard)
const colorLabelMap: Record<string, string> = {
    'red': 'Red',
    'yellow': 'Yellow',
    'green': 'Green',
    'blue': 'Blue',
    'purple': 'Purple',
    'none': ''
};

const reverseColorLabelMap: Record<string, string> = {
    'Red': 'red',
    'Yellow': 'yellow',
    'Green': 'green',
    'Blue': 'blue',
    'Purple': 'purple',
    '': 'none'
};

export class XmpService {
    /**
     * Get the XMP sidecar file path for an image
     */
    static getXmpPath(imagePath: string): string {
        const ext = path.extname(imagePath);
        return imagePath.replace(ext, '.xmp');
    }

    /**
     * Check if XMP sidecar exists for an image
     */
    static xmpExists(imagePath: string): boolean {
        const xmpPath = this.getXmpPath(imagePath);
        return fs.existsSync(xmpPath);
    }

    /**
     * Read XMP sidecar file and parse metadata
     */
    static readXmp(imagePath: string): XmpMetadata | null {
        const xmpPath = this.getXmpPath(imagePath);

        if (!fs.existsSync(xmpPath)) {
            return null;
        }

        try {
            const content = fs.readFileSync(xmpPath, 'utf-8');
            return this.parseXmp(content);
        } catch (error) {
            console.error(`Failed to read XMP file ${xmpPath}:`, error);
            return null;
        }
    }

    /**
     * Write XMP sidecar file with metadata
     */
    static writeXmp(imagePath: string, metadata: XmpMetadata): boolean {
        const xmpPath = this.getXmpPath(imagePath);

        try {
            const content = this.generateXmp(imagePath, metadata);
            fs.writeFileSync(xmpPath, content, 'utf-8');
            return true;
        } catch (error) {
            console.error(`Failed to write XMP file ${xmpPath}:`, error);
            return false;
        }
    }

    /**
     * Update existing XMP or create new one with partial metadata
     */
    static updateXmp(imagePath: string, updates: Partial<XmpMetadata>): boolean {
        // Read existing metadata
        let existing = this.readXmp(imagePath) || {};

        // Merge with updates
        const merged: XmpMetadata = {
            ...existing,
            ...updates,
            // Deep merge develop settings
            develop: {
                ...existing.develop,
                ...updates.develop
            },
            // Merge keywords (combine arrays)
            keywords: updates.keywords !== undefined
                ? updates.keywords
                : existing.keywords
        };

        // Update modification date
        merged.dateModified = new Date().toISOString();

        return this.writeXmp(imagePath, merged);
    }

    /**
     * Parse XMP content to metadata object
     */
    private static parseXmp(content: string): XmpMetadata {
        const metadata: XmpMetadata = {};

        // Rating
        const ratingMatch = content.match(/xmp:Rating="(\d+)"/);
        if (ratingMatch) {
            metadata.rating = parseInt(ratingMatch[1], 10);
        }

        // Label (color)
        const labelMatch = content.match(/xmp:Label="([^"]+)"/);
        if (labelMatch) {
            metadata.label = reverseColorLabelMap[labelMatch[1]] || labelMatch[1];
        }

        // Keywords
        const keywordsMatch = content.match(/<dc:subject>[\s\S]*?<rdf:Bag>([\s\S]*?)<\/rdf:Bag>/);
        if (keywordsMatch) {
            const keywordItems = keywordsMatch[1].match(/<rdf:li>([^<]+)<\/rdf:li>/g);
            if (keywordItems) {
                metadata.keywords = keywordItems.map(item =>
                    item.replace(/<\/?rdf:li>/g, '')
                );
            }
        }

        // Title
        const titleMatch = content.match(/<dc:title>[\s\S]*?<rdf:Alt>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/);
        if (titleMatch) {
            metadata.title = titleMatch[1];
        }

        // Description/Caption
        const descMatch = content.match(/<dc:description>[\s\S]*?<rdf:Alt>[\s\S]*?<rdf:li[^>]*>([^<]+)<\/rdf:li>/);
        if (descMatch) {
            metadata.caption = descMatch[1];
        }

        // Creator
        const creatorMatch = content.match(/<dc:creator>[\s\S]*?<rdf:Seq>[\s\S]*?<rdf:li>([^<]+)<\/rdf:li>/);
        if (creatorMatch) {
            metadata.creator = creatorMatch[1];
        }

        // Develop settings (Camera Raw namespace)
        const developSettings: XmpMetadata['develop'] = {};

        const exposureMatch = content.match(/crs:Exposure2012="([^"]+)"/);
        if (exposureMatch) developSettings.exposure = parseFloat(exposureMatch[1]);

        const contrastMatch = content.match(/crs:Contrast2012="([^"]+)"/);
        if (contrastMatch) developSettings.contrast = parseFloat(contrastMatch[1]);

        const highlightsMatch = content.match(/crs:Highlights2012="([^"]+)"/);
        if (highlightsMatch) developSettings.highlights = parseFloat(highlightsMatch[1]);

        const shadowsMatch = content.match(/crs:Shadows2012="([^"]+)"/);
        if (shadowsMatch) developSettings.shadows = parseFloat(shadowsMatch[1]);

        const whitesMatch = content.match(/crs:Whites2012="([^"]+)"/);
        if (whitesMatch) developSettings.whites = parseFloat(whitesMatch[1]);

        const blacksMatch = content.match(/crs:Blacks2012="([^"]+)"/);
        if (blacksMatch) developSettings.blacks = parseFloat(blacksMatch[1]);

        const clarityMatch = content.match(/crs:Clarity2012="([^"]+)"/);
        if (clarityMatch) developSettings.clarity = parseFloat(clarityMatch[1]);

        const vibranceMatch = content.match(/crs:Vibrance="([^"]+)"/);
        if (vibranceMatch) developSettings.vibrance = parseFloat(vibranceMatch[1]);

        const saturationMatch = content.match(/crs:Saturation="([^"]+)"/);
        if (saturationMatch) developSettings.saturation = parseFloat(saturationMatch[1]);

        const tempMatch = content.match(/crs:Temperature="([^"]+)"/);
        if (tempMatch) developSettings.temperature = parseFloat(tempMatch[1]);

        const tintMatch = content.match(/crs:Tint="([^"]+)"/);
        if (tintMatch) developSettings.tint = parseFloat(tintMatch[1]);

        if (Object.keys(developSettings).length > 0) {
            metadata.develop = developSettings;
        }

        // GPS coordinates
        const latMatch = content.match(/exif:GPSLatitude="([^"]+)"/);
        if (latMatch) {
            metadata.gpsLatitude = this.parseGpsCoord(latMatch[1]);
        }

        const lonMatch = content.match(/exif:GPSLongitude="([^"]+)"/);
        if (lonMatch) {
            metadata.gpsLongitude = this.parseGpsCoord(lonMatch[1]);
        }

        return metadata;
    }

    /**
     * Generate XMP content from metadata
     */
    private static generateXmp(imagePath: string, metadata: XmpMetadata): string {
        const filename = path.basename(imagePath);
        const now = new Date().toISOString();

        let xmp = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="PhotoCatalog XMP">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
    xmlns:exif="http://ns.adobe.com/exif/1.0/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"`;

        // Basic metadata attributes
        if (metadata.rating !== undefined) {
            xmp += `\n    xmp:Rating="${metadata.rating}"`;
        }

        if (metadata.label && metadata.label !== 'none') {
            xmp += `\n    xmp:Label="${colorLabelMap[metadata.label] || metadata.label}"`;
        }

        xmp += `\n    xmp:MetadataDate="${now}"`;
        xmp += `\n    xmp:ModifyDate="${metadata.dateModified || now}"`;

        // Develop/Camera Raw settings
        if (metadata.develop) {
            const d = metadata.develop;
            if (d.exposure !== undefined) xmp += `\n    crs:Exposure2012="${d.exposure.toFixed(2)}"`;
            if (d.contrast !== undefined) xmp += `\n    crs:Contrast2012="${d.contrast}"`;
            if (d.highlights !== undefined) xmp += `\n    crs:Highlights2012="${d.highlights}"`;
            if (d.shadows !== undefined) xmp += `\n    crs:Shadows2012="${d.shadows}"`;
            if (d.whites !== undefined) xmp += `\n    crs:Whites2012="${d.whites}"`;
            if (d.blacks !== undefined) xmp += `\n    crs:Blacks2012="${d.blacks}"`;
            if (d.clarity !== undefined) xmp += `\n    crs:Clarity2012="${d.clarity}"`;
            if (d.vibrance !== undefined) xmp += `\n    crs:Vibrance="${d.vibrance}"`;
            if (d.saturation !== undefined) xmp += `\n    crs:Saturation="${d.saturation}"`;
            if (d.temperature !== undefined) xmp += `\n    crs:Temperature="${d.temperature}"`;
            if (d.tint !== undefined) xmp += `\n    crs:Tint="${d.tint}"`;
            xmp += `\n    crs:Version="15.0"`;
            xmp += `\n    crs:ProcessVersion="15.0"`;
        }

        // GPS coordinates
        if (metadata.gpsLatitude !== undefined) {
            xmp += `\n    exif:GPSLatitude="${this.formatGpsCoord(metadata.gpsLatitude, 'lat')}"`;
        }
        if (metadata.gpsLongitude !== undefined) {
            xmp += `\n    exif:GPSLongitude="${this.formatGpsCoord(metadata.gpsLongitude, 'lon')}"`;
        }

        xmp += `>`;

        // Title
        if (metadata.title) {
            xmp += `
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${this.escapeXml(metadata.title)}</rdf:li>
    </rdf:Alt>
   </dc:title>`;
        }

        // Description/Caption
        if (metadata.caption) {
            xmp += `
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${this.escapeXml(metadata.caption)}</rdf:li>
    </rdf:Alt>
   </dc:description>`;
        }

        // Creator
        if (metadata.creator) {
            xmp += `
   <dc:creator>
    <rdf:Seq>
     <rdf:li>${this.escapeXml(metadata.creator)}</rdf:li>
    </rdf:Seq>
   </dc:creator>`;
        }

        // Copyright
        if (metadata.copyright) {
            xmp += `
   <dc:rights>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${this.escapeXml(metadata.copyright)}</rdf:li>
    </rdf:Alt>
   </dc:rights>`;
        }

        // Keywords
        if (metadata.keywords && metadata.keywords.length > 0) {
            xmp += `
   <dc:subject>
    <rdf:Bag>`;
            for (const keyword of metadata.keywords) {
                xmp += `
     <rdf:li>${this.escapeXml(keyword)}</rdf:li>`;
            }
            xmp += `
    </rdf:Bag>
   </dc:subject>`;

            // Also add to Lightroom hierarchical keywords
            xmp += `
   <lr:hierarchicalSubject>
    <rdf:Bag>`;
            for (const keyword of metadata.keywords) {
                xmp += `
     <rdf:li>${this.escapeXml(keyword)}</rdf:li>`;
            }
            xmp += `
    </rdf:Bag>
   </lr:hierarchicalSubject>`;
        }

        xmp += `
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

        return xmp;
    }

    /**
     * Parse GPS coordinate from XMP format (e.g., "45,30.5N")
     */
    private static parseGpsCoord(coord: string): number {
        const match = coord.match(/(\d+),(\d+\.?\d*)([NSEW])/);
        if (!match) return 0;

        const degrees = parseInt(match[1], 10);
        const minutes = parseFloat(match[2]);
        const direction = match[3];

        let decimal = degrees + minutes / 60;
        if (direction === 'S' || direction === 'W') {
            decimal = -decimal;
        }

        return decimal;
    }

    /**
     * Format GPS coordinate to XMP format
     */
    private static formatGpsCoord(decimal: number, type: 'lat' | 'lon'): string {
        const abs = Math.abs(decimal);
        const degrees = Math.floor(abs);
        const minutes = (abs - degrees) * 60;

        let direction: string;
        if (type === 'lat') {
            direction = decimal >= 0 ? 'N' : 'S';
        } else {
            direction = decimal >= 0 ? 'E' : 'W';
        }

        return `${degrees},${minutes.toFixed(4)}${direction}`;
    }

    /**
     * Escape XML special characters
     */
    private static escapeXml(str: string): string {
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    /**
     * Batch write XMP files for multiple photos
     */
    static batchWriteXmp(photos: Array<{ path: string; metadata: XmpMetadata }>): { success: number; failed: number } {
        let success = 0;
        let failed = 0;

        for (const photo of photos) {
            if (this.writeXmp(photo.path, photo.metadata)) {
                success++;
            } else {
                failed++;
            }
        }

        return { success, failed };
    }

    /**
     * Add keywords to existing XMP (merges with existing keywords)
     */
    static addKeywords(imagePath: string, keywords: string[]): boolean {
        const existing = this.readXmp(imagePath);
        const existingKeywords = existing?.keywords || [];

        // Merge and deduplicate
        const mergedKeywords = [...new Set([...existingKeywords, ...keywords])];

        return this.updateXmp(imagePath, { keywords: mergedKeywords });
    }

    /**
     * Remove keywords from existing XMP
     */
    static removeKeywords(imagePath: string, keywords: string[]): boolean {
        const existing = this.readXmp(imagePath);
        if (!existing?.keywords) return true;

        const filteredKeywords = existing.keywords.filter(k => !keywords.includes(k));

        return this.updateXmp(imagePath, { keywords: filteredKeywords });
    }
}

export default XmpService;
