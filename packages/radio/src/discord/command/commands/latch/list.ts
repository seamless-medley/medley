import { guildStationGuard, joinStrings, makeAnsiCodeBlock, reply } from "../../utils";
import { ansi } from "../../../format/ansi";
import { SubCommandHandlerOptions } from "./type";
import { Station } from "../../../../core";

export const getLatchSessionsListing = (station: Station) => station.allLatches.map((l) => {
  const from =  ansi` from {{bgOrange}} {{white|u}}${l.collection.extra.description}{{bgOrange|n}} {{reset}} collection`;
  return ansi`{{pink}}${l.count}/${l.max}{{reset}}${from}`;
});

export async function list(options: SubCommandHandlerOptions) {
  const { automaton, interaction } = options;

  const { station } = guildStationGuard(automaton, interaction);

  const latching = station.latch(undefined);

  if (latching === undefined) {
    reply(interaction, 'Not latching');
    return;
  }

  const listing = getLatchSessionsListing(station);

  reply(interaction, joinStrings([
    'Latching:',
    ...makeAnsiCodeBlock(listing)
  ]));
}
