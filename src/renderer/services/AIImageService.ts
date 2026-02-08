// AI Image Service using transformers.js (runs locally in app)
import { pipeline, env } from '@huggingface/transformers';

// Configure for Electron environment
env.allowLocalModels = false;
env.useBrowserCache = true;
// Use remote models from Hugging Face CDN
env.backends.onnx.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0/dist/';

type ImageClassificationPipeline = Awaited<ReturnType<typeof pipeline<'image-classification'>>>;

class AIImageService {
    private classifier: ImageClassificationPipeline | null = null;
    private isLoading = false;
    private initError: string | null = null;

    async initialize(progressCallback?: (progress: number, status: string) => void): Promise<boolean> {
        if (this.classifier) return true;
        if (this.isLoading) return false;

        this.isLoading = true;
        this.initError = null;
        progressCallback?.(5, 'Loading AI model...');

        try {
            // Use a small, fast model - MobileNet
            this.classifier = await pipeline(
                'image-classification',
                'Xenova/mobilenet_v2_1.0_224',
                {
                    progress_callback: (progress: any) => {
                        if (progress.progress !== undefined) {
                            const pct = Math.round(progress.progress);
                            progressCallback?.(5 + pct * 0.9, `Downloading model... ${pct}%`);
                        }
                    }
                }
            );

            progressCallback?.(100, 'AI ready!');
            this.isLoading = false;
            return true;
        } catch (error) {
            console.error('Failed to initialize AI model:', error);
            this.initError = (error as Error).message;
            this.isLoading = false;
            return false;
        }
    }

    async analyzeImage(imageUrl: string): Promise<{ keywords: string[] }> {
        if (!this.classifier) {
            throw new Error(this.initError || 'AI model not initialized');
        }

        try {
            // Convert local-image:// URL to data URL for the model
            let processedUrl = imageUrl;

            if (imageUrl.startsWith('local-image://')) {
                // Fetch the image and convert to blob URL
                const response = await fetch(imageUrl);
                const blob = await response.blob();
                processedUrl = URL.createObjectURL(blob);
            }

            const results = await this.classifier(processedUrl, { topk: 8 });

            // Clean up blob URL if created
            if (processedUrl !== imageUrl && processedUrl.startsWith('blob:')) {
                URL.revokeObjectURL(processedUrl);
            }

            // Extract keywords from results
            const keywords: string[] = [];
            for (const result of results as any[]) {
                if (result.score > 0.05) {
                    // Clean up ImageNet label
                    const label = result.label
                        .toLowerCase()
                        .replace(/_/g, ' ')
                        .replace(/\d+/g, '')
                        .trim();

                    // Split compound labels
                    const parts = label.split(',').map((p: string) => p.trim());
                    for (const part of parts) {
                        if (part && !keywords.includes(part)) {
                            keywords.push(part);
                        }
                    }
                }
            }

            return { keywords: keywords.slice(0, 10) };
        } catch (error) {
            console.error('Error analyzing image:', error);
            throw error;
        }
    }

    isReady(): boolean {
        return this.classifier !== null;
    }

    isInitializing(): boolean {
        return this.isLoading;
    }

    getError(): string | null {
        return this.initError;
    }
}

export const aiImageService = new AIImageService();
export default aiImageService;
