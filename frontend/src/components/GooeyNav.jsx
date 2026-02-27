import { useRef, useEffect, useState, useCallback } from "react";
import "./GooeyNav.css";

export default function GooeyNav({
  items,
  activeIndex: controlledIndex,
  onSelect,
  animationTime = 600,
  particleCount = 12,
  particleDistances = [70, 8],
  particleR = 80,
  timeVariance = 250,
  colors = [1, 2, 3, 1, 2, 3, 1, 4],
}) {
  const containerRef = useRef(null);
  const navRef = useRef(null);
  const filterRef = useRef(null);
  const textRef = useRef(null);
  const prevIndexRef = useRef(controlledIndex);

  const noise = (n = 1) => n / 2 - Math.random() * n;

  const getXY = useCallback((distance, pointIndex, totalPoints) => {
    const angle =
      ((360 + noise(8)) / totalPoints) * pointIndex * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  }, []);

  const createParticle = useCallback(
    (i, t, d, r) => {
      let rotate = noise(r / 10);
      return {
        start: getXY(d[0], particleCount - i, particleCount),
        end: getXY(d[1] + noise(7), particleCount - i, particleCount),
        time: t,
        scale: 1 + noise(0.2),
        color: colors[Math.floor(Math.random() * colors.length)],
        rotate: rotate > 0 ? (rotate + r / 20) * 10 : (rotate - r / 20) * 10,
      };
    },
    [colors, getXY, particleCount],
  );

  const makeParticles = useCallback(
    (element) => {
      const d = particleDistances;
      const r = particleR;
      const bubbleTime = animationTime * 2 + timeVariance;
      element.style.setProperty("--time", `${bubbleTime}ms`);

      for (let i = 0; i < particleCount; i++) {
        const t = animationTime * 2 + noise(timeVariance * 2);
        const p = createParticle(i, t, d, r);
        element.classList.remove("active");

        setTimeout(() => {
          const particle = document.createElement("span");
          const point = document.createElement("span");
          particle.classList.add("particle");
          particle.style.setProperty("--start-x", `${p.start[0]}px`);
          particle.style.setProperty("--start-y", `${p.start[1]}px`);
          particle.style.setProperty("--end-x", `${p.end[0]}px`);
          particle.style.setProperty("--end-y", `${p.end[1]}px`);
          particle.style.setProperty("--time", `${p.time}ms`);
          particle.style.setProperty("--scale", `${p.scale}`);
          particle.style.setProperty(
            "--color",
            `var(--color-${p.color}, white)`,
          );
          particle.style.setProperty("--rotate", `${p.rotate}deg`);

          point.classList.add("point");
          particle.appendChild(point);
          element.appendChild(particle);
          requestAnimationFrame(() => {
            element.classList.add("active");
          });
          setTimeout(() => {
            try {
              element.removeChild(particle);
            } catch {
              /* already removed */
            }
          }, t);
        }, 30);
      }
    },
    [
      animationTime,
      createParticle,
      particleCount,
      particleDistances,
      particleR,
      timeVariance,
    ],
  );

  const updateEffectPosition = useCallback((element) => {
    if (!containerRef.current || !filterRef.current || !textRef.current) return;
    const containerRect = containerRef.current.getBoundingClientRect();
    const pos = element.getBoundingClientRect();

    const styles = {
      left: `${pos.x - containerRect.x}px`,
      top: `${pos.y - containerRect.y}px`,
      width: `${pos.width}px`,
      height: `${pos.height}px`,
    };
    Object.assign(filterRef.current.style, styles);
    Object.assign(textRef.current.style, styles);
  }, []);

  /* fire particles when activeIndex changes */
  useEffect(() => {
    if (!navRef.current || !containerRef.current) return;
    const activeLi = navRef.current.querySelectorAll("li")[controlledIndex];
    if (!activeLi) return;

    updateEffectPosition(activeLi);

    if (prevIndexRef.current !== controlledIndex) {
      /* clean old particles */
      if (filterRef.current) {
        filterRef.current
          .querySelectorAll(".particle")
          .forEach((p) => p.remove());
      }
      if (textRef.current) {
        textRef.current.classList.remove("active");
        void textRef.current.offsetWidth;
        textRef.current.classList.add("active");
      }
      if (filterRef.current) {
        makeParticles(filterRef.current);
      }
      prevIndexRef.current = controlledIndex;
    } else {
      textRef.current?.classList.add("active");
    }

    const resizeObs = new ResizeObserver(() => {
      const li = navRef.current?.querySelectorAll("li")[controlledIndex];
      if (li) updateEffectPosition(li);
    });
    resizeObs.observe(containerRef.current);
    return () => resizeObs.disconnect();
  }, [controlledIndex, makeParticles, updateEffectPosition]);

  const handleClick = (index) => {
    if (controlledIndex === index) return;
    onSelect?.(index);
  };

  return (
    <div className="gooey-container" ref={containerRef}>
      <ul className="gooey-list" ref={navRef}>
        {items.map((item, index) => (
          <li
            key={index}
            className={controlledIndex === index ? "active" : ""}
            onClick={() => handleClick(index)}
          >
            {item.content}
          </li>
        ))}
      </ul>
      <span className="gooey-effect gooey-filter" ref={filterRef} />
      <span className="gooey-effect gooey-text" ref={textRef} />
    </div>
  );
}
