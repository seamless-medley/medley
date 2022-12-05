import { decibelsToGain, gainToDecibels, interpolate } from "@seamless-medley/core";
import { ChatInputCommandInteraction } from "discord.js";
import { range, round } from "lodash";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { accept, deny, guildIdGuard, warn } from "../utils";

const dbToEmoji = (db: number) => {
  if (db > 3) return '🔊💥';
  if (db > 0) return '🔊🔊';
  if (db > -15) return '🔊';
  if (db > -36) return '🔉';
  if (db > -60) return '🔈';
  return '🔇';
}


const g2d = (g: number) => round(gainToDecibels(g));
const percentToDb = (p: number) => interpolate(p, [0, 100], [-60, 0]);
const dbToPercent = (db: number) => interpolate(db, [-60, 0], [0, 100]);

const volumeToString = (db: number) => `${round(dbToPercent(db), 2)}% (${db>0?'+':''}${round(db, 2)}dB) ${dbToEmoji(db)}`;

const makeVolumeScale = (min: number, max: number, step: number): [percent: number, db: number][] => range(min, max + step, step).map(p => [p, percentToDb(p)])

const declaration: SubCommandLikeOption = ((list) => ({
  type: OptionType.SubCommand,
  name: 'volume',
  description: 'Set volume',
  options: [
    {
      type: OptionType.Number,
      choices: list.map(([, value]) => ({ name: `${value}dB ${dbToEmoji(value)}`, value })),
      name: 'db',
      description: 'Volume in Decibels, -60 to 6 dB',
      min_value: -60,
      max_value: 6,
      required: false
    },
    {
      type: OptionType.Number,
      name: 'percent',
      choices: list.map(([value, db]) => ({ name: `${value}% ${dbToEmoji(db)}`, value })),
      description: 'Volume in percentage, 0 to 110 %',
      min_value: 0,
      max_value: 110,
      required: false
    }
  ]
}))(makeVolumeScale(0, 110, 5).reverse())

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const guildId = guildIdGuard(interaction);

  const state = automaton.getGuildState(guildId);

  if (!state) {
    deny(interaction, 'No station linked');
    return;
  }

  if (!state.voiceChannelId) {
    deny(interaction, 'Not in a voice channel');
    return;
  }

  const oldGain = automaton.getGain(guildId);
  const oldDecibels = g2d(oldGain);

  let inDecibels = interaction.options.getNumber('db');
  let inPercent = interaction.options.getNumber('percent');

  if (inDecibels === null && inPercent === null) {
    accept(interaction, `Current volume: ${volumeToString(oldDecibels)}`);
    return;
  }

  if (inDecibels !== null && inPercent !== null) {
    warn(interaction, 'Use db/volume option exclusively');
    return;
  }

  if (inDecibels === null) {
    inDecibels = percentToDb(inPercent!)
  }

  if (!automaton.setGain(guildId, decibelsToGain(inDecibels))) {
    deny(interaction, 'Not in a voice channel');
    return;
  }

  accept(interaction, `OK: Fading volume from ${volumeToString(oldDecibels)} to ${volumeToString(inDecibels)}`);
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
