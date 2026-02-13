import { CSSProperties, PointerEvent, useCallback, useRef, useState } from 'react';
import { Group, Title, Button, Popover, Box, TextInput, PasswordInput, Stack, Avatar, Image, Text, Flex, useMatches } from '@mantine/core';
import { useMove, UseMovePosition } from '@mantine/hooks';
import { IconVinyl, IconVolume, IconVolume2 } from '@tabler/icons-react';
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { AnimatePresence, motion } from 'motion/react';
import clsx from 'clsx';
import { clamp } from 'lodash';

import { usePlayingStationId, useSession } from '@ui/hooks/useClient';
import { client } from '@ui/init';
import logo from '@ui/logo.png';
import { useStation } from '@ui/hooks/useStation';
import { useRemotableProp } from '@ui/hooks/remotable';
import { useDeckCover, useDeckInfo } from '@ui/hooks/useDeck';
import { useVolume } from '@ui/hooks/useVolume';
import { TransitionText } from '@ui/components/TransitionText';
import { PlayHeadText } from '@ui/components/PlayHeadText';
import { VUBar, VUBarProps } from '@ui/components/VUBar';
import classes from './NavBar.module.css';
import fallbackImage from '@ui/fallback-image.svg?inline';
import { useAudioLevels, UseAudioLevelsData } from '@ui/hooks/useAudioLevels';

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
  const ref = useRef<HTMLImageElement>(null);

  const audioLevelsHandler = useCallback((data: UseAudioLevelsData) => {
    if (!ref.current) return;

    const scale = 1 + clamp((1 - data.reduction) * 5 * client.volume, 0, 0.1);

    ref.current.style.scale = `${scale}`;
  }, []);

  useAudioLevels(audioLevelsHandler, []);

  return (
    <Link to="/">
      <Flex className={classes.logoBox}>
        <Image ref={ref} className={classes.logo} src={logo} />
        <Title component='h1' className={classes.title}>
          Medley
        </Title>
      </Flex>
    </Link>
  )
}

function PlaybackInfo() {
  const stationId = usePlayingStationId();
  const { station } = useStation(stationId);
  const name = useRemotableProp(station, 'name');
  const activeDeck = useRemotableProp(station, 'activeDeck') ?? 0;
  const info = useDeckInfo(stationId, activeDeck, 'trackPlay');
  const { cover, colors } = useDeckCover(stationId, activeDeck, {
    amount: 6,
    sample: 30,
    group: 40,
    getDefaultColors: () => ['black']
  });
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
        style={{ '--colors': [...colors, ...[...colors].reverse()].join(', ') as CSSProperties}}
      >
        <AnimatePresence mode="wait">
          <Image component={motion.img}
            key={info.trackPlay?.uuid}
            src={cover}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            fallbackSrc={fallbackImage}
          />
        </AnimatePresence>
      </Box>

      <Stack className={classes.info}>
        <Flex direction={'column'}>
          <TransitionText size='1.2em' h='1.5em' fw={700} autoscroll>
            {name ?? 'No station'}
          </TransitionText>
          <TransitionText
            size="1em"
            h='1.2em'
            fw={500}
            transition={{ delay: 0.4 }}
            autoscroll
          >
            {title ?? 'Unknown title'}
          </TransitionText>
          <TransitionText
            size="1em"
            h='1.2em'
            transition={{ delay: 0.5 }}
            autoscroll
          >
            {artist ?? 'Unknown artist'}
          </TransitionText>
        </Flex>
        <Flex h='1.2em' align={'center'} mb={4}>
          <PlayHeadText
            stationId={stationId}
            deckIndex={activeDeck}
            size='1em'
            c='indigo.4'
          />
        </Flex>
      </Stack>
    </Group>
  )
}

const VolumeControl: React.FC<{ orientation: 'horizontal' | 'vertical' }> = ({ orientation }) => {
  const compute = useCallback(orientation === 'horizontal'
      ? ({ x }: UseMovePosition) => x
      : ({ y }: UseMovePosition) => 1 - y,
    [orientation]
  );

  const moveHandler = useCallback((e: UseMovePosition) => client.volume = compute(e), [orientation]);

  const decrease = useCallback(() => client.volume -= 0.05, []);
  const increase = useCallback(() => client.volume += 0.05, []);

  type RepeatState = { debounce: any, repeat: any }

  const upState = useRef<RepeatState>({ debounce: 0, repeat: 0 });
  const downState = useRef<RepeatState>({ debounce: 0, repeat: 0 });

  const clearTimers = ({ debounce, repeat }: RepeatState) => {
      clearTimeout(debounce);
      clearInterval(repeat);
  }

  const ptDownHandler = useCallback((state: RepeatState, fn: () => any) => {
    return (e: PointerEvent) => {
      if (e.button !== 0) return;

      e.stopPropagation();
      e.preventDefault();

      clearTimers(state);

      fn();

      state.debounce = setTimeout(() => state.repeat = setInterval(fn, 1000/15), 500);
    }
  }, []);

  const ptUphandler = useCallback((state: RepeatState) => () => clearTimers(state), []);

  const { ref } = useMove(moveHandler);

  const gain = useVolume();

  const isHorizontal = orientation === 'horizontal';

  return (
    <Flex className={clsx(classes.volumeBox, isHorizontal ? classes.horizontal : classes.vertical)}>
      <IconVolume2 size={20} onPointerDown={ptDownHandler(upState.current, decrease)} onPointerUp={ptUphandler(upState.current)} />
      <Box className={clsx(classes.volumeControl, isHorizontal ? classes.horizontal : classes.vertical)} ref={ref} style={{ '--gain': gain }}>
        <div className={classes.range} />
        <div className={classes.thumb} />
      </Box>
      <IconVolume size={20} onPointerDown={ptDownHandler(downState.current, increase)} onPointerUp={ptUphandler(downState.current)} />
    </Flex>
  )
}

export function NavBar() {
  const { user } = useSession();

  const vuBarOrientation = useMatches<VUBarProps['orientation']>({
    base: 'vertical',
    sm: 'horizontal'
  });

  return (
    <Flex component='header' className={classes.navbar}>
      <Group className={clsx(classes.leftPane, vuBarOrientation === 'horizontal' ? classes.horizontal : classes.vertical)}>
        <Group className={classes.brand}>
          <HomeLogo />
          <Flex className={classes.vubox} mod={{ orientation: vuBarOrientation }} gap={5}>
            <VUBar orientation={vuBarOrientation} size={8} gap={2} />
            <VolumeControl orientation={vuBarOrientation} />
          </Flex>
        </Group>
      </Group>

      <PlaybackInfo />

      {/* <Flex className={classes.rightPane}>
        { user
          ? <Avatar name={user} color='initials' />
          : <LoginButton />
        }
      </Flex> */}
    </Flex>
  );
}
