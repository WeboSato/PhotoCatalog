/**
 * Darktable Native Module for Node.js
 * High-performance image processing inspired by Darktable
 *
 * This module provides native C++ implementations of key image processing
 * algorithms from Darktable for maximum performance.
 */

#include <napi.h>
#include <cmath>
#include <algorithm>
#include <vector>
#include <cstring>

#ifdef __APPLE__
#include <Accelerate/Accelerate.h>
#endif

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

// Clamp value between min and max
template<typename T>
inline T clamp(T value, T min_val, T max_val) {
    return std::max(min_val, std::min(max_val, value));
}

// Linear interpolation
inline float lerp(float a, float b, float t) {
    return a + t * (b - a);
}

// Convert sRGB to linear RGB
inline float srgb_to_linear(float val) {
    if (val <= 0.04045f) {
        return val / 12.92f;
    }
    return powf((val + 0.055f) / 1.055f, 2.4f);
}

// Convert linear RGB to sRGB
inline float linear_to_srgb(float val) {
    if (val <= 0.0031308f) {
        return val * 12.92f;
    }
    return 1.055f * powf(val, 1.0f / 2.4f) - 0.055f;
}

// RGB to HSL conversion
void rgb_to_hsl(float r, float g, float b, float* h, float* s, float* l) {
    float max_val = std::max({r, g, b});
    float min_val = std::min({r, g, b});
    float delta = max_val - min_val;

    *l = (max_val + min_val) / 2.0f;

    if (delta < 0.00001f) {
        *h = 0.0f;
        *s = 0.0f;
    } else {
        *s = *l < 0.5f ? delta / (max_val + min_val) : delta / (2.0f - max_val - min_val);

        if (max_val == r) {
            *h = (g - b) / delta + (g < b ? 6.0f : 0.0f);
        } else if (max_val == g) {
            *h = (b - r) / delta + 2.0f;
        } else {
            *h = (r - g) / delta + 4.0f;
        }
        *h /= 6.0f;
    }
}

// HSL to RGB conversion
void hsl_to_rgb(float h, float s, float l, float* r, float* g, float* b) {
    if (s < 0.00001f) {
        *r = *g = *b = l;
        return;
    }

    auto hue_to_rgb = [](float p, float q, float t) -> float {
        if (t < 0.0f) t += 1.0f;
        if (t > 1.0f) t -= 1.0f;
        if (t < 1.0f/6.0f) return p + (q - p) * 6.0f * t;
        if (t < 1.0f/2.0f) return q;
        if (t < 2.0f/3.0f) return p + (q - p) * (2.0f/3.0f - t) * 6.0f;
        return p;
    };

    float q = l < 0.5f ? l * (1.0f + s) : l + s - l * s;
    float p = 2.0f * l - q;

    *r = hue_to_rgb(p, q, h + 1.0f/3.0f);
    *g = hue_to_rgb(p, q, h);
    *b = hue_to_rgb(p, q, h - 1.0f/3.0f);
}

// ============================================================================
// EXPOSURE - Based on Darktable's exposure.c
// ============================================================================
void apply_exposure(float* pixels, int width, int height, int channels,
                    float exposure, float black_point) {
    const float exposure_factor = powf(2.0f, exposure);
    const int total = width * height * channels;

    #pragma omp parallel for
    for (int i = 0; i < total; i += channels) {
        for (int c = 0; c < 3; c++) {
            float val = pixels[i + c];
            // Apply black point
            val = std::max(0.0f, val - black_point);
            // Apply exposure
            val *= exposure_factor;
            pixels[i + c] = clamp(val, 0.0f, 1.0f);
        }
    }
}

// ============================================================================
// CONTRAST - Based on Darktable's colisa.c (contrast, lightness, saturation)
// ============================================================================
void apply_contrast(float* pixels, int width, int height, int channels,
                    float contrast, float brightness) {
    const float contrast_factor = (contrast + 100.0f) / 100.0f;
    const float brightness_offset = brightness / 100.0f;
    const int total = width * height * channels;

    #pragma omp parallel for
    for (int i = 0; i < total; i += channels) {
        for (int c = 0; c < 3; c++) {
            float val = pixels[i + c];
            // Apply contrast (around midpoint 0.5)
            val = (val - 0.5f) * contrast_factor + 0.5f;
            // Apply brightness
            val += brightness_offset;
            pixels[i + c] = clamp(val, 0.0f, 1.0f);
        }
    }
}

