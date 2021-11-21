import { CommandInteraction, Message, MessageEmbed, MessageReaction, User } from "discord.js";
import { CommandDescriptor, InteractionHandlerFactory, OptionType, SubCommandLikeOption } from "../type";
import * as emojis from "../../emojis";
import { chain, take, sampleSize, zip, maxBy, padStart, padEnd, keyBy, without, uniq } from "lodash";
import { getTrackBanner, RequestTrack, TrackPeek } from "@medley/core";
import { makeRequestPreview, reply, warn } from "../utils";

const declaration: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'vote',
  description: 'Vote for songs'
}

type Nominatee = TrackPeek<RequestTrack<string>> & {
  banner: string;
  votes: number,
  emoji: string;
}

const guildVoteMessage: Map<string, Message> = new Map();

const createCommandHandler: InteractionHandlerFactory<CommandInteraction> = (automaton) => async (interaction) => {
  const { dj } = automaton;

  const exisingVote = guildVoteMessage.get(interaction.guildId);
  if (exisingVote) {
    warn(interaction, 'Vote is currently ongoing');
    return;
  }

  const count = Math.min(emojis.distinguishable.length, dj.requestsCount, 20);
  const peekings = dj.peekRequests(0, count);

  if (peekings.length <= 1) {
    warn(interaction, 'Nothing to vote')
    return;
  }

  const collectibleEmojis = sampleSize(emojis.distinguishable, emojis.distinguishable.length);

  const nominatees = peekings.map<Nominatee>((p, i) => ({
    ...p,
    banner: getTrackBanner(p.track),
    votes: 0,
    emoji: collectibleEmojis[i]
  }));

  const emojiToNominateeMap = new Map(
    nominatees.map(n => [n.emoji, n])
  );

  dj.requestsEnabled = false;

  const createMessageContent = () =>
    chain(nominatees)
      .sortBy(
        ({ votes, track: { priority = 0 }}) => -(votes + priority),
        b => (b.track.lastRequestTime || 0)
      )
      .map(peek => previewTrack(peek))
      .join('\n')
      .value();


  const message = await interaction.reply({
    content: createMessageContent(),
    embeds: [
      new MessageEmbed()
        .setTitle('Vote')
        .setColor('RANDOM')
        .setDescription('Click on a reaction emoji to vote for that song')
    ],
    fetchReply: true
  });

  // Add reactions
  if (message instanceof Message) {
    const msg = message;

    guildVoteMessage.set(interaction.guildId, msg);

    function updateMessage() {
      msg.edit({
        content: createMessageContent()
      })
    }

    const handleCollect = ({ emoji, count }: MessageReaction) => {
      if (emoji.name) {
        const nominatee = emojiToNominateeMap.get(emoji.name);
        if (nominatee) {
          nominatee.votes = count - 1;
          updateMessage();
        }
      }
    }

    const handleNewRequest = async (peek: TrackPeek<RequestTrack<User['id']>>) => {
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

    automaton.dj.on('requestTrackAdded', handleNewRequest);

    const collector = message.createReactionCollector({
      dispose: true,
      time: 30_000 // TODO: from option + peekings.length in seconds
    });

    for (const emoji of take(collectibleEmojis, peekings.length)) {
      await message.react(emoji!);
    }

    collector.on('collect', handleCollect);
    collector.on('remove', handleCollect);
    collector.on('end', async (collected) => {
      automaton.dj.off('requestTrackAdded', handleNewRequest);
      guildVoteMessage.delete(interaction.guildId);

      const peeks = dj.peekRequests(0, nominatees.length);
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
              .concat(userIds)
              .uniq()
              .without(automaton.client.user!.id)
              .value();
          }
        }
      }

      automaton.dj.sortRequests();

      const preview = await makeRequestPreview(automaton, 0, undefined, nominatees.length) || [];
      const contributorMentions = chain(contributors)
        .uniq()
        .without(automaton.client.user!.id)
        .map(id => `<@${id}>`)
        .value();

      const embed = new MessageEmbed()
        .setTitle('Vote Results')
        .setColor('RANDOM');

      if (contributorMentions.length) {
        embed.addField('Contributed by', contributorMentions.join(' '))
      }

      await msg.reply({
        embeds: [
          embed
        ],
        content: preview.join('\n')
      });

      await msg.delete();

      dj.requestsEnabled = true;
    })
  }
}

const previewTrack = ({ banner, emoji }: Nominatee) => `${emoji}   ${banner}`;

const descriptor: CommandDescriptor = {
  declaration,
  createCommandHandler
}

export default descriptor;