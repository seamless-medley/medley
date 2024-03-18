export function formatDuration(seconds: number, options?: { withMs?: boolean }) {
    const [mm, ss, ms] = [
        Math.trunc(seconds / 60),
        Math.trunc(seconds % 60),
        Math.trunc(seconds % 1 * 100)
    ].map(e => e.toString().padStart(2, '0'))

    return `${mm}:${ss}` + (options?.withMs ? `.${ms}` : '');
}