// ============================================================================
// HIGHLIGHTS/SHADOWS - Based on Darktable's shadhi.c
// ============================================================================
void apply_highlights_shadows(float* pixels, int width, int height, int channels,
                              float highlights, float shadows, float whites, float blacks) {
    const int total = width * height * channels;

    #pragma omp parallel for
    for (int i = 0; i < total; i += channels) {
        float r = pixels[i];
        float g = pixels[i + 1];
        float b = pixels[i + 2];

        // Calculate luminance
        float lum = 0.2126f * r + 0.7152f * g + 0.0722f * b;

        // Shadow/highlight masks (soft transitions)
        float shadow_mask = 1.0f - powf(lum, 0.5f);
        float highlight_mask = powf(lum, 2.0f);
        float black_mask = powf(1.0f - lum, 4.0f);
        float white_mask = powf(lum, 4.0f);

        // Calculate adjustment factors
        float shadow_adj = 1.0f + (shadows / 100.0f) * shadow_mask;
        float highlight_adj = 1.0f - (highlights / 100.0f) * highlight_mask;
        float black_adj = blacks / 100.0f * black_mask;
        float white_adj = whites / 100.0f * white_mask;

        // Apply adjustments
        for (int c = 0; c < 3; c++) {
            float val = pixels[i + c];
            val *= shadow_adj;
            val *= highlight_adj;
            val += black_adj;
            val += white_adj;
            pixels[i + c] = clamp(val, 0.0f, 1.0f);
        }
    }
}

// ============================================================================
// COLOR BALANCE RGB - Based on Darktable's colorbalancergb.c
// ============================================================================
void apply_color_balance(float* pixels, int width, int height, int channels,
                         float temperature, float tint, float vibrance, float saturation) {
    const int total = width * height * channels;

    // Temperature: negative = cool (blue), positive = warm (yellow/orange)
    float temp_r = 1.0f + temperature / 200.0f;
    float temp_b = 1.0f - temperature / 200.0f;

    // Tint: negative = green, positive = magenta
    float tint_g = 1.0f - tint / 200.0f;

    #pragma omp parallel for
    for (int i = 0; i < total; i += channels) {
        float r = pixels[i] * temp_r;
        float g = pixels[i + 1] * tint_g;
        float b = pixels[i + 2] * temp_b;

        // Calculate luminance
        float lum = 0.2126f * r + 0.7152f * g + 0.0722f * b;

        // Saturation adjustment
        float sat_factor = 1.0f + saturation / 100.0f;

        // Vibrance (saturation that affects less saturated colors more)
        float h, s, l;
        rgb_to_hsl(r, g, b, &h, &s, &l);
        float vibrance_factor = 1.0f + (vibrance / 100.0f) * (1.0f - s);

        // Combined saturation factor
        float combined_sat = sat_factor * vibrance_factor;

        // Apply saturation
        r = lum + (r - lum) * combined_sat;
        g = lum + (g - lum) * combined_sat;
        b = lum + (b - lum) * combined_sat;

        pixels[i] = clamp(r, 0.0f, 1.0f);
        pixels[i + 1] = clamp(g, 0.0f, 1.0f);
        pixels[i + 2] = clamp(b, 0.0f, 1.0f);
    }
}

// ============================================================================
// CLARITY - Based on Darktable's local contrast/clarity
// ============================================================================
void apply_clarity(float* pixels, int width, int height, int channels, float amount) {
    if (fabsf(amount) < 0.01f) return;

    // Create blurred version for unsharp mask
    std::vector<float> blurred(width * height * channels);

    // Simple box blur (5x5)
    const int radius = 5;

    #pragma omp parallel for
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            float sum_r = 0, sum_g = 0, sum_b = 0;
            int count = 0;

            for (int dy = -radius; dy <= radius; dy++) {
                for (int dx = -radius; dx <= radius; dx++) {
                    int nx = clamp(x + dx, 0, width - 1);
                    int ny = clamp(y + dy, 0, height - 1);
                    int idx = (ny * width + nx) * channels;
                    sum_r += pixels[idx];
                    sum_g += pixels[idx + 1];
                    sum_b += pixels[idx + 2];
                    count++;
                }
            }

            int out_idx = (y * width + x) * channels;
            blurred[out_idx] = sum_r / count;
            blurred[out_idx + 1] = sum_g / count;
            blurred[out_idx + 2] = sum_b / count;
        }
    }

    // Apply unsharp mask for clarity
    const float strength = amount / 100.0f;

    #pragma omp parallel for
    for (int i = 0; i < width * height * channels; i += channels) {
        for (int c = 0; c < 3; c++) {
            float diff = pixels[i + c] - blurred[i + c];
            pixels[i + c] = clamp(pixels[i + c] + diff * strength, 0.0f, 1.0f);
        }
    }
}

