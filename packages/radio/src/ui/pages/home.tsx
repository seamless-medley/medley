import { createRoute, Link } from "@tanstack/react-router";
import { rootRoute } from './rootRoute';
import { playRoute } from './play/route';
import { useSurrogate } from "../hooks/surrogate";
import { StubGlobal } from "../stubs/core/global";
import { useEffect, useState } from "react";
import { stationRoute } from "./dj/route";
import { useRemotableProps } from "../hooks/remotable";

const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => {
    const { surrogate: $global } = useSurrogate(StubGlobal, 'global', '$');
    const $globalProps = useRemotableProps($global);

    const [stations, setStations] = useState<string[]>([]);

    useEffect(() => {
      if (!$global ) {
        return;
      }

      $global.getStations().then(setStations);
    }, [$global]);

    return (
      <div>
        <h2>{$globalProps?.instanceName}</h2>

        <h2>Play</h2>
        <div>
          {stations.map((stationId) => (
            <div key={stationId}>
              <Link
                to={playRoute.id}
                params={{ station: stationId }}
              >
                {stationId}
              </Link>
            </div>
          ))}
        </div>

        <h2>DJ</h2>
        <div>
          {stations.map((statioId) => (
            <div key={statioId}>
              <Link
                to={stationRoute.id}
                params={{ station: statioId }}
              >
                {statioId}
              </Link>
            </div>
          ))}
        </div>
      </div>
    );
  }
});

export const indexRoute = route;
