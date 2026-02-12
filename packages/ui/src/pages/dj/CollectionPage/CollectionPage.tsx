import { Box, Group, NumberFormatter, Title } from "@mantine/core";
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
      <Group className={classes.header} m='md'>
        <Title order={2}>{description} - <NumberFormatter thousandSeparator value={length}/> tracks</Title>
      </Group>

      <CollectionTracks collection={collection} />
    </Box>
  )
}
