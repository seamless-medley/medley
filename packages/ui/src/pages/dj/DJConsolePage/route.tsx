import { createFileRoute, notFound } from '@tanstack/react-router';
import { DJConsolePage as component } from './DJConsolePage';
import { client } from '@ui/init';

export const Route = createFileRoute('/_layout/dj/_dj-layout/$station/')({
  component,
  loader: ({ params }) => client.remoteGet('station', params.station, 0, 'id').catch(notFound),
  notFoundComponent: () => (
    <>
      No such station
    </>
  )
});

export const DJConsoleRoute = Route;
