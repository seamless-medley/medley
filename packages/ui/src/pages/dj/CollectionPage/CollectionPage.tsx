import { Box, Group } from "@mantine/core";
import { styled } from "@linaria/react";
import { useParams } from "@tanstack/react-router";
import { useCollection } from "@ui/hooks/useCollection";
import { useRemotableProp } from "@ui/hooks/remotable";
import { CollectionTracks } from "../components/CollectionTracks";

const Container = styled(Box)`
  display: flex;
  flex-direction: column;
  height: calc(100vh - 60px - 200px); // Viewport minus AppShell header minus TopBar
`;

const Header = styled(Group)`
  flex-shrink: 0; // Prevent shrinking
  justify-content: space-between;
`;

export const CollectionPage = () => {
  const { station, collectionId } = useParams({ strict: false });
  const { collection } = useCollection(station, collectionId);
  const description = useRemotableProp(collection, 'description') ?? collectionId;
  const length = useRemotableProp(collection, 'length', 0);

  return (
    <Container>
      <Header mx='md'>
        <h2>{description} - {length} tracks</h2>
      </Header>

      <CollectionTracks collection={collection} />
    </Container>
  )
}
