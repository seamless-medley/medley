import { useEffect, useState } from "react";
import { useCollection } from "../../hooks/useCollection";
import type { Track } from "@seamless-medley/remote";
import { collectionRoute, stationRoute } from "./route";

const CollectionList: React.FC = () => {
  const stationId = stationRoute.useParams({ select: ({ station }) => station });
  const id = collectionRoute.useParams({ select: ({ collectionId }) => collectionId });

  const { collection } = useCollection(`${stationId}/${id}`);
  const [items, setItems] = useState<Track[]>([]);

  const refresh = () => {
    collection?.all().then(setItems);
  }

  const handleShift = (track: Track) => {
    setItems(([, ...rest]) => rest);
  }

  const handlePush = (track: Track) => {
    setItems(prev => [...prev, track]);
  }

  console.log(collection);

  useEffect(() => {
    if (!collection) {
      return;
    }

    refresh();

    collection.on('refresh', refresh);
    collection.on('trackShift', handleShift);
    collection.on('trackPush', handlePush);
    // TODO: Handle other events

    return () => {
      collection.off('refresh', refresh);
      collection.off('trackShift', handleShift);
      collection.off('trackPush', handlePush);
    }
  }, [collection]);

  return (
    <>
      {items.map((item, index) => <div key={item.id}>{item.path}</div>)}
    </>
  )
}

export default CollectionList;
