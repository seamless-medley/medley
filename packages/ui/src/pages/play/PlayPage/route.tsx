import { createFileRoute } from "@tanstack/react-router";

import { PlayPage as component } from './PlayPage';

export const Route = createFileRoute('/_normal-layout/play/$station')({ component });

export const PlayRoute = Route;
