/**
 * Thrown by upstream methods when a request fails or returns a non-2xx
 * status. Carries enough information to map to a downstream response
 * (the BFF's error handler middleware typically catches this and produces
 * a 502 or whatever the application policy is).
 */
export class UpstreamError extends Error {
	override readonly name = 'UpstreamError'

	constructor(
		message: string,
		readonly options: {
			/** HTTP status from the upstream response, or undefined if the request didn't get that far. */
			status?: number
			/** The URL that was being requested. */
			url: string
			/** The HTTP method used. */
			method: string
			/** Parsed body if the upstream returned one (JSON or text). */
			body?: unknown
			/** The original error if this wraps a fetch/network failure. */
			cause?: unknown
		},
	) {
		super(message)
	}

	/** Convenience getter — the most common thing handlers check. */
	get status(): number | undefined {
		return this.options.status
	}
}