// ============================================================================
// DEHAZE - Based on Darktable's hazeremoval.c
// ============================================================================
void apply_dehaze(float* pixels, int width, int height, int channels, float strength) {
    if (fabsf(strength) < 0.01f) return;

    const float dehaze_strength = strength / 100.0f;

    // Estimate atmospheric light (simple: brightest pixel in image)
    float atm_light = 0.0f;
    for (int i = 0; i < width * height * channels; i += channels) {
        float lum = 0.2126f * pixels[i] + 0.7152f * pixels[i + 1] + 0.0722f * pixels[i + 2];
        if (lum > atm_light) atm_light = lum;
    }
    atm_light = std::min(atm_light, 0.95f);

    #pragma omp parallel for
    for (int i = 0; i < width * height * channels; i += channels) {
        float min_channel = std::min({pixels[i], pixels[i + 1], pixels[i + 2]});

        // Dark channel transmission estimate
        float transmission = 1.0f - dehaze_strength * (min_channel / atm_light);
        transmission = std::max(0.1f, transmission);

        for (int c = 0; c < 3; c++) {
            float val = (pixels[i + c] - atm_light * (1.0f - transmission)) / transmission;
            pixels[i + c] = clamp(val, 0.0f, 1.0f);
        }
    }
}

// ============================================================================
// SHARPEN - Based on Darktable's sharpen.c
// ============================================================================
void apply_sharpen(float* pixels, int width, int height, int channels,
                   float amount, float radius) {
    if (amount < 0.01f) return;

    std::vector<float> original(pixels, pixels + width * height * channels);
    const int blur_radius = static_cast<int>(radius + 0.5f);
    const float strength = amount / 100.0f;

    // Gaussian blur kernel (approximation)
    std::vector<float> blurred(width * height * channels);

    #pragma omp parallel for
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            float sum[3] = {0, 0, 0};
            float weight_sum = 0;

            for (int dy = -blur_radius; dy <= blur_radius; dy++) {
                for (int dx = -blur_radius; dx <= blur_radius; dx++) {
                    int nx = clamp(x + dx, 0, width - 1);
                    int ny = clamp(y + dy, 0, height - 1);

                    float dist = sqrtf(dx * dx + dy * dy);
                    float weight = expf(-dist * dist / (2.0f * radius * radius));

                    int idx = (ny * width + nx) * channels;
                    for (int c = 0; c < 3; c++) {
                        sum[c] += original[idx + c] * weight;
                    }
                    weight_sum += weight;
                }
            }

            int out_idx = (y * width + x) * channels;
            for (int c = 0; c < 3; c++) {
                blurred[out_idx + c] = sum[c] / weight_sum;
            }
        }
    }

    // Unsharp mask
    #pragma omp parallel for
    for (int i = 0; i < width * height * channels; i += channels) {
        for (int c = 0; c < 3; c++) {
            float diff = original[i + c] - blurred[i + c];
            pixels[i + c] = clamp(original[i + c] + diff * strength, 0.0f, 1.0f);
        }
    }
}

// ============================================================================
// TONE CURVE - Based on Darktable's basecurve.c
// ============================================================================
void apply_tone_curve(float* pixels, int width, int height, int channels,
                      float* curve_lut, int lut_size) {
    const int total = width * height * channels;

    #pragma omp parallel for
    for (int i = 0; i < total; i += channels) {
        for (int c = 0; c < 3; c++) {
            float val = pixels[i + c];
            int idx = static_cast<int>(val * (lut_size - 1));
            idx = clamp(idx, 0, lut_size - 1);
            pixels[i + c] = curve_lut[idx];
        }
    }
}

// ============================================================================
// VIGNETTE - Based on Darktable's vignette.c
// ============================================================================
void apply_vignette(float* pixels, int width, int height, int channels,
                    float amount, float feather) {
    if (fabsf(amount) < 0.01f) return;

    const float center_x = width / 2.0f;
    const float center_y = height / 2.0f;
    const float max_dist = sqrtf(center_x * center_x + center_y * center_y);
    const float feather_start = 1.0f - (feather / 100.0f);

    #pragma omp parallel for
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            float dx = x - center_x;
            float dy = y - center_y;
            float dist = sqrtf(dx * dx + dy * dy) / max_dist;

            // Smooth falloff
            float vignette_factor;
            if (dist < feather_start) {
                vignette_factor = 1.0f;
            } else {
                float t = (dist - feather_start) / (1.0f - feather_start);
                vignette_factor = 1.0f - (amount / 100.0f) * t * t;
            }

            int idx = (y * width + x) * channels;
            for (int c = 0; c < 3; c++) {
                pixels[idx + c] = clamp(pixels[idx + c] * vignette_factor, 0.0f, 1.0f);
            }
        }
    }
}

// ============================================================================
// NODE.JS BINDINGS
// ============================================================================

