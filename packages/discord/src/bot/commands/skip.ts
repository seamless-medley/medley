import { OptionType, SubCommandLikeOption } from "./type";

const skip: SubCommandLikeOption = {
  type: OptionType.SubCommand,
  name: 'skip',
  description: 'Skip to the next track'
}

const next = {
  ...skip,
  name: 'next'
}

export default [skip, next];