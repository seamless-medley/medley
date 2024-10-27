import { decibelsToGain, gainToDecibels, interpolate } from "@seamless-medley/utils";
import { ChatInputCommandInteraction } from "discord.js";
import { range, round } from "lodash";
import { ansi } from "../../format/ansi";
import { AutomatonCommandError, AutomatonPermissionError, CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { declare, deny, guildIdGuard, makeAnsiCodeBlock, warn } from "../utils";
import { AutomatonAccess } from "../../automaton";

const dbToEmoji = (db: number) => {
  if (db > 3) return '🔊💥';
  if (db >= 0) return '🔊🔊';
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
      description: 'Volume in Decibels, -60 to 0 dB',
      min_value: -60,
      max_value: 0,
      required: false
    },
    {
      type: OptionType.Number,
      name: 'percent',
      choices: list.map(([value, db]) => ({ name: `${value}% ${dbToEmoji(db)}`, value })),
      description: 'Volume in percentage, 0 to 100 %',
      min_value: 0,
      max_value: 100,
      required: false
    }
  ]
}))(makeVolumeScale(0, 100, 5).reverse())

const createCommandHandler: InteractionHandlerFactory<ChatInputCommandInteraction> = (automaton) => async (interaction) => {
  const guildId = guildIdGuard(interaction);

  const state = automaton.getGuildState(guildId);

  if (!state) {
    deny(interaction, 'No station linked');
    return;
  }

  if (!state.hasVoiceChannel()) {
    deny(interaction, 'Not in a voice channel');
    return;
  }

  const access = await automaton.getAccessFor(interaction);

  if (access <= AutomatonAccess.None) {
    throw new AutomatonPermissionError(automaton, interaction);
  }

  const oldGain = state.gain;
  const oldDecibels = g2d(oldGain);

  let inDecibels = interaction.options.getNumber('db');
  let inPercent = interaction.options.getNumber('percent');

  if (inDecibels === null && inPercent === null) {
    declare(interaction, makeAnsiCodeBlock(ansi`Current volume: {{pink|b}}${volumeToString(oldDecibels)}`));
    return;
  }

  if (inDecibels !== null && inPercent !== null) {
    warn(interaction, 'Use db/volume option exclusively');
    return;
  }

  if (inDecibels === null) {
    inDecibels = percentToDb(inPercent!)
  }

  state.gain = decibelsToGain(inDecibels);

  declare(interaction, makeAnsiCodeBlock(ansi`{{green|b}}OK{{reset}}, Fading volume from {{pink}}${volumeToString(oldDecibels)}{{reset}} to {{cyan}}${volumeToString(inDecibels)}`));
}

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
