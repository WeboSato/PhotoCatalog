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

class FaceRecognitionService {
    private modelsLoaded = false;
    private labeledDescriptors: Map<string, faceapi.LabeledFaceDescriptors> = new Map();

    async loadModels(): Promise<void> {
        if (this.modelsLoaded) return;

        try {
            // Use local protocol for models in production, /models in dev
            const isDev = window.location.href.includes('localhost');
            const MODEL_URL = isDev ? '/models' : 'local-model://';

            console.log('[FaceRecognition] Loading models from:', MODEL_URL);

            await Promise.all([
                faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            ]);

            this.modelsLoaded = true;
            console.log('[FaceRecognition] Models loaded successfully');
        } catch (error) {
            console.error('[FaceRecognition] Failed to load models:', error);
            throw error;
        }
    }

    async detectFaces(imageElement: HTMLImageElement): Promise<DetectedFace[]> {
        if (!this.modelsLoaded) {
            await this.loadModels();
        }

        try {
            const detections = await faceapi
                .detectAllFaces(imageElement)
                .withFaceLandmarks()
                .withFaceDescriptors();

            const now = Date.now();
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
        } catch (error) {
            console.error('[FaceRecognition] Face detection failed:', error);
            return [];
        }
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

            img.onerror = () => reject(new Error('Failed to load image'));
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

        const allDescriptors = Array.from(this.labeledDescriptors.values());
        const matcher = new faceapi.FaceMatcher(allDescriptors, 0.6);
        const match = matcher.findBestMatch(descriptor);

        if (match.label === 'unknown') return null;

        const [personId, personName] = match.label.split(':');
        return {
            personId,
            personName: personName || 'Unknown',
            distance: match.distance,
            confidence: 1 - match.distance,
        };
    }

    calculateDistance(descriptor1: Float32Array, descriptor2: Float32Array): number {
        return faceapi.euclideanDistance(descriptor1, descriptor2);
    }

    isModelsLoaded(): boolean {
        return this.modelsLoaded;
    }
}

export const faceRecognitionService = new FaceRecognitionService();
export default faceRecognitionService;
