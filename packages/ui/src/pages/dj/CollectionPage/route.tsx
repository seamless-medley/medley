import { createFileRoute } from "@tanstack/react-router";
import { CollectionPage } from "./CollectionPage";

export const Route = createFileRoute('/_layout/dj/_dj-layout/$station/collection/$collectionId')({
  component: CollectionPage
});

export const CollectionRoute = Route;
