import { ActionRowBuilder, CollectedMessageInteraction, CommandInteraction, InteractionCollector, InteractionReplyOptions, MappedInteractionTypes, Message, MessageActionRowComponentBuilder, MessageComponentInteraction, time as formatTime, userMention } from "discord.js";
import { MedleyAutomaton } from "../automaton";
import { ReplyableInteraction, guildIdGuard, joinStrings, makeColoredMessage, reply } from "./utils";
import { noop } from "lodash";
import { Strings } from "./type";

export type InteractorMessageBuilder = () => Promise<Omit<InteractionReplyOptions, 'flags'>>;

export type InteractorOnCollectParams<D> = {
  data?: D;
  runningKey: string;
  collected: MessageComponentInteraction;
  collector: InteractionCollector<CollectedMessageInteraction>,
  selector: Message,
  buildMessage: InteractorMessageBuilder;
  resetTimer: () => void;
  done: (shouldDelete?: boolean) => Promise<any>;
}

export type InteractorHookParams = {
  refresh: (what?: Partial<{ message: boolean, timer: boolean }>) => void;
  cancel: (reason?: string) => void;
}

export type InteractorOptions<D = unknown> = {
  automaton: MedleyAutomaton;
  commandName: string;
  interaction: ReplyableInteraction,
  onGoing?: Set<string>;
  ttl?: number;
  data?: D;
  //
  formatTimeout?: (time: string) => string;
  makeCaption: (data?: D) => Promise<Strings>;
  makeComponents: (data?: D) => Promise<Array<ActionRowBuilder<MessageActionRowComponentBuilder>>>;
  onCollect: (params: InteractorOnCollectParams<D>) => any;

  hook?: (params: InteractorHookParams) => () => any;
}

const defaultFunctions = {
  formatTimeout: (time: string) => `Timeout: ${time}`
}

export async function interact<D>(options: InteractorOptions<D>): Promise<void> {
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
    reply(interaction, `${userMention(issuer)} Finish the previous \`${options.commandName}\` command, please`);
    return;
  }

  const makeTimeout = () => ttl ? (formatTimeout ?? defaultFunctions.formatTimeout)(formatTime(Math.trunc((Date.now() + ttl) / 1000), 'R')) : undefined;

  const buildMessage: InteractorMessageBuilder = async () => ({
    fetchReply: true,
    content: joinStrings([
      makeTimeout(),
      ...await makeCaption(options.data)
    ]),
    components: await makeComponents(options.data)
  });

  const replyMessage = async () => reply(interaction, await buildMessage());

  const selector = await replyMessage();

  if (!(selector instanceof Message)) {
    return;
  }

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

  const resetTimer = () => collector.resetTimer({ time: ttl });

  const cleanup = options.hook?.({
    refresh: ({ message = true, timer = true } = {}) => {
      if (message) {
        replyMessage();
      }

      if (timer) {
        resetTimer();
      }
    },

    cancel: (reason) => {
      interaction.editReply({
        content: makeColoredMessage('yellow', reason ?? 'Canceled'),
        components: []
      });

      return stop(false);
    }
  })

  collector.on('collect', async (collected) => {
    if (collected.user.id !== issuer) {
      collected.reply({
        content: `Sorry, this selection is for${userMention(issuer)} only`,
        ephemeral: true
      })
      return;
    }

    options.onCollect({
      data: options.data,
      runningKey,
      collected,
      collector,
      selector,
      buildMessage,
      resetTimer,
      done: stop
    });
  });

  collector.on('end', async () => {
    cleanup?.();

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
