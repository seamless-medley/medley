import { AppShell, Group, Title, Button, ThemeIcon } from '@mantine/core';
import { IconMusic, IconMicrophone } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useSurrogate } from '@ui/hooks/surrogate';
import { useRemotableProps } from '@ui/hooks/remotable';

interface NavBarProps {
  onDJModeClick: () => void;
}

export function NavBar({ onDJModeClick }: NavBarProps) {
  const { surrogate: $global } = useSurrogate('global', '$');
  const $globalProps = useRemotableProps($global);

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
                {$globalProps?.instanceName || 'Medley'}
              </Title>
            </Group>
          </Link>
        </Group>

        {/* DJ Mode Button */}
        <Button
          variant="gradient"
          gradient={{ from: 'pink', to: 'violet', deg: 45 }}
          leftSection={<IconMicrophone size={16} />}
          onClick={onDJModeClick}
          radius="md"
        >
          DJ Mode
        </Button>
      </Group>
    </AppShell.Header>
  );
}
