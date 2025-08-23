import { AppShell, Group, Title, Button, ThemeIcon, Popover, Box, TextInput, PasswordInput, Stack, Avatar } from '@mantine/core';
import { IconMusic, IconVinyl } from '@tabler/icons-react';
import { useForm } from '@tanstack/react-form';
import { Link } from '@tanstack/react-router';
import { useSession } from '@ui/hooks/useClient';
import { client } from '@ui/init';
import { useCallback, useState } from 'react';

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
          DJ Console
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

export function NavBar() {
  const { user } = useSession();

  return (
    <AppShell.Header>
      <Group h="100%" px="md" justify="space-between">
        {/* Brand */}
        <Group align="center" gap="sm">
          <Link to="/" style={{ textDecoration: 'none' }}>
            <Group align="center" gap="sm">
              <ThemeIcon
                size="lg"
                radius="md"
                variant="gradient"
                gradient={{ from: 'pink', to: 'violet', deg: 45 }}
              >
                <IconMusic size={20} />
              </ThemeIcon>
              <Title
                size="h3"
                fw={700}
                variant="gradient"
              >
                Medley
              </Title>
            </Group>
          </Link>
        </Group>

        { user
          ? <Avatar name={user} color='initials' />
          : <LoginButton />
        }
      </Group>
    </AppShell.Header>
  );
}
