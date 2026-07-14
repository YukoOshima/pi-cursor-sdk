/**
 * Local stand-in for earendil `calculateContextTokens` (compaction usage sum).
 * omp `@oh-my-pi/pi-coding-agent` does not export this helper.
 */

export type ContextTokenUsage = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens?: number;
};

/** Sum usage fields the same way earendil compaction did. */
export function calculateContextTokens(usage: ContextTokenUsage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}
