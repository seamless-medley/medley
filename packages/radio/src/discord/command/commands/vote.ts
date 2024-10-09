import { createLogger } from "@seamless-medley/logging";
import { Requester, AudienceType, getTrackBanner, makeRequester, RequestTrackLockPredicate, StationRequestedTrack, TrackIndex } from "@seamless-medley/core";
import { CommandInteraction, Message, EmbedBuilder, MessageReaction, ActionRowBuilder, MessageActionRowComponentBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, MessageComponentInteraction, PermissionsBitField, userMention, time as formatTime, quote, } from "discord.js";
import { chain, isEqual, keyBy, noop, sampleSize, take, without } from "lodash";
import { MedleyAutomaton } from "../../automaton";
import * as emojis from "../../helpers/emojis";
import { CommandDescriptor, GuildHandlerFactory, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import { guildStationGuard, isTrackRequestedFromGuild, joinStrings, makeRequestPreview, reply, warn } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'vote',
  description: 'Vote for songs'
}

type Nominatee = StationRequestedTrack & {
  banner: string;
  votes: number;
  emoji: string;
}

const logger = createLogger({ name: 'command', id: 'vote' });

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

  const requests = take(
    station.allRequests.filter(track => isTrackRequestedFromGuild(track, guildId)),
    20
  );

  if (requests.length <= 1) {
    warn(interaction, 'Nothing to vote')
    return;
  }

  const issuer = interaction.user.id;

  const collectibleEmojis = sampleSize(distinguishableEmojis, distinguishableEmojis.length);

  const nominatees = requests.map<Nominatee>((track, i) => ({
    ...track,
    banner: getTrackBanner(track),
    votes: 0,
    voters: [],
    emoji: collectibleEmojis[i]
  }));

  const emojiToNominateeMap = new Map(
    nominatees.map(n => [n.emoji, n])
  );

  const requestLock: RequestTrackLockPredicate<Requester> = (t) => nominatees.some(track => track.rid === t.rid);

  station.lockRequests(requestLock);
  try {

    const ttl = 90_000;

    const getTimeout = () => `Vote Timeout: ${formatTime(Math.trunc((Date.now() + ttl) / 1000), 'R')}`;

    const createMessageContent = () => chain(nominatees)
      .sortBy(
        ({ votes, priority = 0 }) => -(votes + priority),
        track => (track.firstRequestTime || 0)
      )
      .map(peek => quote(previewTrack(peek)))
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

      const handleNewRequest = async (peek: TrackIndex<StationRequestedTrack>) => {
        if (nominatees.length >= 20) {
          // Discord allows 20 reactions per message
          return;
        }

        const emoji = collectibleEmojis[nominatees.length];
        const nominatee: Nominatee = {
          ...peek.track,
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
          const index = nominatees.findIndex(track => track.rid === t.rid);

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
            content: `Sorry, Only ${userMention(issuer)} can end this vote`,
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

          const requests = station.allRequests.filter(track => isTrackRequestedFromGuild(track, guildId));

          const requestsKeyed = keyBy(requests, track => track.rid);

          let contributors: string[] = [];

          for (const nom of nominatees) {
            const request = requestsKeyed[nom.rid];
            if (request) {
              const { priority = 0 } = request;
              request.priority = priority + nom.votes;
              //
              const reaction = collected.get(nom.emoji);
              if (reaction) {
                const { users } = reaction;
                const userIds = [...users.cache.keys()];

                contributors = contributors.concat(userIds);

                request.requestedBy = chain(request.requestedBy)
                  .concat(userIds.map(id => makeRequester(AudienceType.Discord, { automatonId: automaton.id, guildId }, id)))
                  .uniqWith(isEqual)
                  .reject(audience => audience.requesterId === automaton.client.user!.id)
                  .value();
              }
            }
          }

          station.sortRequests(true);

          const preview = await makeRequestPreview(station, { count: nominatees.length, guildId }) || [];
          const contributorMentions = chain(contributors)
            .uniq()
            .without(automaton.client.user!.id)
            .map(userMention)
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

      for (const emoji of take(collectibleEmojis, requests.length)) {
        await msg.react(emoji!).catch(noop);
      }
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
