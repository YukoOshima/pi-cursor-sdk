import type { ApiKey } from "@oh-my-pi/pi-ai";

export const CURSOR_API_KEY_ENV_VAR = "CURSOR_API_KEY";
const CURSOR_PROVIDER_ID = "cursor";

// Non-secret literal sentinel for pi's provider registry. Pi 0.77 treats `$ENV_VAR`
// values as unconfigured when the env var is absent, which hides fallback models
// before `/login`. Keep the provider available and resolve the real key in the
// Cursor provider turn path from pi auth or CURSOR_API_KEY.
export const CURSOR_API_KEY_CONFIG_VALUE = "pi-cursor-sdk-cursor-api-key-placeholder";

const CURSOR_API_KEY_PLACEHOLDERS = new Set([
	CURSOR_API_KEY_ENV_VAR,
	`$${CURSOR_API_KEY_ENV_VAR}`,
	`\${${CURSOR_API_KEY_ENV_VAR}}`,
	CURSOR_API_KEY_CONFIG_VALUE,
]);

/** Coerce pi-ai `ApiKey` (string | resolver) down to a static string for resolve paths. */
export function coerceApiKeyString(apiKey?: ApiKey): string | undefined {
	return typeof apiKey === "string" ? apiKey : undefined;
}

export function resolveCursorApiKey(apiKey?: string): string | undefined {
	const trimmed = apiKey?.trim();
	if (!trimmed) return undefined;
	if (CURSOR_API_KEY_PLACEHOLDERS.has(trimmed)) return process.env.CURSOR_API_KEY?.trim() || undefined;
	return trimmed;
}

async function getStoredCursorApiKey(): Promise<string | undefined> {
	try {
		const { AuthStorage } = await import("@oh-my-pi/pi-coding-agent");
		const { getAgentDbPath } = await import("./host-agent-paths.js");
		const storage = await AuthStorage.create(getAgentDbPath());
		try {
			// omp AuthStorage.create opens SQLite but does not hydrate in-memory
			// credentials until reload() (same pattern as auth-broker / CLI).
			await storage.reload();
			// Read only persisted credentials. AuthStorage.getApiKey() intentionally
			// prefers CURSOR_API_KEY over non-login stored keys; this package keeps
			// stored-then-env ordering via resolveCursorRuntimeApiKey.
			const stored = storage.listStoredCredentials(CURSOR_PROVIDER_ID);
			const apiKeys = stored
				.map((row) => row.credential)
				.filter(
					(credential): credential is { type: "api_key"; key: string; source?: "login" } =>
						credential.type === "api_key",
				);
			const preferred = apiKeys.find((credential) => credential.source === "login") ?? apiKeys[0];
			return preferred ? resolveCursorApiKey(preferred.key) : undefined;
		} finally {
			storage.close();
		}
	} catch {
		return undefined;
	}
}

export async function resolveCursorRuntimeApiKey(): Promise<string | undefined> {
	return (await getStoredCursorApiKey()) ?? resolveCursorApiKey(process.env.CURSOR_API_KEY);
}
