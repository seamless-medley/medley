import { getTrackBanner, RequestTrack, TrackPeek } from "@medley/core";
import { User } from "discord.js";
import { maxBy, padStart } from "lodash";
import { MedleyAutomaton } from "../../../automaton";

export async function makeRequestPreview(automaton: MedleyAutomaton, index: number = 0, focus?: number) {
  const peeking = automaton.dj.peekRequests(index, 5);

  if (peeking.length <= 0) {
    return;
  }

  const padding = 2 + (maxBy(peeking, 'index')?.index.toString().length || 0);

  const previewTrack = (focus?: number) => ({ index, track }: TrackPeek<RequestTrack<User['id']>>) => {
    const label = padStart(`${focus === index ? '+ ' : ''}${index + 1}`, padding);
    return `${label}: ${getTrackBanner(track)} [${track.priority || 0}]`;
  };

  const lines: string[] = [];

  if (peeking[0].index > 1) {
    const first = automaton.dj.peekRequests(0, 1);
    if (first.length) {
      lines.push(previewTrack(focus)(first[0]));
      lines.push(padStart('...', padding));
    }
  }

  for (const peek of peeking) {
    lines.push(previewTrack(focus)(peek));
  }

  return lines.length
    ? [
      '```diff',
      ...lines,
      '```'
    ]
    : undefined;
}