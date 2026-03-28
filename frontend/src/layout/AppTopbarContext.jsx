/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

const createDefaultTopbarConfig = () => ({
  title: "",
  subtitle: "",
  search: {
    enabled: false,
    placeholder: "",
    value: "",
    onChange: null,
  },
  statusPill: {
    label: "",
    tone: "neutral",
  },
  primaryAction: null,
  secondaryAction: null,
});

const AppTopbarContext = createContext(null);

const mergeTopbarConfig = (current, next) => ({
  ...current,
  ...next,
  search: {
    ...current.search,
    ...(next?.search || {}),
  },
  statusPill: {
    ...current.statusPill,
    ...(next?.statusPill || {}),
  },
});

export function AppTopbarProvider({ children }) {
  const [config, setConfig] = useState(createDefaultTopbarConfig);

  const setTopbarConfig = useCallback((nextConfig) => {
    setConfig((current) =>
      mergeTopbarConfig(createDefaultTopbarConfig(), nextConfig || current || {}),
    );
  }, []);

  const resetTopbarConfig = useCallback(() => {
    setConfig(createDefaultTopbarConfig());
  }, []);

  const value = useMemo(
    () => ({
      config,
      setTopbarConfig,
      resetTopbarConfig,
    }),
    [config, resetTopbarConfig, setTopbarConfig],
  );

  return (
    <AppTopbarContext.Provider value={value}>{children}</AppTopbarContext.Provider>
  );
}

export function useAppTopbar() {
  const context = useContext(AppTopbarContext);
  if (!context) {
    throw new Error("useAppTopbar must be used within AppTopbarProvider");
  }
  return context;
}

export function useConfigureTopbar(config, deps = []) {
  const { setTopbarConfig, resetTopbarConfig } = useAppTopbar();

  useEffect(() => {
    setTopbarConfig(config);
    return () => resetTopbarConfig();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
