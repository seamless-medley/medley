export type MentionType = 'user' | 'channel' | 'role';

export const formatMention = (type: MentionType, id: string) => {
  const p = ({user: '@', channel: '#', role: '@#'})[type];
  return `<${p}${id}>`;
}

export const formatDuration = (seconds: number) => seconds > 0
  ? ([[1, 60], [60, 60], [60 * 60, 24, true]] as [number, number, boolean | undefined][])
    .reverse()
    .map(([d, m, optional]) => {
      const v = Math.trunc(seconds / d) % m;
      return (v !== 0 || !optional)
        ? `${v}`.padStart(2, '0')
        : undefined
    })
    .filter(v => v !== undefined)
    .join(':')
  : undefined

export const formatMarkdownLink = (caption: string, href: string) => `[${caption}](${href})`;

