import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import sharp from 'sharp';

// Local, free object removal — LaMa (Carve ONNX export) running on-device via
// onnxruntime-node. No cloud, no account, works offline. Input contract
// (verified empirically): image float32 [1,3,512,512] in 0..1, mask float32
// [1,1,512,512] in {0,1} (1 = remove), output float32 0..255.
const MODEL_URL = 'https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx';
const NET = 512;

class InpaintService {
    private session: any = null;

    modelPath(): string {
        return path.join(app.getPath('userData'), 'ai-models', 'lama_fp32.onnx');
    }

    isModelReady(): boolean {
        try {
            return fs.existsSync(this.modelPath()) && fs.statSync(this.modelPath()).size > 100_000_000;
        } catch {
            return false;
        }
    }

    /** Download the model on first use (~198 MB, one time). */
    async ensureModel(onProgress?: (pct: number) => void): Promise<boolean> {
        if (this.isModelReady()) return true;
        const dest = this.modelPath();
        const tmp = `${dest}.download`;
        try {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            const res = await fetch(MODEL_URL);
            if (!res.ok || !res.body) return false;
            const total = Number(res.headers.get('content-length') || 0);
            const out = fs.createWriteStream(tmp);
            const reader = (res.body as any).getReader();
            let done = 0;
            for (;;) {
                const { done: end, value } = await reader.read();
                if (end) break;
                out.write(Buffer.from(value));
                done += value.length;
                if (total && onProgress) onProgress(Math.round((100 * done) / total));
            }
            await new Promise<void>(r => out.end(() => r()));
            fs.renameSync(tmp, dest);
            return this.isModelReady();
        } catch {
            fs.promises.unlink(tmp).catch(() => {});
            return false;
        }
    }

    private async getSession(): Promise<any> {
        if (this.session) return this.session;
        // Lazy require: the 200 MB model + runtime only load when the tool is used.
        const ort = require('onnxruntime-node');
        this.session = await ort.InferenceSession.create(this.modelPath());
        return this.session;
    }

    /**
     * Remove the masked area from the image at imagePath and write the result
     * to outPath (format chosen by extension). maskPng is any-resolution PNG,
     * white = remove. Strategy: crop a padded square region around the mask,
     * inpaint at 512², scale back and feather-blend only the masked pixels —
     * the rest of the photo keeps its original pixels untouched.
     */
    async inpaint(imagePath: string, maskPng: Buffer, outPath: string): Promise<boolean> {
        const ort = require('onnxruntime-node');
        const session = await this.getSession();

        // Full-resolution source (EXIF-oriented, no alpha)
        const { data: full, info } = await sharp(imagePath)
            .rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
        const W = info.width, H = info.height;

        // Mask at full resolution
        const maskFull = await sharp(maskPng)
            .resize(W, H, { fit: 'fill' }).greyscale().raw().toBuffer();

        // Bounding box of the painted area
        let minX = W, minY = H, maxX = -1, maxY = -1;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                if (maskFull[y * W + x] > 127) {
                    if (x < minX) minX = x;
                    if (x > maxX) maxX = x;
                    if (y < minY) minY = y;
                    if (y > maxY) maxY = y;
                }
            }
        }
        if (maxX < 0) return false; // empty mask

        // Padded square region (context helps LaMa a lot), clamped to the image
        const bw = maxX - minX + 1, bh = maxY - minY + 1;
        const pad = Math.max(96, Math.round(0.6 * Math.max(bw, bh)));
        let side = Math.min(Math.max(Math.max(bw, bh) + 2 * pad, NET), Math.min(W, H));
        let rx = Math.round(minX + bw / 2 - side / 2);
        let ry = Math.round(minY + bh / 2 - side / 2);
        rx = Math.max(0, Math.min(W - side, rx));
        ry = Math.max(0, Math.min(H - side, ry));

        const rawRegion = (buf: Buffer, ch: number) => {
            const out = Buffer.alloc(side * side * ch);
            for (let y = 0; y < side; y++) {
                const src = ((ry + y) * W + rx) * ch;
                buf.copy(out, y * side * ch, src, src + side * ch);
            }
            return out;
        };
        const region = rawRegion(full, 3);
        const regionMask = rawRegion(maskFull, 1);

        // To 512² network space
        const netImg = await sharp(region, { raw: { width: side, height: side, channels: 3 } })
            .resize(NET, NET, { fit: 'fill' }).raw().toBuffer();
        const netMask = await sharp(regionMask, { raw: { width: side, height: side, channels: 1 } })
            .resize(NET, NET, { fit: 'fill' }).raw().toBuffer();

        // sharp may expand 1-channel raw input to 3 channels — index by stride.
        const mStride = netMask.length / (NET * NET);
        const imgT = new Float32Array(3 * NET * NET);
        const maskT = new Float32Array(NET * NET);
        for (let i = 0; i < NET * NET; i++) {
            imgT[i] = netImg[i * 3] / 255;
            imgT[NET * NET + i] = netImg[i * 3 + 1] / 255;
            imgT[2 * NET * NET + i] = netImg[i * 3 + 2] / 255;
            maskT[i] = netMask[i * mStride] > 127 ? 1 : 0;
        }

        const res = await session.run({
            image: new ort.Tensor('float32', imgT, [1, 3, NET, NET]),
            mask: new ort.Tensor('float32', maskT, [1, 1, NET, NET]),
        });
        const o = res.output.data as Float32Array;

        // Network output (0..255 CHW) → HWC bytes → back to region size
        const outNet = Buffer.alloc(NET * NET * 3);
        for (let i = 0; i < NET * NET; i++) {
            outNet[i * 3] = Math.max(0, Math.min(255, o[i]));
            outNet[i * 3 + 1] = Math.max(0, Math.min(255, o[NET * NET + i]));
            outNet[i * 3 + 2] = Math.max(0, Math.min(255, o[2 * NET * NET + i]));
        }
        const outRegion = await sharp(outNet, { raw: { width: NET, height: NET, channels: 3 } })
            .resize(side, side, { fit: 'fill' }).raw().toBuffer();

        // Feathered blend: only masked pixels change, softly at the edges
        const feather = await sharp(regionMask, { raw: { width: side, height: side, channels: 1 } })
            .blur(2).raw().toBuffer();
        const fStride = feather.length / (side * side);
        for (let i = 0; i < side * side; i++) {
            const a = feather[i * fStride] / 255;
            if (a === 0) continue;
            const p = i * 3;
            region[p] = Math.round(region[p] * (1 - a) + outRegion[p] * a);
            region[p + 1] = Math.round(region[p + 1] * (1 - a) + outRegion[p + 1] * a);
            region[p + 2] = Math.round(region[p + 2] * (1 - a) + outRegion[p + 2] * a);
        }

        // Paste the region back into the full frame
        for (let y = 0; y < side; y++) {
            region.copy(full, ((ry + y) * W + rx) * 3, y * side * 3, (y + 1) * side * 3);
        }

        const pipeline = sharp(full, { raw: { width: W, height: H, channels: 3 } });
        const ext = path.extname(outPath).toLowerCase();
        if (ext === '.tif' || ext === '.tiff') {
            await pipeline.tiff({ compression: 'lzw' }).toFile(outPath);
        } else if (ext === '.png') {
            await pipeline.png().toFile(outPath);
        } else {
            await pipeline.jpeg({ quality: 95 }).toFile(outPath);
        }
        return true;
    }
}

export const inpaintService = new InpaintService();
export default inpaintService;
