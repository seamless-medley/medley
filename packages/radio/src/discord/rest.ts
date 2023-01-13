// A simpler version of @discordjs/rest SequentialHandler that works with Axios
// https://github.com/discordjs/discord.js/blob/main/packages/rest/src/lib/handlers/SequentialHandler.ts

import { Collection, DefaultUserAgent, DiscordAPIError, DiscordErrorData, HandlerRequestData, HashData, HTTPError, OAuthErrorData, RequestData, RequestHeaders, RESTPatchAPIChannelJSONBody, RouteData, RouteLike } from "discord.js";
import { AsyncQueue } from "@sapphire/async-queue";
import { DiscordSnowflake } from '@sapphire/snowflake';
import { waitFor } from "@seamless-medley/utils";
import axios, { AxiosRequestConfig, AxiosResponse } from "axios";

let invalidCount = 0;
let invalidCountResetTime: number | null = null;

const enum QueueType {
	Standard,
	Sublimit,
}

class SequentialHandler {
  public readonly id: string;

  private reset = -1;

  private remaining = 1;

  private limit = Number.POSITIVE_INFINITY;

  #asyncQueue = new AsyncQueue();

	#sublimitedQueue: AsyncQueue | null = null;

  #sublimitPromise: { promise: Promise<void>; resolve(): void } | null = null;

  #shiftSublimit = false;

	public constructor(
		private readonly hashes: Collection<string, HashData>,
		private readonly hash: string,
		private readonly majorParameter: string,
	) {
		this.id = `${hash}:${majorParameter}`;
	}

  private globalRemaining = 50;

  private globalDelay: Promise<void> | null = null;

  private globalReset = -1;

	private get globalLimited(): boolean {
		return this.globalRemaining <= 0 && Date.now() < this.globalReset;
	}

	private get localLimited(): boolean {
		return this.remaining <= 0 && Date.now() < this.reset;
	}

	private get limited(): boolean {
		return this.globalLimited || this.localLimited;
	}

	private get timeToReset(): number {
		return this.reset + 50 - Date.now();
	}

	private async globalDelayFor(time: number): Promise<void> {
		await waitFor(time);
		this.globalDelay = null;
	}

  public async queueRequest(
		routeId: RouteData,
		url: string,
		options: AxiosRequestConfig,
		requestData: HandlerRequestData,
	): Promise<AxiosResponse> {
    let queue = this.#asyncQueue;
		let queueType = QueueType.Standard;

		// Separate sublimited requests when already sublimited
		if (this.#sublimitedQueue && hasSublimit(routeId.bucketRoute, requestData.body, options.method)) {
			queue = this.#sublimitedQueue!;
			queueType = QueueType.Sublimit;
		}

    // Wait for any previous requests to be completed before this one is run
    await queue.wait({ signal: requestData.signal });
    // This set handles retroactively sublimiting requests
    if (queueType === QueueType.Standard) {
      if (this.#sublimitedQueue && hasSublimit(routeId.bucketRoute, requestData.body, options.method)) {
        /**
         * Remove the request from the standard queue, it should never be possible to get here while processing the
         * sublimit queue so there is no need to worry about shifting the wrong request
         */
        queue = this.#sublimitedQueue!;
        const wait = queue.wait();
        this.#asyncQueue.shift();
        await wait;
      } else if (this.#sublimitPromise) {
        // Stall requests while the sublimit queue gets processed
        await this.#sublimitPromise.promise;
      }
    }

    try {
			// Make the request, and return the results
			return await this.runRequest(routeId, url, options, requestData);
		} finally {
			// Allow the next request to fire
			queue.shift();
			if (this.#shiftSublimit) {
				this.#shiftSublimit = false;
				this.#sublimitedQueue?.shift();
			}

			// If this request is the last request in a sublimit
			if (this.#sublimitedQueue?.remaining === 0) {
				this.#sublimitPromise?.resolve();
				this.#sublimitedQueue = null;
			}
		}
  }

