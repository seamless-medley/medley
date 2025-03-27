import {createRoute} from "@tanstack/react-router";
import {rootRoute} from './rootRoute';
import {useStation} from "../hooks/useStation";
import {useState} from "react";
import {useRadioInfo} from "../hooks/useRadioInfo";

const Home = () => {

  const [stationId, setStationId] = useState<string>('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStationId(e.target.value);
  }

  const pickStationId = () => {
    if (!stationId) return false;
    useStation(stationId);
  }

  console.log(useRadioInfo().radioInfo);

  return (
    <div>
      <div>
        Station ID
        <input type={"text"} onChange={handleInputChange} />
        <input type={"button"} onClick={pickStationId} value={"Select"}/>
      </div>
    </div>
  )
}

const route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <Home/>
  )
});

export const tree = route;
