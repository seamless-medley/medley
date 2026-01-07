import { createFileRoute, notFound } from "@tanstack/react-router";

import { PlayPage as component } from './PlayPage';
import { client } from "@ui/init";
import { Alert, Container, Title } from "@mantine/core";

export const Route = createFileRoute('/_normal-layout/play/$station')({
  component,
  loader: ({ params }) => client.remoteGet('station', params.station, 0, 'id').catch(notFound),
  notFoundComponent: () => (
    <Container>
      <Alert variant="filled" color="red.7" radius="lg">
        <Title order={2}>No such station</Title>
      </Alert>
    </Container>
  )
});

export const PlayRoute = Route;
