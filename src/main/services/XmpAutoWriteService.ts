import fs from 'fs';
import path from 'path';
import catalogDb from '../../database/Database';
import { XmpService, XmpMetadata } from './XmpService';
import { settingsService } from './SettingsService';

// Lightroom's "Automatically write changes into XMP": the catalog stays the
// source of truth, but every rating / flag / label / keyword / develop change
// is mirrored into a sidecar next to the file, so the classification survives
// a lost catalog (or a reformatted drive). Sidecars only — the RAW/JPEG itself
// is never touched.
class XmpAutoWriteService {
    private pending = new Set<string>();
    private timer: NodeJS.Timeout | null = null;
    private backfillRunning = false;

    enabled(): boolean {
        return settingsService.get('autoWriteXmp') !== false;
    }

    /** Debounced: rapid successive edits to the same photo cost one write. */
    queue(ids: string[] | string): void {
        if (!this.enabled()) return;
        for (const id of Array.isArray(ids) ? ids : [ids]) if (id) this.pending.add(id);
        if (!this.timer) this.timer = setTimeout(() => void this.flush(), 1500);
    }

    private async flush(): Promise<void> {
        this.timer = null;
        const ids = [...this.pending];
        this.pending.clear();
        let written = 0;
        for (let i = 0; i < ids.length; i++) {
            if (this.writeOne(ids[i])) written++;
            // Yield between files so a bulk edit of hundreds never stalls IPC.
            if (i % 20 === 19) await new Promise(r => setTimeout(r, 15));
        }
        if (written) console.log(`[XMP] ${written} sidecar(s) mis à jour`);
    }

    /** Full sidecar from the catalog row (catalog wins; nothing merged). */
    buildMetadata(photo: any): XmpMetadata {
        const md: XmpMetadata = {
            rating: photo.rating || 0,
            label: photo.color_label && photo.color_label !== 'none' ? photo.color_label : undefined,
            flag: photo.flag && photo.flag !== 'none' ? photo.flag : undefined,
            keywords: catalogDb.getPhotoKeywords(photo.id).map((k: any) => k.name),
            title: photo.title || undefined,
            caption: photo.caption || undefined,
            creator: photo.creator || undefined,
            copyright: photo.copyright || undefined,
        };
        if (photo.develop_settings) {
            try {
                md.develop = typeof photo.develop_settings === 'string'
                    ? JSON.parse(photo.develop_settings) : photo.develop_settings;
            } catch { /* unparsable — leave develop out */ }
        }
        if (photo.gps_latitude && photo.gps_longitude) {
            (md as any).gpsLatitude = photo.gps_latitude;
            (md as any).gpsLongitude = photo.gps_longitude;
        }
        return md;
    }

    // A sidecar written by someone else (Lightroom, Bridge, Capture One) holds
    // fields this app does not model — crops, tone curves, masks. writeXmp
    // regenerates the file from scratch, so writing over one DESTROYS that work.
    // Anything without our marker is off limits.
    private isForeign(imagePath: string): boolean {
        try {
            const xmpPath = XmpService.getXmpPath(imagePath);
            if (!fs.existsSync(xmpPath)) return false;
            return !fs.readFileSync(xmpPath, 'utf-8').includes('PhotoCatalog XMP');
        } catch {
            return true; // unreadable: treat as foreign and leave it alone
        }
    }

    skippedForeign = 0;

    writeOne(photoId: string): boolean {
        try {
            const photo = catalogDb.getPhoto(photoId);
            if (!photo?.file_path || !fs.existsSync(photo.file_path)) return false;
            if (this.isForeign(photo.file_path)) {
                this.skippedForeign++;
                return false;
            }
            return XmpService.writeXmp(photo.file_path, this.buildMetadata(photo));
        } catch {
            return false;
        }
    }

    /** True when the sidecar is missing or older than the catalog row. */
    private isStale(photo: any): boolean {
        const xmpPath = XmpService.getXmpPath(photo.file_path);
        try {
            const xmpM = fs.statSync(xmpPath).mtimeMs;
            const raw = String(photo.updated_at || '');
            const upd = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z');
            return Number.isFinite(upd) ? upd > xmpM + 1000 : false;
        } catch {
            return true; // no sidecar yet
        }
    }

    /**
     * One-time catch-up for photos cataloged before auto-write existed:
     * gentle background pass, only where the sidecar is missing or older than
     * the catalog row. Never runs twice at once.
     */
    async backfill(onProgress?: (done: number, total: number, written: number) => void): Promise<{ written: number; skipped: number }> {
        if (!this.enabled() || this.backfillRunning) return { written: 0, skipped: 0 };
        this.backfillRunning = true;
        let written = 0, skipped = 0;
        try {
            const photos = catalogDb.getAllPhotos(999999, 0) as any[];
            for (let i = 0; i < photos.length; i++) {
                const p = photos[i];
                if (p.file_path && fs.existsSync(p.file_path) && this.isStale(p)) {
                    if (this.isForeign(p.file_path)) { this.skippedForeign++; skipped++; }
                    else if (XmpService.writeXmp(p.file_path, this.buildMetadata(p))) written++;
                } else {
                    skipped++;
                }
                // ~16 files/s: unnoticeable next to grid scrolling on the HDD.
                if (i % 5 === 4) await new Promise(r => setTimeout(r, 300));
                if (i % 500 === 499) onProgress?.(i + 1, photos.length, written);
            }
            onProgress?.(photos.length, photos.length, written);
        } finally {
            this.backfillRunning = false;
        }
        return { written, skipped };
    }
}

export const xmpAutoWrite = new XmpAutoWriteService();
export default xmpAutoWrite;
