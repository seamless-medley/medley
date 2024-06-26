import { times } from "lodash";
import { styled } from "@linaria/react";
import { stationRoute } from "./route";
import { PlayDeck } from "../../components";
import { Flex } from "@mantine/core";

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

export const Index: React.FC = () => {
  const stationId = stationRoute.useParams({ select: ({ station }) => station  });

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

export default Index;
