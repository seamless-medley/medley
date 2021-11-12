import { Command, CommandType } from "./type";
import join from "./join";

const commands = [
  join
]

const payload: Command = {
  name: 'medley',
  description: 'Medley',
  type: CommandType.ChatInput,
  options: commands
}

export default payload;
