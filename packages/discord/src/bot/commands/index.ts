import { Command, CommandType } from "./type";
import join from "./join";
import volume from "./volume";
import skip from './skip';

const commands = [
  join,
  volume,
  ...skip
]

const payload: Command = {
  name: 'medley',
  description: 'Medley',
  type: CommandType.ChatInput,
  options: commands
}

export default payload;
