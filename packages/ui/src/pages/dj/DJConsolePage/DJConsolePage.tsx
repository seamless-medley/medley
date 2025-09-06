import { Flex } from "@mantine/core";
import { styled } from "@linaria/react";
import { times } from "lodash";
import { PlayDeck } from "@ui/pages/dj/components/PlayDeck";
import { Route } from "./route"
import { useParams } from "@tanstack/react-router";

const Container = styled.div`
  display: flex;
  flex-wrap: wrap;
  margin: 1em;

  @media (max-width: 1184px) {
    flex-direction: column;
  }
`;

const DeckBox = styled.div`
  min-width: 300px;
  max-width: 500px;

  @media (min-width: 1184px) {
    flex: 1 1 33.33%;
    width: 500px;
  }
`

export const DJConsolePage = () => {
  const { station: stationId } = useParams({ strict: false });

  return (
    <Flex justify="center">
      <Container>
        {times(3).map(index => (
          <DeckBox key={index}>
            <PlayDeck {...{ stationId, index }} />
          </DeckBox>
        ))}
      </Container>
    </Flex>
  )
}
