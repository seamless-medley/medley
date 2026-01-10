import { Box, Flex } from "@mantine/core";
import { times } from "lodash";
import { PlayDeck } from "@ui/pages/dj/components/PlayDeck";
import { useParams } from "@tanstack/react-router";

export const DJConsolePage = () => {
  const { station: stationId } = useParams({ strict: false });

  return (
    <Flex justify="center" align="center" direction={{ base: 'column', lg: 'row' }} m={1}>
      {times(3).map(index => (
        <Box
          key={index}
          miw='300px'
          maw='500px'
          w={{
            lg: '500px'
          }}
          flex={{
            lg: '1 1 33.33%'
          }}
        >
          <PlayDeck {...{ stationId, index }} />
        </Box>
      ))}
    </Flex>
  )
}
