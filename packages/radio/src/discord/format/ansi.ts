const colors = {
  reset: 0,
  gray: 30,
  red: 31,
  green: 32,
  yellow: 33,
  blue: 34,
  pink: 35,
  cyan: 36,
  white: 37,
  bgDarkBlue: 40,
  bgOrange: 41,
  bgMarbleBlue: 42,
  bgGrey: 43,
  bgGray: 44,
  bgIndigo: 45,
  bgLightGray: 46,
  bgWhite: 47
}

export type Colors = keyof typeof colors;

export type Format = 'b' | 'u' | 'n';

export type Formats = Format | 'bu';

export type ColorsAndFormat = Colors | `${Colors}|${Formats}`;

type Escape = [code: number, format?: Format];

function escape(...[code, format]: Escape) {
  const fmt = [code];

  if (format) {
    fmt.unshift(({n: 0, b: 1, u: 4})[format]);
  }

  return `\u001b[${fmt.join(';')}m`;
}

const MARKS = Object.keys(colors).toString().replace(/,/g, '|')

const Pattern = new RegExp(
  String.raw`\{{2}\s*((${MARKS})(\|([bun]*))?)\s*\}{2}`,
  'gi'
)

const reset = escape(0, 'n');

export const formatAnsi = (s: string) => s.replace(Pattern, (s, ...args) => {
  const [, name, , mods = ''] = args;
  const modifiers = (mods as string).split('').filter((c): c is Format => ['b', 'u', 'n'].includes(c));
  const mainCode = (colors as any)[name];
  const codes: Escape[] = (modifiers.length > 0) ? modifiers.map<Escape>(fmt => [mainCode, fmt]) : [[mainCode]];
  return codes.map(args => escape(...args)).join('')
});

export function ansi(inputs: TemplateStringsArray, ...exprs: any[]) {
  const s = inputs.reduce((a, s, i) => (a += exprs[--i] + s));
  const escaped = formatAnsi(s);
  return `${reset}${escaped}${reset}`;
}

export const simpleFormat = (s: string, f: ColorsAndFormat) => formatAnsi(`{{${f}}}${s}`);
