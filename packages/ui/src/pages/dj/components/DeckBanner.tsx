import React from "react";
import { Box, Text } from "@mantine/core";
import type { DeckIndex } from "@seamless-medley/medley";

export const DeckBanner: React.FC<{ deckIndex: DeckIndex, align?: 'start' | 'center' | 'end', bg?: string }> = React.memo(({ deckIndex, align = 'center', bg }) => (
  <Box
    c='white'
    h="100%"
    w="100%"
    bg={bg ?? 'linear-gradient(to bottom, #fc466b, #3f5efb)'}
    style={{
      writingMode: 'vertical-lr',
      userSelect: 'none',
      textAlign: align,
      alignContent: 'center',
      textTransform: 'uppercase',
      fontWeight: 'bold',
      transition: 'background 0.6s ease'
    }}
  >
    <Text display="inline-block" fw="bold">
      Deck {deckIndex !== undefined ? deckIndex + 1 : '?'}
    </Text>
  </Box>
));
