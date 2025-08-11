import { createFileRoute } from "@tanstack/react-router";
import { HomePage as component } from "./HomePage";

export const Route = createFileRoute('/')({ component });

export const HomeRoute = Route;
