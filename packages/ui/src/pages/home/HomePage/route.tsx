import { createFileRoute } from "@tanstack/react-router";
import { HomePage as component } from "./HomePage";

export const Route = createFileRoute('/_normal-layout/')({ component });

export const HomeRoute = Route;
