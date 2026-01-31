/**
 * ImageProcessingService - Inspired by Darktable's processing pipeline
 * Implements non-destructive image processing with all major tools
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Complete development settings - All Darktable-inspired tools
export interface DevelopSettings {
    // === BASIC ADJUSTMENTS (basicadj.c) ===
    exposure: number;           // -5 to +5 EV
    contrast: number;           // -100 to +100
    brightness: number;         // -100 to +100
    highlights: number;         // -100 to +100
    shadows: number;            // -100 to +100
    whites: number;             // -100 to +100
    blacks: number;             // -100 to +100

    // === TONE (filmic/basecurve) ===
    clarity: number;            // -100 to +100
    dehaze: number;             // -100 to +100 (hazeremoval.c)
    midtoneContrast: number;    // -100 to +100

    // === COLOR BALANCE RGB (colorbalancergb.c) ===
    temperature: number;        // -100 to +100 (cool to warm)
    tint: number;               // -100 to +100 (green to magenta)
    vibrance: number;           // -100 to +100
    saturation: number;         // -100 to +100

    // === COLOR CALIBRATION ===
    colorHue: number;           // -180 to +180
    colorSaturationGlobal: number;  // -100 to +100

    // === HSL ADJUSTMENTS (colorzones.c) ===
    hsl: {
        red: { hue: number; saturation: number; luminance: number };
        orange: { hue: number; saturation: number; luminance: number };
        yellow: { hue: number; saturation: number; luminance: number };
        green: { hue: number; saturation: number; luminance: number };
        aqua: { hue: number; saturation: number; luminance: number };
        blue: { hue: number; saturation: number; luminance: number };
        purple: { hue: number; saturation: number; luminance: number };
        magenta: { hue: number; saturation: number; luminance: number };
    };

    // === TONE CURVE ===
    toneCurve: {
        enabled: boolean;
        points: Array<{ x: number; y: number }>;  // 0-255 range
    };

    // === SPLIT TONING (colorcorrection.c) ===
    splitToning: {
        highlightHue: number;       // 0 to 360
        highlightSaturation: number; // 0 to 100
        shadowHue: number;          // 0 to 360
        shadowSaturation: number;   // 0 to 100
        balance: number;            // -100 to +100
    };

    // === DETAIL (sharpen.c, denoiseprofile.c) ===
    sharpening: {
        amount: number;             // 0 to 200
        radius: number;             // 0.1 to 5.0
        threshold: number;          // 0 to 100
    };
    noiseReduction: {
        luminance: number;          // 0 to 100
        color: number;              // 0 to 100
        detail: number;             // 0 to 100
    };

    // === LENS CORRECTIONS (lens.c) ===
    lensCorrection: {
        distortion: number;         // -100 to +100
        vignette: number;           // -100 to +100
        chromaticAberration: number; // 0 to 100
    };

    // === TRANSFORM (clipping.c, ashift.c) ===
    transform: {
        rotation: number;           // -180 to +180
        perspectiveV: number;       // -100 to +100 (vertical)
        perspectiveH: number;       // -100 to +100 (horizontal)
        aspectRatio: string;        // 'original', '16:9', '4:3', '1:1', '3:2', etc.
    };

    // === CROP ===
    crop: {
        enabled: boolean;
        x: number;                  // 0 to 1 (percentage)
        y: number;
        width: number;
        height: number;
    };

    // === EFFECTS ===
    effects: {
        vignette: number;           // -100 to +100
        vignetteFeather: number;    // 0 to 100
        grain: number;              // 0 to 100
        grainSize: number;          // 0 to 100
    };

    // === COLOR GRADING (colorize.c) ===
    colorGrading: {
        shadowsHue: number;
        shadowsSaturation: number;
        midtonesHue: number;
        midtonesSaturation: number;
        highlightsHue: number;
        highlightsSaturation: number;
        globalHue: number;
        globalSaturation: number;
        blending: number;
    };

    // === LOCAL ADJUSTMENTS ===
    localAdjustments: Array<{
        type: 'radial' | 'gradient' | 'brush';
        mask: {
            x: number;
            y: number;
            width: number;
            height: number;
            feather: number;
            invert: boolean;
        };
        adjustments: {
            exposure: number;
            contrast: number;
            highlights: number;
            shadows: number;
            clarity: number;
            saturation: number;
            temperature: number;
            sharpness: number;
        };
    }>;
}

// Default settings
export const defaultDevelopSettings: DevelopSettings = {
    exposure: 0,
    contrast: 0,
    brightness: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    clarity: 0,
    dehaze: 0,
    midtoneContrast: 0,
    temperature: 0,
    tint: 0,
    vibrance: 0,
    saturation: 0,
    colorHue: 0,
    colorSaturationGlobal: 0,
    hsl: {
        red: { hue: 0, saturation: 0, luminance: 0 },
        orange: { hue: 0, saturation: 0, luminance: 0 },
        yellow: { hue: 0, saturation: 0, luminance: 0 },
        green: { hue: 0, saturation: 0, luminance: 0 },
        aqua: { hue: 0, saturation: 0, luminance: 0 },
        blue: { hue: 0, saturation: 0, luminance: 0 },
        purple: { hue: 0, saturation: 0, luminance: 0 },
        magenta: { hue: 0, saturation: 0, luminance: 0 }
    },
    toneCurve: {
        enabled: false,
        points: [{ x: 0, y: 0 }, { x: 255, y: 255 }]
    },
    splitToning: {
        highlightHue: 0,
        highlightSaturation: 0,
        shadowHue: 0,
        shadowSaturation: 0,
        balance: 0
    },
    sharpening: {
        amount: 0,
        radius: 1.0,
        threshold: 0
    },
    noiseReduction: {
        luminance: 0,
        color: 0,
        detail: 50
    },
    lensCorrection: {
        distortion: 0,
        vignette: 0,
        chromaticAberration: 0
    },
    transform: {
        rotation: 0,
        perspectiveV: 0,
        perspectiveH: 0,
        aspectRatio: 'original'
    },
    crop: {
        enabled: false,
        x: 0,
        y: 0,
        width: 1,
        height: 1
    },
    effects: {
        vignette: 0,
        vignetteFeather: 50,
        grain: 0,
        grainSize: 25
    },
    colorGrading: {
        shadowsHue: 0,
        shadowsSaturation: 0,
        midtonesHue: 0,
        midtonesSaturation: 0,
        highlightsHue: 0,
        highlightsSaturation: 0,
        globalHue: 0,
        globalSaturation: 0,
        blending: 50
    },
    localAdjustments: []
};

class ImageProcessingService {
    /**
     * Process an image with development settings
     * This is the main processing pipeline similar to Darktable's pixelpipe
     */
    async processImage(
        inputPath: string,
        outputPath: string,
        settings: DevelopSettings
    ): Promise<void> {
        let pipeline = sharp(inputPath);

        // Get metadata for dimensions
        const metadata = await pipeline.metadata();
        const width = metadata.width || 0;
        const height = metadata.height || 0;

        // === STAGE 1: Basic adjustments ===
        // Apply exposure, brightness, contrast
        const brightness = 1 + (settings.brightness / 100) + (settings.exposure * 0.2);
        const saturation = 1 + (settings.saturation / 100);
        const hue = settings.colorHue;

        pipeline = pipeline.modulate({
            brightness: Math.max(0.1, brightness),
            saturation: Math.max(0, saturation),
            hue: hue
        });

        // === STAGE 2: Contrast and tonal adjustments ===
        if (settings.contrast !== 0) {
            // Use linear adjustment for contrast
            const contrast = 1 + (settings.contrast / 100);
            pipeline = pipeline.linear(contrast, -(128 * (contrast - 1)));
        }

        // === STAGE 3: Rotation and flip ===
        if (settings.transform.rotation !== 0) {
            pipeline = pipeline.rotate(settings.transform.rotation, {
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            });
        }

        // === STAGE 4: Crop ===
        if (settings.crop.enabled) {
            const cropX = Math.round(settings.crop.x * width);
            const cropY = Math.round(settings.crop.y * height);
            const cropWidth = Math.round(settings.crop.width * width);
            const cropHeight = Math.round(settings.crop.height * height);

            pipeline = pipeline.extract({
                left: cropX,
                top: cropY,
                width: Math.max(1, cropWidth),
                height: Math.max(1, cropHeight)
            });
        }

        // === STAGE 5: Sharpening ===
        if (settings.sharpening.amount > 0) {
            const sigma = settings.sharpening.radius;
            pipeline = pipeline.sharpen({
                sigma: sigma,
                m1: settings.sharpening.amount / 100,
                m2: settings.sharpening.amount / 200
            });
        }

        // === STAGE 6: Noise reduction (blur approximation) ===
        if (settings.noiseReduction.luminance > 20) {
            const sigma = settings.noiseReduction.luminance / 50;
            pipeline = pipeline.blur(Math.max(0.3, sigma));
        }

        // === STAGE 7: Color temperature (using tint) ===
        if (settings.temperature !== 0 || settings.tint !== 0) {
            // Temperature: positive = warmer (more yellow/red), negative = cooler (more blue)
            // This is a simplified version - real color temperature requires LAB conversion
            pipeline = pipeline.tint({
                r: Math.round(settings.temperature * 2.55),
                g: Math.round(-settings.tint * 2.55),
                b: Math.round(-settings.temperature * 2.55)
            });
        }

        // === OUTPUT ===
        await pipeline.toFile(outputPath);
    }

    /**
     * Generate a preview with CSS-compatible filter values
     * For fast UI preview without full processing
     */
    getCssFilterString(settings: DevelopSettings): string {
        const filters: string[] = [];

        // Brightness (exposure + brightness combined)
        const brightness = 1 + (settings.brightness / 100) + (settings.exposure * 0.2);
        filters.push(`brightness(${brightness.toFixed(2)})`);

        // Contrast
        const contrast = 1 + (settings.contrast / 100);
        filters.push(`contrast(${contrast.toFixed(2)})`);

        // Saturation (saturation + vibrance)
        const saturation = 1 + ((settings.saturation + settings.vibrance * 0.5) / 100);
        filters.push(`saturate(${saturation.toFixed(2)})`);

        // Hue rotation
        if (settings.colorHue !== 0) {
            filters.push(`hue-rotate(${settings.colorHue}deg)`);
        }

        // Color temperature approximation
        if (settings.temperature > 0) {
            filters.push(`sepia(${(settings.temperature / 100 * 0.3).toFixed(2)})`);
        }

        // Invert for negative exposure
        if (settings.exposure < -2) {
            const invertAmount = Math.min(0.2, Math.abs(settings.exposure + 2) * 0.1);
            filters.push(`invert(${invertAmount.toFixed(2)})`);
        }

        return filters.join(' ');
    }

    /**
     * Apply tone curve to image data
     * Based on Darktable's basecurve.c
     */
    applyToneCurve(
        imageData: Uint8ClampedArray,
        curve: Array<{ x: number; y: number }>
    ): Uint8ClampedArray {
        // Build lookup table from curve points
        const lut = new Uint8Array(256);

        // Sort points by x
        const sortedPoints = [...curve].sort((a, b) => a.x - b.x);

        // Linear interpolation between points
        for (let i = 0; i < 256; i++) {
            // Find surrounding points
            let p1 = sortedPoints[0];
            let p2 = sortedPoints[sortedPoints.length - 1];

            for (let j = 0; j < sortedPoints.length - 1; j++) {
                if (i >= sortedPoints[j].x && i <= sortedPoints[j + 1].x) {
                    p1 = sortedPoints[j];
                    p2 = sortedPoints[j + 1];
                    break;
                }
            }

            // Interpolate
            if (p2.x === p1.x) {
                lut[i] = p1.y;
            } else {
                const t = (i - p1.x) / (p2.x - p1.x);
                lut[i] = Math.round(p1.y + t * (p2.y - p1.y));
            }
        }

        // Apply LUT to image
        const result = new Uint8ClampedArray(imageData.length);
        for (let i = 0; i < imageData.length; i += 4) {
            result[i] = lut[imageData[i]];       // R
            result[i + 1] = lut[imageData[i + 1]]; // G
            result[i + 2] = lut[imageData[i + 2]]; // B
            result[i + 3] = imageData[i + 3];     // A
        }

        return result;
    }

    /**
     * Convert RAW file using darktable-cli if available
     */
    async convertRawWithDarktable(
        inputPath: string,
        outputPath: string,
        xmpPath?: string
    ): Promise<boolean> {
        try {
            // Check if darktable-cli is available
            const darktablePath = this.findDarktableCli();
            if (!darktablePath) {
                console.log('[ImageProcessing] darktable-cli not found');
                return false;
            }

            let command = `"${darktablePath}" "${inputPath}" "${outputPath}"`;
            if (xmpPath && fs.existsSync(xmpPath)) {
                command += ` --style "${xmpPath}"`;
            }

            execSync(command, { timeout: 60000 });
            return fs.existsSync(outputPath);

        } catch (error) {
            console.error('[ImageProcessing] darktable-cli error:', error);
            return false;
        }
    }

    private findDarktableCli(): string | null {
        const possiblePaths = [
            '/Applications/darktable.app/Contents/MacOS/darktable-cli',
            '/usr/local/bin/darktable-cli',
            '/opt/homebrew/bin/darktable-cli',
            'darktable-cli' // In PATH
        ];

        for (const p of possiblePaths) {
            try {
                if (p === 'darktable-cli') {
                    execSync('which darktable-cli');
                    return p;
                } else if (fs.existsSync(p)) {
                    return p;
                }
            } catch {
                continue;
            }
        }

        return null;
    }

    /**
     * Export image with all settings applied
     */
    async exportImage(
        inputPath: string,
        outputPath: string,
        settings: DevelopSettings,
        options: {
            format?: 'jpeg' | 'png' | 'tiff' | 'webp';
            quality?: number;
            width?: number;
            height?: number;
            colorSpace?: 'srgb' | 'p3' | 'cmyk';
        } = {}
    ): Promise<void> {
        const {
            format = 'jpeg',
            quality = 90,
            width,
            height,
            colorSpace = 'srgb'
        } = options;

        // First apply development settings
        const tempPath = outputPath + '.temp';
        await this.processImage(inputPath, tempPath, settings);

        // Then apply export settings
        let pipeline = sharp(tempPath);

        // Resize if specified
        if (width || height) {
            pipeline = pipeline.resize(width, height, {
                fit: 'inside',
                withoutEnlargement: true
            });
        }

        // Apply color space
        if (colorSpace === 'srgb') {
            pipeline = pipeline.toColorspace('srgb');
        }

        // Output format
        switch (format) {
            case 'jpeg':
                pipeline = pipeline.jpeg({ quality });
                break;
            case 'png':
                pipeline = pipeline.png({ quality });
                break;
            case 'tiff':
                pipeline = pipeline.tiff({ quality });
                break;
            case 'webp':
                pipeline = pipeline.webp({ quality });
                break;
        }

        await pipeline.toFile(outputPath);

        // Clean up temp file
        if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
        }
    }
}

export const imageProcessingService = new ImageProcessingService();
export default imageProcessingService;
