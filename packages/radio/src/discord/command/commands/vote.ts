import { AudienceType, getTrackBanner, makeAudience, StationRequestedTrack, TrackPeek } from "@seamless-medley/core";
import { CommandInteraction, Message, EmbedBuilder, MessageReaction, ActionRowBuilder, MessageActionRowComponentBuilder, ButtonBuilder, ButtonStyle, } from "discord.js";
import { chain, isEqual, keyBy, sampleSize, take, without } from "lodash";
import * as emojis from "../../emojis";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { formatMention, guildStationGuard, joinStrings, makeRequestPreview, reply, warn } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'vote',
  description: 'Vote for songs'
}

type Nominatee = TrackPeek<StationRequestedTrack> & {
  banner: string;
  votes: number;
  emoji: string;
}

const guildVoteMessage = new Map<string, Message>();

const distinguishableEmojis = without(emojis.distinguishable, '🏁');

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  const exisingVote = guildVoteMessage.get(guildId);
  if (exisingVote) {
    warn(interaction, 'Vote is currently on-going');
    return;
  }



  const count = Math.min(distinguishableEmojis.length, station.requestsCount, 20);
  const peekings = station.peekRequests(0, count);

  if (peekings.length <= 1) {
    warn(interaction, 'Nothing to vote')
    return;
  }

  if (!station.lockRequests(interaction.guildId)) {
    warn(interaction, 'Voting is currently happening somewhere else');
    return;
  }

  // TODO: Add try-catch here, unlockRequests
  const issuer = interaction.user.id;

  const collectibleEmojis = sampleSize(distinguishableEmojis, distinguishableEmojis.length);

  const nominatees = peekings.map<Nominatee>((p, i) => ({
    ...p,
    banner: getTrackBanner(p.track),
    votes: 0,
    voters: [],
    emoji: collectibleEmojis[i]
  }));

  const emojiToNominateeMap = new Map(
    nominatees.map(n => [n.emoji, n])
  );

  const ttl = 90_000;

  const getTimeout = () => `Vote Timeout: <t:${Math.trunc((Date.now() + ttl) / 1000)}:R>`;

  const createMessageContent = () => chain(nominatees)
    .sortBy(
      ({ votes, track: { priority = 0 }}) => -(votes + priority),
      b => (b.track.lastRequestTime || 0)
    )
    .map(peek => '> ' + previewTrack(peek))
    .join('\n')
    .value();

  const message = await reply(interaction, {
    content: joinStrings([
      getTimeout(),
      createMessageContent(),
    ]),
    components: [
      new ActionRowBuilder<MessageActionRowComponentBuilder>()
      .addComponents(new ButtonBuilder()
      .setCustomId('vote:end')
      .setLabel('End')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🏁')),
    ],
    embeds: [
      new EmbedBuilder()
        .setTitle('Vote')
        .setColor('Random')
        .setDescription('Click on a reaction emoji to vote for that song')
    ],
    fetchReply: true
  });

  // Add reactions
  if (message instanceof Message) {
    const msg = message;

    guildVoteMessage.set(guildId, msg);

    function updateMessage() {
      reactionCollector.resetTimer({ time: ttl });

      msg.edit({
        content: joinStrings([
          getTimeout(),
          createMessageContent(),
        ])
      })
    }

    const handleCollect = (reaction: MessageReaction) => {
      const { emoji, count } = reaction;

      if (emoji.name) {
        const nominatee = emojiToNominateeMap.get(emoji.name);

        if (nominatee) {
          nominatee.votes = count - 1;
          updateMessage();
        }
      }
    }

    const handleNewRequest = async (peek: TrackPeek<StationRequestedTrack>) => {
      if (nominatees.length >= 20) {
        // Discord allows 20 reactions per message
        return;
      }

      const emoji = collectibleEmojis[nominatees.length];
      const nominatee: Nominatee = {
        ...peek,
        banner: getTrackBanner(peek.track),
        votes: 0,
        emoji
      }

      nominatees.push(nominatee);
      emojiToNominateeMap.set(emoji, nominatee);

      updateMessage();
      await msg.react(emoji);
    }

    station.on('requestTrackAdded', handleNewRequest);

    const componentCollector = message.createMessageComponentCollector({ dispose: true, time: ttl });

    componentCollector.on('collect', async (collected) => {
      const { customId, user } = collected;

      if (user.id !== issuer) {
        collected.reply({
          content: `Sorry, Only ${formatMention('user', issuer)} can end this vote`,
          ephemeral: true
        });
        return;
      }

      // End button
      if (customId === 'vote:end') {
        reactionCollector.stop('end');
        return;
      }
    });

    const reactionCollector = message.createReactionCollector({
      dispose: true,
      time: ttl
    });

    for (const emoji of take(collectibleEmojis, peekings.length)) {
      await message.react(emoji!);
    }

    reactionCollector.on('collect', handleCollect);
    reactionCollector.on('remove', handleCollect);
    reactionCollector.on('end', async (collected, reason) => {
      console.log('Reaction colelctor on end', reason);
      try {
        station.off('requestTrackAdded', handleNewRequest);
        guildVoteMessage.delete(guildId);

        const peeks = station.peekRequests(0, nominatees.length);
        const requestsKeyed = keyBy(peeks, n => n.track.rid);

        let contributors: string[] = [];

        for (const nom of nominatees) {
          const request = requestsKeyed[nom.track.rid];
          if (request) {
            const { priority = 0 } = request.track;
            request.track.priority = priority + nom.votes;
            //
            const reaction = collected.get(nom.emoji);
            if (reaction) {
              const { users } = reaction;
              const userIds = [...users.cache.keys()];

              contributors = contributors.concat(userIds);

              request.track.requestedBy = chain(request.track.requestedBy)
                .concat(userIds.map(id => makeAudience(AudienceType.Discord, { automatonId: automaton.id, guildId }, id)))
                .uniqWith(isEqual)
                .reject(audience => audience.id === automaton.client.user!.id)
                .value();
            }
          }
        }

        station.sortRequests();

        const preview = await makeRequestPreview(station, 0, undefined, nominatees.length) || [];
        const contributorMentions = chain(contributors)
          .uniq()
          .without(automaton.client.user!.id)
          .map(id => formatMention('user', id))
          .value();

        const embed = new EmbedBuilder()
          .setTitle('Vote Results')
          .setColor('Random');

        if (contributorMentions.length) {
          embed.addFields({ name: 'Contributed by', value: contributorMentions.join(' ')});
        }

        await msg.reply({
          embeds: [
            embed
          ],
          content: preview.join('\n')
        });

        componentCollector.stop();

        if (msg.deletable) {
          await msg.delete();
        }
      }
      finally {
        station.unlockRequests(interaction.guildId);
      }
    });
  }
}

const previewTrack = ({ banner, emoji }: Nominatee) => `${emoji}   ${banner}`;

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;
