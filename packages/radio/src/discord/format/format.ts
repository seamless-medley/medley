import { channelMention, roleMention, userMention } from "discord.js";

export type MentionType = 'user' | 'channel' | 'role';

export const formatMention = (type: MentionType, id: string) => {
  const p = ({ user: userMention, channel: channelMention, role: roleMention })[type];
  return p(id);
}
