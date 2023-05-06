// @ts-check

const { dirname } = require('path');
const workerpool = require('workerpool');

const { default: axios } = require("axios");
const { first, noop, orderBy, shuffle } = require("lodash");
const { ElementType, parseDocument } = require('htmlparser2');
const { selectOne } = require('css-select');
const { hasChildren, isText, isCDATA } = require('domhandler');

/** @type {import('@seamless-medley/medley')} */
const { Medley } = process.env.MEDLEY_DEV
    // @ts-ignore
    ? require('node-gyp-build')(dirname(dirname(require.resolve('@seamless-medley/medley'))))
    : require('@seamless-medley/medley')
    ;

/** @typedef {import('domhandler').AnyNode} AnyNode */
/** @typedef {import('domhandler').Element} Element */
/** @typedef {import('../playout/boombox').BoomBoxCoverAnyLyrics['lyricsSource']} LyricSource */

/**
 * @param {AnyNode | AnyNode[]} node
 * @returns {string}
 */
function innerText(node) {
  if (Array.isArray(node)) return node.map(innerText).join("");
  if (hasChildren(node) && (node.type === ElementType.Tag || isCDATA(node))) {
      return innerText(node.children);
  }
  if (isText(node)) return node.data;
  return "";
}

/**
 *
 * @param {AnyNode} node
 * @param {number} level
 * @returns {AnyNode | undefined}
 */
function traverseUp(node, level) {
  const p = node.parentNode;
  if (--level && p) return traverseUp(p, level);
  return p ?? undefined;
}

/**
 *
 * @param {AnyNode} node
 * @returns {string[][]}
 */
function maybeLyrics(node) {
  if (isText(node)) {
    return [node.data.split('\n')];
  }

  if (hasChildren(node)) {
    return node.children.flatMap(maybeLyrics)
  }

  return [];
}

/**
 *
 * @param {string} artist
 * @param {string} title
 * @returns {Promise<{ source: LyricSource; lyrics: string[] } | undefined>}
 */
async function searchLyrics(artist, title) {

  return new Promise(async (resolve) => {
    const q = `${artist} ${title} lyrics`;

    const res = await axios.get(
      `https://www.google.com/search?q=${encodeURIComponent(q)}`,
    ).catch(noop);

    if (res) {
      try {
        /** @type {Element} */
        // @ts-ignore
        const dom = parseDocument(res.data);
        const mm = selectOne(`span.hwc a`, dom);

        if (mm?.type === ElementType.Tag) {
          const href = mm.attribs['href'];
          const source = innerText(mm);

          const up = traverseUp(mm, 5);

          if (up) {
            const lyrics = first(orderBy(maybeLyrics(up), ['length'], ['desc']));
            if (lyrics?.length) {
              resolve({
                source: {
                  href,
                  text: source
                },
                lyrics
              });
            }
          }
        }
      }
      catch (e) {

      }
    }

    resolve(undefined);
  });
}

workerpool.worker({
  metadata: Medley.getMetadata,
  coverAndLyrics: Medley.getCoverAndLyrics,
  isTrackLoadable: Medley.isTrackLoadable,
  searchLyrics
});

process.on('uncaughtException', (e) => console.error('uncaughtException', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
