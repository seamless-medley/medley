// @ts-check

const axios = require('axios').default;

/**
 * @typedef {import('axios').AxiosInstance} AxiosInstance
 */

/**
 * @template T
 * @typedef {import('axios').AxiosResponse<T>} AxiosResponse
 */

/**
 * @template B
 * @typedef {import("./types").MMResponse<B>} MMResponse
 */

/**
 * @typedef {import("./types").TokenData} TokenData
 * @typedef {import("./types").SearchData} SearchData
 * @typedef {import("./types").TrackGet} TrackGet
 */

/**
 * @template {string} P
 * @typedef {import("./types").LyricInfo<P>} LyricInfo
 */

class Musixmatch {
  /** @type {AxiosInstance} */
  client;

  /** @type {string=} */
  token;

  /**
   *
   * @param {{ token?: string, userAgent?: string }} options
   */
  constructor(options = {}) {
    this.token = options.token;

    this.client = axios.create({
      baseURL: 'https://apic-desktop.musixmatch.com/ws/1.1',
      headers: {
        'cookie': 'AWSELBCORS=0; AWSELB=0'
      }
    });
  }

  get #newParams() {
    return {
      user_language: 'en',
      app_id: 'web-desktop-app-v1.0',
      t: Date.now()
    }
  }

  /**
   *
   * @returns {Promise<string | undefined>}
   */
  async fetchToken() {
    if (this.token) {
      return this.token;
    }

    /** @type {AxiosResponse<MMResponse<TokenData>>} */
    const res = await this.client.get('/token.get', {
      params: this.#newParams
    });

    const status_code = res?.data.message?.header?.status_code;

    if (status_code !== 200)  {
      throw new Error('Could not fetch token');
    }

    this.token = res.data.message.body.user_token;
    return this.token;
  }

  /**
   * @template R
   * @template {{}} P
   *
   * @param {string} url
   * @param {P} params
   * @returns {Promise<R | undefined>}
   */
  async request(url, params) {
    /** @type {AxiosResponse<MMResponse<R>> | string} */
    const res = await this.client.get(url, {
      params: {
        ...this.#newParams,
        ...params
      }
    }).catch((e) => e.message);

    if (typeof res !== 'object') {
      return
    }

    if (res?.data?.message?.header?.status_code === 200) {
      return res.data.message.body;
    }
  }

  /**
   *
   * @param {string} title
   * @param {string} artist
   */
  async search(title, artist) {
    /** @type {SearchData | undefined} */
    const body = await this.request('/track.search', {
      usertoken: await this.fetchToken(),
      q_track: title,
      q_artist: artist,
      f_has_lyrics: 1,
      s_track_rating: 'desc',
      subtitle_format: 'lrc',
      format: 'json'
    });

    return (body?.track_list ?? []).map(o => o.track);
  }

  /**
   *
   * @param {{ isrc: string } | { commontrack_id: number }} params
   */
  async get(params) {
    /** @type {TrackGet | undefined} */
    const body = await this.request('/track.get', {
      usertoken: await this.fetchToken(),
      // @ts-expect-error
      track_isrc: params.isrc,
      // @ts-expect-error
      commontrack_id: params.commontrack_id,
      format: 'json'
    });

    return body?.track;
  }

  /**
   *
   * @param {{ track_id: number } | { commontrack_id: number }} params
   */
  async lyrics(params) {
    /** @type {{ lyrics: LyricInfo<'lyrics'>; } | undefined} */
    const body = await this.request('/track.lyrics.get', {
      ...params,
      usertoken: await this.fetchToken()
    });

    return body?.lyrics;
  }

  /**
   *
   * @param {{ track_id: number } | { commontrack_id: number }} params
   */
  async subtitle(params) {
    /** @type {{ subtitle: LyricInfo<'subtitle'>; } | undefined} */
    const body = await this.request('/track.subtitle.get', {
      ...params,
      usertoken: await this.fetchToken()
    });

    return body?.subtitle;
  }

  /**
   *
   * @param {{ track_id: number } | { commontrack_id: number }} params
   * @returns
   */
  async richsync(params) {
    /** @type {{ richsync: import("./types").RichSyncData } | undefined} */
    const body = await this.request('/track.richsync.get', {
      ...params,
        usertoken: await this.fetchToken(),
    });

    return body?.richsync;
  }
}

module.exports = {
  Musixmatch
}
