import {
  ActionRowBuilder,
  CollectedMessageInteraction,
  InteractionCollector,
  InteractionReplyOptions,
  Message,
  MessageActionRowComponentBuilder,
  MessageComponentInteraction,
  MessageEditOptions,
  MessageFlags,
  RepliableInteraction,
  TextDisplayBuilder,
  time as formatTime,
  userMention
} from "discord.js";

import { MedleyAutomaton } from "../automaton";
import { deferReply, guildIdGuard, joinStrings, makeColoredMessage, reply } from "./utils";
import { Strings } from "./type";

export type InteractorMessageBuilder = () => Promise<Omit<InteractionReplyOptions, 'flags'> & Pick<MessageEditOptions, 'flags'>>;

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
  interaction: RepliableInteraction,
  onGoing?: Set<string>;
  ttl?: number;
  data?: D;
  useComponentV2?: boolean;
  ephemeral?: boolean;
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
    useComponentV2,
    ephemeral,
    formatTimeout,
    makeCaption,
    makeComponents
  } = options;

  // This ensures that we always get the message object when reply
  await deferReply(interaction);

  const guildId = guildIdGuard(interaction);
  const issuer = interaction.user.id;
  const runningKey = `${guildId}:${issuer}`;

  if (onGoing?.has(runningKey)) {
    reply(interaction, `${userMention(issuer)} Finish the previous \`${options.commandName}\` command, please`);
    return;
  }

  const makeTimeout = () => ttl ? (formatTimeout ?? defaultFunctions.formatTimeout)(formatTime(Math.trunc((Date.now() + ttl) / 1000), 'R')) : undefined;

  const content = joinStrings([
    !interaction.isChatInputCommand() ? `${userMention(issuer)} ` : undefined,
    makeTimeout(),
    ...await makeCaption(options.data)
  ]);

  const flags = ephemeral ? MessageFlags.Ephemeral : 0;

  const buildMessage: InteractorMessageBuilder = useComponentV2
    ? async () => ({
        withResponse: true,
        flags: flags | MessageFlags.IsComponentsV2,
        components: [
          new TextDisplayBuilder()
            .setContent(content),
          ...await makeComponents(options.data)
        ]
      })
    : async () => ({
        withResponse: true,
        flags,
        content,
        components: await makeComponents(options.data)
      })

  const replyMessage = async () => (await reply(interaction, await buildMessage())) as Message<boolean>;

  const selector = await replyMessage();

  if (!selector) {
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
        await interaction.deleteReply();
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
      const content = makeColoredMessage('yellow', reason ?? 'Canceled');
      interaction.editReply(useComponentV2
        ? { flags: flags | MessageFlags.IsComponentsV2, components: [new TextDisplayBuilder().setContent(content)] }
        : { content, components: [] }
      );

      return stop(false);
    }
  })

  collector.on('collect', async (collected) => {
    const content = `Sorry, this selection is for${userMention(issuer)} only`;

    if (collected.user.id !== issuer) {
      collected.reply(useComponentV2
        ? { flags: flags | MessageFlags.IsComponentsV2, components: [new TextDisplayBuilder().setContent(content)] }
        : { content, ephemeral: true }
      );
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

    if (!done) {
      const content = makeColoredMessage('yellow', 'Timed out, please try again');
      await interaction.editReply(useComponentV2
        ? { flags: flags | MessageFlags.IsComponentsV2, components: [new TextDisplayBuilder().setContent(content)] }
        : { content, components: [] }
      );
    }

    await stop(false);
  });
}
