/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo } from "react";
import { useLocation } from "react-router-dom";
import usePlcLiveData from "../../hooks/usePlcLiveData";
import featureFlags from "../../utils/featureFlags";
import { isChatRoute } from "../../utils/routes";

const PlcLiveDataContext = createContext(null);

export function PlcLiveDataProvider({ children }) {
  const location = useLocation();
  const isAggressive = featureFlags.stabilityMode === "aggressive";
  const chatRouteActive = isChatRoute(location.pathname);

  const options = useMemo(() => {
    const refreshIntervalMs = chatRouteActive && isAggressive ? 30000 : 15000;
    return {
      refreshIntervalMs,
      updateThrottleMs: featureFlags.plcUiUpdateThrottleMs,
      stabilityMode: featureFlags.stabilityMode,
      enableWebsocket: !isAggressive,
    };
  }, [chatRouteActive, isAggressive]);

  const liveData = usePlcLiveData(options);
  return <PlcLiveDataContext.Provider value={liveData}>{children}</PlcLiveDataContext.Provider>;
}

export function usePlcLiveDataContext() {
  const context = useContext(PlcLiveDataContext);
  if (!context) {
    throw new Error("usePlcLiveDataContext must be used within PlcLiveDataProvider");
  }
  return context;
}

export default PlcLiveDataContext;
