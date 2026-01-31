/**
 * Simple performance logger for debugging
 */

const LOG_ENABLED = true;
const PERF_ENABLED = true;

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'perf';

const colors: Record<LogLevel, string> = {
    debug: '#888',
    info: '#4ade80',
    warn: '#facc15',
    error: '#ef4444',
    perf: '#818cf8'
};

class Logger {
    private startTimes: Map<string, number> = new Map();

    private log(level: LogLevel, module: string, message: string, data?: unknown) {
        if (!LOG_ENABLED && level !== 'error') return;

        const timestamp = new Date().toISOString().slice(11, 23);
        const prefix = `%c[${timestamp}] [${module}]`;
        const style = `color: ${colors[level]}; font-weight: bold`;

        if (data !== undefined) {
            console.log(prefix, style, message, data);
        } else {
            console.log(prefix, style, message);
        }
    }

    debug(module: string, message: string, data?: unknown) {
        this.log('debug', module, message, data);
    }

    info(module: string, message: string, data?: unknown) {
        this.log('info', module, message, data);
    }

    warn(module: string, message: string, data?: unknown) {
        this.log('warn', module, message, data);
    }

    error(module: string, message: string, data?: unknown) {
        this.log('error', module, message, data);
    }

    // Performance timing
    time(label: string) {
        if (!PERF_ENABLED) return;
        this.startTimes.set(label, performance.now());
    }

    timeEnd(label: string, threshold = 16) {
        if (!PERF_ENABLED) return;
        const start = this.startTimes.get(label);
        if (start) {
            const duration = performance.now() - start;
            this.startTimes.delete(label);
            if (duration > threshold) {
                this.log('perf', 'PERF', `${label}: ${duration.toFixed(1)}ms ⚠️ SLOW`);
            } else {
                this.log('perf', 'PERF', `${label}: ${duration.toFixed(1)}ms`);
            }
        }
    }

    // Track render count
    private renderCounts: Map<string, number> = new Map();
    trackRender(component: string) {
        if (!LOG_ENABLED) return;
        const count = (this.renderCounts.get(component) || 0) + 1;
        this.renderCounts.set(component, count);
        if (count % 10 === 0) {
            this.log('debug', component, `Rendered ${count} times`);
        }
    }
}

export const logger = new Logger();
export default logger;