Napi::Value ProcessImage(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3) {
        Napi::TypeError::New(env, "Expected 3 arguments").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Get image buffer
    Napi::Buffer<uint8_t> buffer = info[0].As<Napi::Buffer<uint8_t>>();
    int width = info[1].As<Napi::Number>().Int32Value();
    int height = info[2].As<Napi::Number>().Int32Value();
    Napi::Object settings = info[3].As<Napi::Object>();

    const int channels = 4; // RGBA
    const int total_pixels = width * height;

    // Convert to float for processing
    std::vector<float> pixels(total_pixels * channels);
    for (int i = 0; i < total_pixels * channels; i++) {
        pixels[i] = buffer.Data()[i] / 255.0f;
    }

    // Apply processing based on settings
    if (settings.Has("exposure")) {
        float exposure = settings.Get("exposure").As<Napi::Number>().FloatValue();
        float black_point = settings.Has("blacks") ?
            settings.Get("blacks").As<Napi::Number>().FloatValue() / 100.0f * 0.1f : 0.0f;
        apply_exposure(pixels.data(), width, height, channels, exposure, black_point);
    }

    if (settings.Has("contrast") || settings.Has("brightness")) {
        float contrast = settings.Has("contrast") ?
            settings.Get("contrast").As<Napi::Number>().FloatValue() : 0.0f;
        float brightness = settings.Has("brightness") ?
            settings.Get("brightness").As<Napi::Number>().FloatValue() : 0.0f;
        apply_contrast(pixels.data(), width, height, channels, contrast, brightness);
    }

    if (settings.Has("highlights") || settings.Has("shadows") ||
        settings.Has("whites") || settings.Has("blacks")) {
        float highlights = settings.Has("highlights") ?
            settings.Get("highlights").As<Napi::Number>().FloatValue() : 0.0f;
        float shadows = settings.Has("shadows") ?
            settings.Get("shadows").As<Napi::Number>().FloatValue() : 0.0f;
        float whites = settings.Has("whites") ?
            settings.Get("whites").As<Napi::Number>().FloatValue() : 0.0f;
        float blacks = settings.Has("blacks") ?
            settings.Get("blacks").As<Napi::Number>().FloatValue() : 0.0f;
        apply_highlights_shadows(pixels.data(), width, height, channels,
                                 highlights, shadows, whites, blacks);
    }

    if (settings.Has("temperature") || settings.Has("tint") ||
        settings.Has("vibrance") || settings.Has("saturation")) {
        float temperature = settings.Has("temperature") ?
            settings.Get("temperature").As<Napi::Number>().FloatValue() : 0.0f;
        float tint = settings.Has("tint") ?
            settings.Get("tint").As<Napi::Number>().FloatValue() : 0.0f;
        float vibrance = settings.Has("vibrance") ?
            settings.Get("vibrance").As<Napi::Number>().FloatValue() : 0.0f;
        float saturation = settings.Has("saturation") ?
            settings.Get("saturation").As<Napi::Number>().FloatValue() : 0.0f;
        apply_color_balance(pixels.data(), width, height, channels,
                           temperature, tint, vibrance, saturation);
    }

    if (settings.Has("clarity")) {
        float clarity = settings.Get("clarity").As<Napi::Number>().FloatValue();
        apply_clarity(pixels.data(), width, height, channels, clarity);
    }

    if (settings.Has("dehaze")) {
        float dehaze = settings.Get("dehaze").As<Napi::Number>().FloatValue();
        apply_dehaze(pixels.data(), width, height, channels, dehaze);
    }

    if (settings.Has("sharpness")) {
        float sharpness = settings.Get("sharpness").As<Napi::Number>().FloatValue();
        float radius = settings.Has("sharpenRadius") ?
            settings.Get("sharpenRadius").As<Napi::Number>().FloatValue() : 1.0f;
        apply_sharpen(pixels.data(), width, height, channels, sharpness, radius);
    }

    if (settings.Has("vignette")) {
        float vignette = settings.Get("vignette").As<Napi::Number>().FloatValue();
        float feather = settings.Has("vignetteFeather") ?
            settings.Get("vignetteFeather").As<Napi::Number>().FloatValue() : 50.0f;
        apply_vignette(pixels.data(), width, height, channels, vignette, feather);
    }

    // Convert back to uint8
    Napi::Buffer<uint8_t> result = Napi::Buffer<uint8_t>::New(env, total_pixels * channels);
    for (int i = 0; i < total_pixels * channels; i++) {
        result.Data()[i] = static_cast<uint8_t>(clamp(pixels[i] * 255.0f, 0.0f, 255.0f));
    }

    return result;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("processImage", Napi::Function::New(env, ProcessImage));
    return exports;
}

NODE_API_MODULE(darktable_native, Init)
