import * as faceapi from 'face-api.js';

export interface DetectedFace {
    id: string;
    box: {
        x: number;
        y: number;
        width: number;
        height: number;
    };
    descriptor: Float32Array | null;
    confidence: number;
    landmarks?: faceapi.FaceLandmarks68;
}

export interface FaceMatch {
    personId: string;
    personName: string;
    distance: number;
    confidence: number;
}

// Minimum confidence threshold for face detection (0.0 to 1.0)
// Higher values = fewer false positives (logos, patterns, etc.)
// 0.5 is a good balance, 0.6+ for stricter detection
const MIN_FACE_CONFIDENCE = 0.5;

interface CachedDetection {
    faces: DetectedFace[];
    timestamp: number;
}

class FaceRecognitionService {
    private modelsLoaded = false;
    private labeledDescriptors: Map<string, faceapi.LabeledFaceDescriptors> = new Map();
    private detectionCache: Map<string, CachedDetection> = new Map();
    private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
    private cleanupInterval: ReturnType<typeof setInterval> | null = null;

    private log(message: string, ...args: any[]) {
        console.log(`[FaceRecognition] ${message}`, ...args);
    }

    private logError(message: string, ...args: any[]) {
        console.error(`[FaceRecognition] ${message}`, ...args);
    }

    async ensureModelsLoaded(): Promise<void> {
        if (!this.modelsLoaded) {
            await this.loadModels();
        }
    }

    async loadModels(): Promise<void> {
        if (this.modelsLoaded) {
            this.log('Models already loaded');
            return;
        }

        try {
            const isDev = window.location.href.includes('localhost');
            const MODEL_URL = isDev ? '/models' : 'local-model://';

            this.log('Loading models from:', MODEL_URL);

            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            ]);

            this.modelsLoaded = true;
            this.log('Models loaded successfully');

            // Start periodic cache cleanup
            if (!this.cleanupInterval) {
                this.cleanupInterval = setInterval(() => this.cleanupCache(), this.CACHE_TTL);
            }
        } catch (error) {
            this.logError('Failed to load models:', error);
            throw error;
        }
    }

    async detectFaces(imageElement: HTMLImageElement): Promise<DetectedFace[]> {
        await this.ensureModelsLoaded();

        // Check cache first
        const cacheKey = this.generateCacheKey(imageElement.src);
        const cached = this.detectionCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            this.log('Cache hit for:', cacheKey.substring(0, 12));
            return cached.faces;
        }

        try {
            const detectionOptions = new faceapi.SsdMobilenetv1Options({
                minConfidence: MIN_FACE_CONFIDENCE
            });

            const detections = await faceapi
                .detectAllFaces(imageElement, detectionOptions)
                .withFaceLandmarks()
                .withFaceDescriptors();

            const now = Date.now();
            const result = detections.map((detection, index) => ({
                id: `face_${now}_${index}`,
                box: {
                    x: detection.detection.box.x / imageElement.width,
                    y: detection.detection.box.y / imageElement.height,
                    width: detection.detection.box.width / imageElement.width,
                    height: detection.detection.box.height / imageElement.height,
                },
                descriptor: detection.descriptor,
                confidence: detection.detection.score,
                landmarks: detection.landmarks,
            }));

            // Store in cache
            this.detectionCache.set(cacheKey, { faces: result, timestamp: now });

            this.log(`Detected ${result.length} face(s)`);
            return result;
        } catch (error) {
            this.logError('Face detection failed:', error);
            return [];
        }
    }

    /**
     * Robust face detection: tries multiple confidence thresholds
     * if the default threshold finds no faces.
     */
    async detectFacesRobust(imageElement: HTMLImageElement): Promise<DetectedFace[]> {
        await this.ensureModelsLoaded();

        const thresholds = [MIN_FACE_CONFIDENCE, 0.3, 0.7];

        for (const threshold of thresholds) {
            try {
                const detectionOptions = new faceapi.SsdMobilenetv1Options({
                    minConfidence: threshold
                });

                const detections = await faceapi
                    .detectAllFaces(imageElement, detectionOptions)
                    .withFaceLandmarks()
                    .withFaceDescriptors();

                if (detections.length > 0) {
                    const now = Date.now();
                    this.log(`Robust detection found ${detections.length} face(s) at threshold ${threshold}`);
                    return detections.map((detection, index) => ({
                        id: `face_${now}_${index}`,
                        box: {
                            x: detection.detection.box.x / imageElement.width,
                            y: detection.detection.box.y / imageElement.height,
                            width: detection.detection.box.width / imageElement.width,
                            height: detection.detection.box.height / imageElement.height,
                        },
                        descriptor: detection.descriptor,
                        confidence: detection.detection.score,
                        landmarks: detection.landmarks,
                    }));
                }
            } catch (error) {
                console.warn(`[FaceRecognition] Detection failed at threshold ${threshold}:`, error);
            }
        }

        return [];
    }

    async detectFacesFromUrl(imageUrl: string): Promise<DetectedFace[]> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';

            img.onload = async () => {
                try {
                    const faces = await this.detectFaces(img);
                    resolve(faces);
                } catch (error) {
                    reject(error);
                }
            };

            img.onerror = () => reject(new Error(`Failed to load image: ${imageUrl}`));
            img.src = imageUrl;
        });
    }

    addPersonDescriptor(personId: string, personName: string, descriptors: Float32Array[]): void {
        const labeled = new faceapi.LabeledFaceDescriptors(
            `${personId}:${personName}`,
            descriptors
        );
        this.labeledDescriptors.set(personId, labeled);
    }

    removePersonDescriptor(personId: string): void {
        this.labeledDescriptors.delete(personId);
    }

    findBestMatch(descriptor: Float32Array): FaceMatch | null {
        if (this.labeledDescriptors.size === 0) return null;

        try {
            const allDescriptors = Array.from(this.labeledDescriptors.values());
            const matcher = new faceapi.FaceMatcher(allDescriptors, 0.6);
            const match = matcher.findBestMatch(descriptor);

            if (match.label === 'unknown') return null;

            // Extra distance check for confidence
            if (match.distance > 0.6) return null;

            const [personId, personName] = match.label.split(':');
            return {
                personId,
                personName: personName || 'Unknown',
                distance: match.distance,
                confidence: 1 - match.distance,
            };
        } catch (error) {
            this.logError('Error finding best match:', error);
            return null;
        }
    }

    calculateDistance(descriptor1: Float32Array, descriptor2: Float32Array): number {
        return faceapi.euclideanDistance(descriptor1, descriptor2);
    }

    isModelsLoaded(): boolean {
        return this.modelsLoaded;
    }

    clearCache(): void {
        this.detectionCache.clear();
        this.log('Detection cache cleared');
    }

    cleanupCache(): void {
        const now = Date.now();
        let removed = 0;
        for (const [key, cached] of this.detectionCache.entries()) {
            if (now - cached.timestamp > this.CACHE_TTL) {
                this.detectionCache.delete(key);
                removed++;
            }
        }
        if (removed > 0) {
            this.log(`Cache cleanup: removed ${removed} expired entries, ${this.detectionCache.size} remaining`);
        }
    }

    getCacheStats(): { size: number; ttl: number } {
        return {
            size: this.detectionCache.size,
            ttl: this.CACHE_TTL
        };
    }

    private generateCacheKey(url: string): string {
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(36);
    }
}

export const faceRecognitionService = new FaceRecognitionService();
export default faceRecognitionService;