  private async runRequest(
		routeId: RouteData,
		url: string,
		options: AxiosRequestConfig,
		requestData: HandlerRequestData,
		retries = 0,
	): Promise<AxiosResponse> {
    while (this.limited) {
			const isGlobal = this.globalLimited;
			let limit: number;
			let timeout: number;
			let delay: Promise<void>;

			if (isGlobal) {
				// Set RateLimitData based on the global limit
				// limit = this.manager.options.globalRequestsPerSecond;
        limit = 50;
				timeout = this.globalReset + limit - Date.now();
				// If this is the first task to reach the global timeout, set the global delay
				if (!this.globalDelay) {
					// The global delay function clears the global delay state when it is resolved
					this.globalDelay = this.globalDelayFor(timeout);
				}

				delay = this.globalDelay;
			} else {
				// Set RateLimitData based on the route-specific limit
				limit = this.limit;
				timeout = this.timeToReset;
				delay = waitFor(timeout);
			}

			// const rateLimitData: RateLimitData = {
			// 	timeToReset: timeout,
			// 	limit,
			// 	method: options.method ?? 'get',
			// 	hash: this.hash,
			// 	url,
			// 	route: routeId.bucketRoute,
			// 	majorParameter: this.majorParameter,
			// 	global: isGlobal,
			// };

			// When not erroring, emit debug for what is happening
			// if (isGlobal) {
			// 	// this.debug(`Global rate limit hit, blocking all requests for ${timeout}ms`);
			// } else {
			// 	// this.debug(`Waiting ${timeout}ms for rate limit to pass`);
			// }

			// Wait the remaining time left before the rate limit resets
			await delay;
		}

		// As the request goes out, update the global usage information
		if (!this.globalReset || this.globalReset < Date.now()) {
			this.globalReset = Date.now() + 1_000;
			this.globalRemaining = 50;
		}

		this.globalRemaining--;

		const method = options.method ?? 'GET';

		let res: AxiosResponse;
		try {
      res = await axios<DiscordErrorData | OAuthErrorData>(url, { ...options });
		} catch (error: unknown) {
			if (!(error instanceof Error)) throw error;
			// Retry the specified number of times if needed
			if (shouldRetry(error) && retries !== 3) {
				// eslint-disable-next-line no-param-reassign
				return await this.runRequest(routeId, url, options, requestData, ++retries);
			}

			throw error;
		}

		const status = res.status;
		let retryAfter = 0;

		const limit = parseHeader(res.headers['x-ratelimit-limit']);
		const remaining = parseHeader(res.headers['x-ratelimit-remaining']);
		const reset = parseHeader(res.headers['x-ratelimit-reset-after']);
		const hash = parseHeader(res.headers['x-ratelimit-bucket']);
		const retry = parseHeader(res.headers['retry-after']);

		// Update the total number of requests that can be made before the rate limit resets
		this.limit = limit ? Number(limit) : Number.POSITIVE_INFINITY;
		// Update the number of remaining requests that can be made before the rate limit resets
		this.remaining = remaining ? Number(remaining) : 1;
		// Update the time when this rate limit resets (reset-after is in seconds)
		this.reset = reset ? Number(reset) * 1_000 + Date.now() + 50 : Date.now();

		// Amount of time in milliseconds until we should retry if rate limited (globally or otherwise)
		if (retry) retryAfter = Number(retry) * 1_000 + 50;

		// Handle buckets via the hash header retroactively
		if (hash && hash !== this.hash) {
			// Let library users know when rate limit buckets have been updated
			// this.debug(['Received bucket hash update', `  Old Hash  : ${this.hash}`, `  New Hash  : ${hash}`].join('\n'));
			// This queue will eventually be eliminated via attrition
			this.hashes.set(`${method}:${routeId.bucketRoute}`, { value: hash, lastAccess: Date.now() });
		} else if (hash) {
			// Handle the case where hash value doesn't change
			// Fetch the hash data from the manager
			const hashData = this.hashes.get(`${method}:${routeId.bucketRoute}`);

			// When fetched, update the last access of the hash
			if (hashData) {
				hashData.lastAccess = Date.now();
			}
		}

		// Handle retryAfter, which means we have actually hit a rate limit
		let sublimitTimeout: number | null = null;
		if (retryAfter > 0) {
			if (res.headers['x-ratelimit-global'] !== undefined) {
				this.globalRemaining = 0;
				this.globalReset = Date.now() + retryAfter;
			} else if (!this.localLimited) {
				/*
				 * This is a sublimit (e.g. 2 channel name changes/10 minutes) since the headers don't indicate a
				 * route-wide rate limit. Don't update remaining or reset to avoid rate limiting the whole
				 * endpoint, just set a reset time on the request itself to avoid retrying too soon.
				 */
				sublimitTimeout = retryAfter;
			}
		}

		// Count the invalid requests
		if (status === 401 || status === 403 || status === 429) {
			if (!invalidCountResetTime || invalidCountResetTime < Date.now()) {
				invalidCountResetTime = Date.now() + 1_000 * 60 * 10;
				invalidCount = 0;
			}

			invalidCount++;
		}

		if (status >= 200 && status < 300) {
			return res;
		} else if (status === 429) {
			// A rate limit was hit - this may happen if the route isn't associated with an official bucket hash yet, or when first globally rate limited
			const isGlobal = this.globalLimited;
			let limit: number;
			let timeout: number;

			if (isGlobal) {
				// Set RateLimitData based on the global limit
				limit = 50;
				timeout = this.globalReset + 50 - Date.now();
			} else {
				// Set RateLimitData based on the route-specific limit
				limit = this.limit;
				timeout = this.timeToReset;
			}

			// this.debug(
			// 	[
			// 		'Encountered unexpected 429 rate limit',
			// 		`  Global         : ${isGlobal.toString()}`,
			// 		`  Method         : ${method}`,
			// 		`  URL            : ${url}`,
			// 		`  Bucket         : ${routeId.bucketRoute}`,
			// 		`  Major parameter: ${routeId.majorParameter}`,
			// 		`  Hash           : ${this.hash}`,
			// 		`  Limit          : ${limit}`,
			// 		`  Retry After    : ${retryAfter}ms`,
			// 		`  Sublimit       : ${sublimitTimeout ? `${sublimitTimeout}ms` : 'None'}`,
			// 	].join('\n'),
			// );


			// If caused by a sublimit, wait it out here so other requests on the route can be handled
			if (sublimitTimeout) {
				// Normally the sublimit queue will not exist, however, if a sublimit is hit while in the sublimit queue, it will
				const firstSublimit = !this.#sublimitedQueue;
				if (firstSublimit) {
					this.#sublimitedQueue = new AsyncQueue();
					void this.#sublimitedQueue.wait();
					this.#asyncQueue.shift();
				}

				this.#sublimitPromise?.resolve();
				this.#sublimitPromise = null;
				await waitFor(sublimitTimeout);
				let resolve: () => void;
				// eslint-disable-next-line promise/param-names, no-promise-executor-return
				const promise = new Promise<void>((res) => (resolve = res));
				this.#sublimitPromise = { promise, resolve: resolve! };
				if (firstSublimit) {
					// Re-queue this request so it can be shifted by the finally
					await this.#asyncQueue.wait();
					this.#shiftSublimit = true;
				}
			}

			// Since this is not a server side issue, the next request should pass, so we don't bump the retries counter
			return this.runRequest(routeId, url, options, requestData, retries);
		} else if (status >= 500 && status < 600) {
			// Retry the specified number of times for possible server side issues
			if (retries !== 3) {
				// eslint-disable-next-line no-param-reassign
				return this.runRequest(routeId, url, options, requestData, ++retries);
			}

			// We are out of retries, throw an error
			throw new HTTPError(status, method, url, requestData);
		} else {
			// Handle possible malformed requests
			if (status >= 400 && status < 500) {
				// If we receive this status code, it means the token we had is no longer valid.
				if (status === 401 && requestData.auth) {
					// this.manager.setToken(null!);
				}

				// The request will not succeed for some reason, parse the error returned from the api
				const data = res.data;
				// throw the API error
				throw new DiscordAPIError(data, 'code' in data ? data.code : data.error, status, method, url, requestData);
			}

			return res;
		}
  }
}

