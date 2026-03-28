import { useEffect, useState } from "react";

const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const media = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);

    setMatches(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [query]);

  return matches;
};

export default useMediaQuery;
