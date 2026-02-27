/* eslint-disable react-hooks/exhaustive-deps */
import { useEffect, useMemo, useRef, useState, useId } from "react";
import featureFlags from "../../utils/featureFlags";

const supportsBackdropFilter = () => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const style = document.createElement("div").style;
  return "backdropFilter" in style || "webkitBackdropFilter" in style;
};

const supportsSvgBackdropFilter = (filterId) => {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return false;
  }

  const ua = navigator.userAgent || "";
  const isWebkit = /Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua);
  const isFirefox = /Firefox/.test(ua);
  if (isWebkit || isFirefox) {
    return false;
  }

  const style = document.createElement("div").style;
  style.backdropFilter = `url(#${filterId}) blur(1px)`;
  style.webkitBackdropFilter = `url(#${filterId}) blur(1px)`;
  return style.backdropFilter !== "" || style.webkitBackdropFilter !== "";
};

export default function GlassSurface({
  as: Component = "div",
  children,
  className = "",
  style = {},
  width,
  height,
  borderRadius = 18,
  borderWidth = 0.08,
  brightness = 54,
  opacity = 0.88,
  blur = 12,
  displace = 0.72,
  backgroundOpacity = 0.08,
  saturation = 1.16,
  distortionScale = -180,
  redOffset = 0,
  greenOffset = 9,
  blueOffset = 18,
  xChannel = "R",
  yChannel = "G",
  mixBlendMode = "difference",
  role,
  ...rest
}) {
  const uniqueId = useId().replace(/:/g, "-");
  const filterId = `glass-filter-${uniqueId}`;
  const redGradId = `glass-red-grad-${uniqueId}`;
  const blueGradId = `glass-blue-grad-${uniqueId}`;

  const containerRef = useRef(null);
  const feImageRef = useRef(null);
  const redChannelRef = useRef(null);
  const greenChannelRef = useRef(null);
  const blueChannelRef = useRef(null);
  const blurRef = useRef(null);
  const frameRef = useRef(null);

  const [canUseSvgFilter, setCanUseSvgFilter] = useState(false);

  const enableAdvancedGlass = featureFlags.liquidGlass;

  const generateDisplacementMap = () => {
    const rect = containerRef.current?.getBoundingClientRect();
    const actualWidth = Math.max(1, Math.round(rect?.width || 480));
    const actualHeight = Math.max(1, Math.round(rect?.height || 320));
    const edgeSize = Math.min(actualWidth, actualHeight) * (borderWidth * 0.5);

    const svgContent = `
      <svg viewBox="0 0 ${actualWidth} ${actualHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="${redGradId}" x1="100%" y1="0%" x2="0%" y2="0%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="red"/>
          </linearGradient>
          <linearGradient id="${blueGradId}" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0000"/>
            <stop offset="100%" stop-color="blue"/>
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" fill="black"/>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${redGradId})"/>
        <rect x="0" y="0" width="${actualWidth}" height="${actualHeight}" rx="${borderRadius}" fill="url(#${blueGradId})" style="mix-blend-mode:${mixBlendMode}"/>
        <rect
          x="${edgeSize}"
          y="${edgeSize}"
          width="${Math.max(1, actualWidth - edgeSize * 2)}"
          height="${Math.max(1, actualHeight - edgeSize * 2)}"
          rx="${Math.max(0, borderRadius - edgeSize * 0.2)}"
          fill="hsl(0 0% ${brightness}% / ${opacity})"
          style="filter:blur(${blur}px)"
        />
      </svg>
    `;

    return `data:image/svg+xml,${encodeURIComponent(svgContent)}`;
  };

  const scheduleMapUpdate = () => {
    if (!enableAdvancedGlass || !canUseSvgFilter) return;

    if (frameRef.current != null) {
      cancelAnimationFrame(frameRef.current);
    }

    frameRef.current = requestAnimationFrame(() => {
      const map = generateDisplacementMap();
      feImageRef.current?.setAttribute("href", map);
      frameRef.current = null;
    });
  };

  useEffect(() => {
    if (!enableAdvancedGlass) {
      setCanUseSvgFilter(false);
      return;
    }

    const canUseBackdrop = supportsBackdropFilter();
    const canUseSvg = supportsSvgBackdropFilter(filterId);
    setCanUseSvgFilter(canUseBackdrop && canUseSvg);
  }, [enableAdvancedGlass, filterId]);

  useEffect(() => {
    if (!canUseSvgFilter) return;

    [
      { ref: redChannelRef, offset: redOffset },
      { ref: greenChannelRef, offset: greenOffset },
      { ref: blueChannelRef, offset: blueOffset },
    ].forEach(({ ref, offset }) => {
      if (!ref.current) return;
      ref.current.setAttribute("scale", String(distortionScale + offset));
      ref.current.setAttribute("xChannelSelector", xChannel);
      ref.current.setAttribute("yChannelSelector", yChannel);
    });

    blurRef.current?.setAttribute("stdDeviation", String(displace));
    scheduleMapUpdate();
  }, [
    canUseSvgFilter,
    width,
    height,
    borderRadius,
    borderWidth,
    brightness,
    opacity,
    blur,
    displace,
    distortionScale,
    redOffset,
    greenOffset,
    blueOffset,
    xChannel,
    yChannel,
    mixBlendMode,
  ]);

  useEffect(() => {
    if (
      !canUseSvgFilter ||
      !containerRef.current ||
      typeof ResizeObserver === "undefined"
    ) {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      scheduleMapUpdate();
    });

    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (frameRef.current != null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [canUseSvgFilter]);

  const containerStyle = useMemo(() => {
    const result = {
      ...style,
      borderRadius: `${borderRadius}px`,
      "--glass-frost": backgroundOpacity,
      "--glass-saturation": saturation,
      "--glass-filter-id": `url(#${filterId})`,
    };
    if (width != null) {
      result.width = typeof width === "number" ? `${width}px` : width;
    }
    if (height != null) {
      result.height = typeof height === "number" ? `${height}px` : height;
    }
    return result;
  }, [
    style,
    width,
    height,
    borderRadius,
    backgroundOpacity,
    saturation,
    filterId,
  ]);

  const variantClass = canUseSvgFilter
    ? "glass-surface--svg"
    : "glass-surface--fallback";

  return (
    <Component
      ref={containerRef}
      role={role}
      className={`glass-surface ${variantClass} ${className}`.trim()}
      style={containerStyle}
      {...rest}
    >
      {canUseSvgFilter ? (
        <svg
          className="glass-surface__filter"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <defs>
            <filter
              id={filterId}
              colorInterpolationFilters="sRGB"
              x="0%"
              y="0%"
              width="100%"
              height="100%"
            >
              <feImage
                ref={feImageRef}
                x="0"
                y="0"
                width="100%"
                height="100%"
                preserveAspectRatio="none"
                result="map"
              />

              <feDisplacementMap
                ref={redChannelRef}
                in="SourceGraphic"
                in2="map"
                result="dispRed"
              />
              <feColorMatrix
                in="dispRed"
                type="matrix"
                values="1 0 0 0 0
                        0 0 0 0 0
                        0 0 0 0 0
                        0 0 0 1 0"
                result="red"
              />

              <feDisplacementMap
                ref={greenChannelRef}
                in="SourceGraphic"
                in2="map"
                result="dispGreen"
              />
              <feColorMatrix
                in="dispGreen"
                type="matrix"
                values="0 0 0 0 0
                        0 1 0 0 0
                        0 0 0 0 0
                        0 0 0 1 0"
                result="green"
              />

              <feDisplacementMap
                ref={blueChannelRef}
                in="SourceGraphic"
                in2="map"
                result="dispBlue"
              />
              <feColorMatrix
                in="dispBlue"
                type="matrix"
                values="0 0 0 0 0
                        0 0 0 0 0
                        0 0 1 0 0
                        0 0 0 1 0"
                result="blue"
              />

              <feBlend in="red" in2="green" mode="screen" result="rg" />
              <feBlend in="rg" in2="blue" mode="screen" result="output" />
              <feGaussianBlur ref={blurRef} in="output" stdDeviation="0.7" />
            </filter>
          </defs>
        </svg>
      ) : null}

      <div className="glass-surface__content">{children}</div>
    </Component>
  );
}