export function hasSublimit(bucketRoute: string, body?: unknown, method?: string): boolean {
	// Currently known sublimits:
	// Editing channel `name` or `topic`
	if (bucketRoute === '/channels/:id') {
		if (typeof body !== 'object' || body === null) {
      return false;
    }
		// This should never be a POST body, but just in case
		if (method !== 'PATCH') {
      return false;
    }

		const castedBody = body as RESTPatchAPIChannelJSONBody;
		return ['name', 'topic'].some((key) => Reflect.has(castedBody, key));
	}

	// If we are checking if a request has a sublimit on a route not checked above, sublimit all requests to avoid a flood of 429s
	return true;
}

export function parseHeader(header: string[] | string | undefined): string | undefined {
	if (header === undefined || typeof header === 'string') {
		return header;
	}

	return header.join(';');
}

export function shouldRetry(error: Error | NodeJS.ErrnoException) {
	// Retry for possible timed out requests
	if (error.name === 'AbortError') {
    return true;
  }
	// Downlevel ECONNRESET to retry as it may be recoverable
	return ('code' in error && error.code === 'ECONNRESET') || error.message.includes('ECONNRESET');
}

interface RestRequest extends RequestData {
  fullRoute: RouteLike;
  method: string;
}

export class RestClient {
  private readonly hashes = new Collection<string, HashData>();

  public readonly handlers = new Collection<string, SequentialHandler>();

