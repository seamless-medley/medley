import { createRoot, type Root } from "react-dom/client";
import * as LogTape from "@logtape/logtape";
import { MedleyClient } from "./medley-client";

let root: Root;
let _client: MedleyClient | undefined;

const levelAbbreviations: Record<LogTape.LogLevel, string> = {
  "trace": "TRC",
  "debug": "DBG",
  "info": "INF",
  "warning": "WRN",
  "error": "ERR",
  "fatal": "FTL",
};

const logLevelStyles: Record<LogTape.LogLevel, string> = {
  "trace": "background-color: gold; color: black;",
  "debug": "background-color: blue; color: white;",
  "info": "background-color: lime; color: darkgreen;",
  "warning": "background-color: orange; color: black;",
  "error": "background-color: red; color: white;",
  "fatal": "background-color: maroon; color: white;",
};

const colorsMap = new Map<string, string>();

function hashString(s: string) {
  let hash = 0;

  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }

  return hash;
}

const categoryColors = [
  'fuchsia', 'magenta', 'red', 'tomato',
  'green', 'lime', 'chartreuse', 'greenyellow', 'lawngreen', 'springgreen',
  'yellow', 'coral', 'cornsilk', 'hotpink', 'orangered',
  'blue', 'aqua', 'cyan', 'blueviolet', 'cornflowerblue', 'deepskyblue', 'dodgerblue',
  'burlywood', 'palegoldenrod', 'pink', 'plum',
];

function getCategoryColor(category: string) {
  let color = colorsMap.get(category);
  if (color === undefined) {
    const hash = hashString(category.toString());

    color = categoryColors[Math.abs(hash) % categoryColors.length];
    colorsMap.set(category, color);
  }

  return color;
}

function consoleFormatter(record: LogTape.LogRecord) {
  let msg = "";

  const values: unknown[] = [];

  for (let i = 0; i < record.message.length; i++) {
    if (i % 2 === 0) msg += record.message[i];
    else {
      msg += "%o";
      values.push(record.message[i]);
    }
  }

  const date = new Date(record.timestamp);

  const [dd, MM, yyyy, hh, mm, ss] = [
    date.getDate(), date.getMonth() + 1, date.getFullYear(),
    date.getHours(), date.getMinutes(), date.getSeconds()
  ].map(v => v.toString().padStart(2, '0'));

  const ms = date.getMilliseconds();

  const time = `${dd}/${MM}/${yyyy} ${hh}:${mm}:${ss}.${ms}`;

  return [
    `%c${time} %c ${levelAbbreviations[record.level]} %c ${
      record.category.map(c => `%c${c}`).join("\xb7")
    } %c${msg}`,


    "color: gray;",
    logLevelStyles[record.level],
    "background-color: default;",

    ...record.category.map(c => `color: ${getCategoryColor(c)}`),

    "color: default;",
    ...values,
  ];
}

export async function initLogging() {
  const sinks = ['console'];
  const lowestLevel = import.meta.env.DEV ? 'trace' : 'info';

  await LogTape.configure({
    sinks: {
      console: LogTape.getConsoleSink({
        nonBlocking: true,
        formatter: consoleFormatter
      })
    },
    loggers: [
      { category: ['logtape', 'meta'], lowestLevel: 'error', sinks },
      { category: 'main', sinks, lowestLevel },
      { category: 'client', sinks, lowestLevel },
      { category: 'transport', sinks, lowestLevel },
      { category: 'audio', sinks, lowestLevel },
      { category: 'ui', sinks, lowestLevel },
    ]
  });

  if (import.meta.env.DEV) {
    const main = LogTape.getLogger('main');
    for (const level of LogTape.getLogLevels()) {
      (main as any).log(level, `TEST LOGGING ${level}`);
    }
  }
}

export function initClient() {
  // @ts-ignore
  const isDev = import.meta.env.DEV;

  if (isDev) {
    _client = window.$client;
  }

  if (!_client) {
    _client = new MedleyClient();
    _client.once('disconnect', () => {
      _client?.dispose();
      _client = undefined;
      window.$client = undefined;
    });

    if (isDev) {
      window.$client = _client;
    }
  }

  return _client;
}

export function initRoot() {
  // @ts-ignore
  if (import.meta.env.DEV) {
    root = window.$root;
  }

  root ??= createRoot(document.getElementById('root') as HTMLElement);

  // @ts-ignore
  if (!window.$root && import.meta.env.DEV) {

    window.$root = root;
  }

  return root;
}

export const client = initClient();

