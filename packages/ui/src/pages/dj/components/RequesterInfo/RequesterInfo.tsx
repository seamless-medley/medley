import { Group, Tooltip } from "@mantine/core";
import { Requester } from "@seamless-medley/remote";
import { CORSImage } from "@ui/components/CORSImage";
import classes from './RequesterInfo.module.css';

export const RequesterInfo: React.FC<{ requester: Requester }>  = ({ requester }) => {
  return (
    <Group className={classes.avatarBox}>
      {requester.type === 'discord' && requester.data !== undefined
        ? <Tooltip withArrow label={`Discord user ${requester.data.displayName} via ${requester.data.guild.name}`} style={{ fontSize: '0.7em'}}>
          {requester.data?.avatar
            ? <CORSImage className={classes.avatar} src={requester.data.avatar} />
            : <div className={classes.dummyAvatar} />
          }
          </Tooltip>
        :
          <Tooltip withArrow label={`${requester.requesterId} via ${requester.type} (${requester.group})`}>
            <div className={classes.dummyAvatar} />
          </Tooltip>
      }
    </Group>
  )
}