	public async queueRequest(request: RestRequest): Promise<AxiosResponse> {
		// Generalize the endpoint to its route data
		const routeId = generateRouteData(request.fullRoute, request.method);
		// Get the bucket hash for the generic route, or point to a global route otherwise
		const hash = this.hashes.get(`${request.method}:${routeId.bucketRoute}`) ?? {
			value: `Global(${request.method}:${routeId.bucketRoute})`,
			lastAccess: -1,
		};

		// Get the request handler for the obtained hash, with its major parameter
		const handler =
			this.handlers.get(`${hash.value}:${routeId.majorParameter}`) ??
			this.createHandler(hash.value, routeId.majorParameter);

		// Resolve the request into usable fetch options
		const { url, fetchOptions } = await this.resolveRequest(request);

		// Queue the request
		return handler.queueRequest(routeId, url, fetchOptions, {
			body: request.body,
			files: request.files,
			auth: request.auth !== false,
			signal: request.signal,
		});
	}

	private createHandler(hash: string, majorParameter: string) {
		// Create the async request queue to handle requests
		const queue = new SequentialHandler(this.hashes, hash, majorParameter);
		// Save the queue based on its id
		this.handlers.set(queue.id, queue);

		return queue;
	}

  #token: string | null = null;

	public setToken(token: string) {
		this.#token = token;
		return this;
	}

  private async resolveRequest(request: RestRequest): Promise<{ fetchOptions: AxiosRequestConfig; url: string }> {
		let query = '';

		// If a query option is passed, use it
		if (request.query) {
			const resolvedQuery = request.query.toString();
			if (resolvedQuery !== '') {
				query = `?${resolvedQuery}`;
			}
		}

		// Create the required headers
		const headers: RequestHeaders = {
			'User-Agent': `${DefaultUserAgent} Node.js ${process.version}`.trim(),
		};

		// If this request requires authorization (allowing non-"authorized" requests for webhooks)
		if (request.auth !== false) {
			// If we haven't received a token, throw an error
			if (!this.#token) {
				throw new Error('Expected token to be set for this request, but none was present');
			}

			headers.Authorization = `${request.authPrefix ?? 'Bot'} ${this.#token}`;
		}

		// If a reason was set, set it's appropriate header
		if (request.reason?.length) {
			headers['X-Audit-Log-Reason'] = encodeURIComponent(request.reason);
		}

		// Format the full request URL (api base, optional version, endpoint, optional querystring)
		const url = `https://discord.com/api${request.versioned === false ? '' : `/v10`}${
			request.fullRoute
		}${query}`;

		let finalBody: RequestInit['body'];
		let additionalHeaders: Record<string, string> = {
      'Accept-Encoding': 'gzip'
    };

    if (request.body != null) {
			if (request.passThroughBody) {
				finalBody = request.body as BodyInit;
			} else {
				// Stringify the JSON data
				finalBody = JSON.stringify(request.body);
				// Set the additional headers to specify the content-type
				additionalHeaders = { 'Content-Type': 'application/json' };
			}
		}

		const fetchOptions: AxiosRequestConfig = {
			headers: {
        ...request.headers,
        ...additionalHeaders,
        ...headers
      } as Record<string, string>,
			method: request.method.toUpperCase(),
		};

		if (finalBody !== undefined) {
			fetchOptions.data = finalBody;
		}

		// Prioritize setting an agent per request, use the agent for this instance otherwise.
		// fetchOptions.dispatcher = request.dispatcher ?? this.agent ?? undefined!;

		return { url, fetchOptions };
	}
}


function generateRouteData(endpoint: RouteLike, method: string): RouteData {
  const majorIdMatch = /^\/(?:channels|guilds|webhooks)\/(\d{16,19})/.exec(endpoint);

  // Get the major id for this route - global otherwise
  const majorId = majorIdMatch?.[1] ?? 'global';

  const baseRoute = endpoint
    // Strip out all ids
    .replaceAll(/\d{16,19}/g, ':id')
    // Strip out reaction as they fall under the same bucket
    .replace(/\/reactions\/(.*)/, '/reactions/:reaction');

  let exceptions = '';

  // Hard-Code Old Message Deletion Exception (2 week+ old messages are a different bucket)
  // https://github.com/discord/discord-api-docs/issues/1295
  if (method === 'DELETE' && baseRoute === '/channels/:id/messages/:id') {
    const id = /\d{16,19}$/.exec(endpoint)![0]!;
    const timestamp = DiscordSnowflake.timestampFrom(id);
    if (Date.now() - timestamp > 1_000 * 60 * 60 * 24 * 14) {
      exceptions += '/Delete Old Message';
    }
  }

  return {
    majorParameter: majorId,
    bucketRoute: baseRoute + exceptions,
    original: endpoint,
  };
}
