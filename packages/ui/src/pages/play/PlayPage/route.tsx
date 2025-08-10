import { createFileRoute } from "@tanstack/react-router";

import { Play as component } from './PlayPage';

export const Route = createFileRoute('/play/_play-layout/$station')({ component });

export const PlayRoute = Route;
