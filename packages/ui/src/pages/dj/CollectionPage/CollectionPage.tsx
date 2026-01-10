import { Box, Group } from "@mantine/core";
import { useParams } from "@tanstack/react-router";
import { useCollection } from "@ui/hooks/useCollection";
import { useRemotableProp } from "@ui/hooks/remotable";
import { CollectionTracks } from "../components/CollectionTracks";
import classes from './CollectionPage.module.css';

export const CollectionPage = () => {
  const { station, collectionId } = useParams({ strict: false });
  const { collection } = useCollection(station, collectionId);
  const description = useRemotableProp(collection, 'description') ?? collectionId;
  const length = useRemotableProp(collection, 'length', 0);

  return (
    <Box className={classes.container}>
      <Group className={classes.header} mx='md'>
        <h2>{description} - {length} tracks</h2>
      </Group>

      <CollectionTracks collection={collection} />
    </Box>
  )
}
