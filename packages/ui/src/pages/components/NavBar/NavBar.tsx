import { useCallback, useState } from 'react';
import { Group, Title, Button, Popover, Box, TextInput, PasswordInput, Stack, Avatar, Image, Text, Flex, rem } from '@mantine/core';
import { IconVinyl } from '@tabler/icons-react';
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { usePlayingStationId, useSession } from '@ui/hooks/useClient';
import { client } from '@ui/init';
import logo from '@ui/logo.png';
import { useStation } from '@ui/hooks/useStation';
import { useRemotableProp } from '@ui/hooks/remotable';
import { useDeckCover, useDeckInfo } from '@ui/hooks/useDeck';
import { AnimatePresence, motion } from 'motion/react';
import { TransitionText } from '@ui/components/TransitionText';
import { PlayHeadText } from '@ui/components/PlayHeadText';
import { VUBar } from '@ui/components/VUBar';
import classes from './NavBar.module.css';

const LoginButton = () => {
  const [opened, setOpened] = useState(false);
  const toggleOpen = useCallback(() => setOpened(o => !o), []);

  const form = useForm({
    defaultValues: {
      username: '',
      password: ''
    },
    onSubmit: async (e) => {
      client.authenticate(e.value.username, e.value.password);
      e.formApi.reset();
      setOpened(false);
    }
  });

  return (
    <Popover
      opened={opened}
      withArrow arrowSize={16}
      offset={{ mainAxis: 20, crossAxis: -80 }}
    >
      <Popover.Target>
        <Button
          variant="gradient"
          gradient={{ from: 'pink', to: 'violet', deg: 45 }}
          leftSection={<IconVinyl strokeWidth={1} />}
          radius="md"
          onClick={toggleOpen}
        >
          <Text>Login</Text>
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <form onSubmit={e => (e.preventDefault(), form.handleSubmit())}>
          <Stack w={'16rem'}>
            <form.Field
              name='username'
              children={(field) => (
                <TextInput
                  label='Username'
                  defaultValue={field.state.value}
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              )}
            />

            <form.Field
              name='password'
              children={(field) => (
                <PasswordInput
                  label='Password'
                  onChange={e => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              )}
            />

            <Button type='submit' variant='gradient'>Login</Button>
          </Stack>
        </form>

      </Popover.Dropdown>
    </Popover>
  )
}

function HomeLogo() {
  return (
    <Group align="center" gap="sm">
      <Link to="/" style={{ textDecoration: 'none' }}>
        <Group align="center" gap="xs" wrap='nowrap'>
          <Image src={logo} h={65} w="auto" fit="contain" />
          <Title
            size="h3"
            fw={700}
            mt={-6}
          >
            Medley
          </Title>
        </Group>
      </Link>
    </Group>
  )
}

function PlaybackInfo() {
  const stationId = usePlayingStationId();
  const { station } = useStation(stationId);
  const name = useRemotableProp(station, 'name');
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const info = useDeckInfo(stationId, activeDeck, 'trackPlay');
  const { cover } = useDeckCover(stationId, activeDeck);
  const { trackPlay } = useDeckInfo(stationId, activeDeck, 'trackPlay');

  const title = trackPlay?.track?.extra?.tags?.title;
  const artist = trackPlay?.track?.extra?.tags?.artist;

  return (
    <Group className={classes.playback}>
      <Box
        component={motion.div}
        className={classes.imageBox}
        whileHover={{
          scale: 5,
          boxShadow: '0px 0px 34px 0px var(--mantine-color-dark-9)',
          transition: { duration: 0.4, delay: 0.2  }
        }}
      >
        <AnimatePresence mode="wait">
          <Image component={motion.img}
            key={info.trackPlay?.uuid}
            src={cover}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            fallbackSrc="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100' viewBox='-50 -50 100 100'><style>text{ font-family: sans-serif }</style><rect x='-50' y='-50' width='200%' height='200%' fill='%23555' /><text x='-35' y='5'>No Image</text></svg>"
          />
        </AnimatePresence>
      </Box>

      <Stack className={classes.info} gap={0}>
        <TransitionText size='1.2em' fw={700}>
          {name ?? 'No station'}
        </TransitionText>
        <TransitionText
          size="1em"
          truncate="end"
          fw={500}
          transition={{ delay: 0.4 }}
          nowrap
        >
          {title ?? 'Unknown title'}
        </TransitionText>
        <TransitionText
          size="1em"
          truncate="end"
          transition={{ delay: 0.5 }}
          nowrap
        >
          {artist ?? 'Unknown artist'}
        </TransitionText>
        <PlayHeadText
          stationId={stationId}
          deckIndex={activeDeck}
          size='1em'
          c='indigo.4'
        />
      </Stack>
    </Group>
  )
}

export function NavBar() {
  const { user } = useSession();

  return (
    <Flex component='header' className={classes.navbar}>
      <Group className={classes.leftPane}>
        <Group wrap='nowrap' gap='sm'>
          <HomeLogo />
          <Stack w={100}>
            <VUBar orientation='horizontal' size={8} gap={2} />
          </Stack>
        </Group>

        <PlaybackInfo />
      </Group>

      {/* <Flex className={classes.rightPane}>
        { user
          ? <Avatar name={user} color='initials' />
          : <LoginButton />
        }
      </Flex> */}
    </Flex>
  );
}
