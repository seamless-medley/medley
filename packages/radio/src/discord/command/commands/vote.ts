import { Audience, AudienceType, createLogger, getTrackBanner, makeAudience, RequestTrackLockPredicate, StationRequestedTrack, TrackPeek } from "@seamless-medley/core";
import { CommandInteraction, Message, EmbedBuilder, MessageReaction, ActionRowBuilder, MessageActionRowComponentBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, MessageComponentInteraction, PermissionsBitField, } from "discord.js";
import { chain, isEqual, keyBy, noop, sampleSize, take, without } from "lodash";
import { MedleyAutomaton } from "../../automaton";
import * as emojis from "../../emojis";
import { CommandDescriptor, GuildHandlerFactory, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
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

const logger = createLogger({ name: 'command/vote' });

const guildVoteMessage = new Map<string, Message>();

export const getVoteMessage = (guildId: string) => guildVoteMessage.get(guildId);

const distinguishableEmojis = without(emojis.distinguishable, '🏁');

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = automaton => interaction => handleVoteCommand(automaton, interaction);

const createButtonHandler: InteractionHandlerFactory<ButtonInteraction> = automaton => interaction => handleVoteCommand(automaton, interaction);

const onGuildDelete: GuildHandlerFactory = () => async guild => {
  guildVoteMessage.delete(guild.id);
}

async function handleVoteCommand(automaton: MedleyAutomaton, interaction: CommandInteraction | MessageComponentInteraction) {
  const { guildId, station } = guildStationGuard(automaton, interaction);

  if (!interaction.appPermissions?.any([PermissionsBitField.Flags.AddReactions])) {
    warn(interaction, 'Voting requires `AddReactions` permission for the bot');
    return;
  }

  const existingVote = guildVoteMessage.get(guildId);
  if (existingVote) {
    warn(interaction, 'Vote is currently on-going');
    return;
  }

  const peeking = take(station
    .peekRequests(0, Math.min(distinguishableEmojis.length, station.requestsCount))
    .filter(({ track }) => track.requestedBy.some(({ type, group }) => (type === AudienceType.Discord) && (group.guildId === guildId))),
    20
  );

  if (peeking.length <= 1) {
    warn(interaction, 'Nothing to vote')
    return;
  }

  const issuer = interaction.user.id;

  const collectibleEmojis = sampleSize(distinguishableEmojis, distinguishableEmojis.length);

  const nominatees = peeking.map<Nominatee>((p, i) => ({
    ...p,
    banner: getTrackBanner(p.track),
    votes: 0,
    voters: [],
    emoji: collectibleEmojis[i]
  }));

  const emojiToNominateeMap = new Map(
    nominatees.map(n => [n.emoji, n])
  );

  const requestLock: RequestTrackLockPredicate<Audience> = (t) => nominatees.some(n => n.track.rid === t.rid);

  station.lockRequests(requestLock);
  try {

    const ttl = 90_000;

    const getTimeout = () => `Vote Timeout: <t:${Math.trunc((Date.now() + ttl) / 1000)}:R>`;

    const createMessageContent = () => chain(nominatees)
      .sortBy(
        ({ votes, track: { priority = 0 }}) => -(votes + priority),
        b => (b.track.firstRequestTime || 0)
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
        .setCustomId('vote_end')
        .setLabel('End')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🏁')),
      ],
      embeds: [
        new EmbedBuilder()
          .setTitle('Vote')
          .setColor('Random')
          .setDescription('Click on a reaction emoji to vote for that track')
          .setFooter({
            text: 'These tracks will not be played during this vote session'
          })
      ],
      fetchReply: true
    });

    // Add reactions
    if (message instanceof Message) {
      const msg = message;

      guildVoteMessage.set(guildId, msg);

      function updateMessage() {
        reactionCollector.resetTimer({ time: ttl });
        componentCollector.resetTimer({ time: ttl });

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

      const handleRemovedRequests = async (tracks: StationRequestedTrack[]) => {
        let updated = false;

        for (const t of tracks) {
          const index = nominatees.findIndex(n => n.track.rid === t.rid);

          if (index > -1) {
            const n = nominatees[index];
            nominatees.splice(index, 1);
            emojiToNominateeMap.delete(n.emoji);

            msg.reactions.cache.get(n.emoji)?.remove().catch(noop);

            updated = true;
          }
        }

        if (updated) {
          if (nominatees.length < 1) {
            reactionCollector.stop();
          } else {
            updateMessage();
          }
        }
      }

      station.on('requestTrackAdded', handleNewRequest);
      station.on('requestTracksRemoved', handleRemovedRequests);

      const componentCollector = msg.createMessageComponentCollector({ dispose: true, time: ttl });

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
        if (customId === 'vote_end') {
          reactionCollector.stop('interaction');
          return;
        }
      });

      const reactionCollector = msg.createReactionCollector({
        dispose: true,
        time: ttl
      });

      // TODO: Move below event registration
      for (const emoji of take(collectibleEmojis, peeking.length)) {
        await msg.react(emoji!).catch(noop);
      }

      reactionCollector.on('collect', handleCollect);
      reactionCollector.on('remove', handleCollect);
      reactionCollector.on('end', async (collected, reason) => {
        try {
          station.off('requestTrackAdded', handleNewRequest);
          station.off('requestTracksRemoved', handleRemovedRequests);

          guildVoteMessage.delete(guildId);

          if (nominatees.length < 1) {
            if (msg.deletable) {
              await msg.delete();
            }

            return;
          }

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

          const preview = await makeRequestPreview(station, { count: nominatees.length, guildId }) || [];
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
            content: joinStrings(preview)
          });

          componentCollector.stop();

          if (msg.deletable) {
            await msg.delete();
          }
        }
        finally {
          station.unlockRequests(requestLock);
        }
      });
    }
  }
  catch(e) {
    logger.error(e);
    station.unlockRequests(requestLock);
  }
}

const previewTrack = ({ banner, emoji }: Nominatee) => `${emoji}   ${banner}`;

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler,
  createButtonHandler,
  createOnGuildDeleteHandler: onGuildDelete
}

export default descriptor;
