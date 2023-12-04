import { ActionRowBuilder, CollectedMessageInteraction, CommandInteraction, InteractionCollector, InteractionReplyOptions, MappedInteractionTypes, Message, MessageActionRowComponentBuilder, MessageComponentInteraction, time as formatTime, userMention } from "discord.js";
import { MedleyAutomaton } from "../automaton";
import { guildIdGuard, joinStrings, makeColoredMessage, reply } from "./utils";
import { noop } from "lodash";
import { Strings } from "./type";

export type InteractorOnCollectParams = {
  runningKey: string;
  collected: MessageComponentInteraction;
  collector: InteractionCollector<CollectedMessageInteraction>,
  selector: Message,
  buildMessage: () => Omit<InteractionReplyOptions, 'flags'>;
  resetTimer: () => void;
  done: (shouldDelete?: boolean) => Promise<any>;
}

export type InteractorOptions = {
  automaton: MedleyAutomaton;
  commandName: string;
  interaction: CommandInteraction,
  onGoing?: Set<string>;
  ttl?: number;
  //
  formatTimeout?: (time: string) => string;
  makeCaption: () => Strings;
  makeComponents: () => Array<ActionRowBuilder<MessageActionRowComponentBuilder>>;
  onCollect: (params: InteractorOnCollectParams) => any;
}

const defaultFunctions = {
  formatTimeout: (time: string) => `Timeout: ${time}`
}

export async function interact(options: InteractorOptions) {
  const {
    interaction,
    onGoing,
    ttl,
    formatTimeout,
    makeCaption,
    makeComponents
  } = options;

  const guildId = guildIdGuard(interaction);
  const issuer = interaction.user.id;
  const runningKey = `${guildId}:${issuer}`;

  if (onGoing?.has(runningKey)) {
    reply(interaction, `Finish the previous \`${options.commandName}\` command, please`);
    return;
  }

  const makeTimeout = () => ttl ? (formatTimeout ?? defaultFunctions.formatTimeout)(formatTime(Math.trunc((Date.now() + ttl) / 1000), 'R')) : undefined;

  const buildMessage = (): Omit<InteractionReplyOptions, 'flags'> => ({
    fetchReply: true,
    content: joinStrings([
      makeTimeout(),
      ...makeCaption()
    ]),
    components: makeComponents()
  })

  const selector = await reply(interaction, buildMessage());

  if (selector instanceof Message) {
    const collector = selector.createMessageComponentCollector({ dispose: true, time: ttl });

    let done = false;
    const stop = async (shouldDelete: boolean = true) => {
      done = true;

      if (onGoing?.has(runningKey) ?? true) {
        onGoing?.delete(runningKey);

        collector.stop();

        if (shouldDelete && selector.deletable) {
          await selector.delete();
        }
      }
    }

    onGoing?.add(runningKey);

    collector.on('collect', async (collected) => {
      if (collected.user.id !== issuer) {
        collected.reply({
          content: `Sorry, this selection is for${userMention(issuer)} only`,
          ephemeral: true
        })
        return;
      }

      options.onCollect({
        runningKey,
        collected,
        collector,
        selector,
        buildMessage,
        done: stop,
        resetTimer: () => collector.resetTimer({ time: ttl })
      });
    });

    collector.on('end', async () => {
      if (!done && selector.editable) {
        await selector.edit({
          content: makeColoredMessage('yellow', 'Timed out, please try again'),
          components: []
        })
        .catch(noop);
      }

      await stop(false);
    });
  }
}
