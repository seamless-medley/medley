import { Command, CommandType } from "./type";
import join from "./commands/join";
import volume from "./volume";
import skip from './commands/skip';
import request from './commands/request';

const commands = [
  join,
  volume,
  ...skip,
  request
];

export const createCommand = (name: string = 'medley', description: string = 'Medley'): Command => ({
  name,
  description,
  type: CommandType.ChatInput,
  options: commands
})