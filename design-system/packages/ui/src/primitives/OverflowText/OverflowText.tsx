import {
  Children,
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ForwardedRef,
  type HTMLAttributes,
} from "react";
import { classNames } from "../../internal/classNames";
import styles from "./OverflowText.module.css";

const useIsomorphicLayoutEffect = typeof window === "undefined"
  ? useEffect
  : useLayoutEffect;

function assignRef<T>(ref: ForwardedRef<T>, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

const MARQUEE_MIN_DURATION_MS = 2400;
const MARQUEE_PIXELS_PER_SECOND = 36;

export type OverflowTextBehavior = "fade" | "marquee";

export interface OverflowTextProps extends HTMLAttributes<HTMLSpanElement> {
  /** Plain text defaults to marquee; rich composition defaults to a static fade. */
  behavior?: OverflowTextBehavior;
  /** Runs an overflowing marquee while its owning control is virtually active. */
  marqueeActive?: boolean;
}

interface OverflowMeasurement {
  distance: number;
  isOverflowing: boolean;
}

export const OverflowText = forwardRef<HTMLSpanElement, OverflowTextProps>(
  function OverflowText({
    behavior: requestedBehavior,
    children,
    className,
    marqueeActive = false,
    style,
    title,
    ...props
  }, forwardedRef) {
    // Preserve existing rich slot layouts unless their owner explicitly opts in.
    const textOnly = Children.toArray(children).every(
      child => typeof child === "string" || typeof child === "number",
    );
    const behavior = requestedBehavior ?? (textOnly ? "marquee" : "fade");
    const elementRef = useRef<HTMLSpanElement | null>(null);
    const contentRef = useRef<HTMLSpanElement | null>(null);
    const measurementRef = useRef<OverflowMeasurement>({
      distance: 0,
      isOverflowing: false,
    });
    const [measurement, setMeasurement] = useState<OverflowMeasurement>(measurementRef.current);

    const setElementRef = useCallback((element: HTMLSpanElement | null) => {
      elementRef.current = element;
      assignRef(forwardedRef, element);
    }, [forwardedRef]);

    const updateOverflow = useCallback(() => {
      const element = elementRef.current;
      const content = contentRef.current ?? element;
      if (!element || !content) return;

      const distance = Math.max(0, content.scrollWidth - element.clientWidth);
      const isOverflowing = element.clientWidth > 0 && distance > 0;
      const current = measurementRef.current;
      if (current.distance === distance && current.isOverflowing === isOverflowing) return;

      const next = { distance, isOverflowing };
      measurementRef.current = next;
      setMeasurement(next);
    }, []);

    useIsomorphicLayoutEffect(() => {
      updateOverflow();
    }, [behavior, children, updateOverflow]);

    useEffect(() => {
      const element = elementRef.current;
      if (!element) return undefined;

      const resizeObserver = typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updateOverflow);
      resizeObserver?.observe(element);
      if (contentRef.current) resizeObserver?.observe(contentRef.current);

      const fontSet = element.ownerDocument.fonts;
      fontSet?.addEventListener("loadingdone", updateOverflow);

      if (!resizeObserver) {
        element.ownerDocument.defaultView?.addEventListener("resize", updateOverflow);
      }

      return () => {
        resizeObserver?.disconnect();
        fontSet?.removeEventListener("loadingdone", updateOverflow);
        if (!resizeObserver) {
          element.ownerDocument.defaultView?.removeEventListener("resize", updateOverflow);
        }
      };
    }, [behavior, updateOverflow]);

    const marqueeDuration = Math.max(
      MARQUEE_MIN_DURATION_MS,
      Math.round((measurement.distance / MARQUEE_PIXELS_PER_SECOND) * 1000),
    );
    const resolvedStyle = behavior === "marquee"
      ? ({
          ...style,
          "--_overflow-text-marquee-distance": `${measurement.distance}px`,
          "--_overflow-text-marquee-duration": `${marqueeDuration}ms`,
        } as CSSProperties)
      : style;

    return (
      <span
        {...props}
        className={classNames(styles.root, className)}
        data-marquee-active={marqueeActive ? "true" : undefined}
        data-overflow={measurement.isOverflowing ? "true" : "false"}
        data-overflow-behavior={behavior}
        ref={setElementRef}
        style={resolvedStyle}
        title={title ?? (measurement.isOverflowing
          && (typeof children === "string" || typeof children === "number")
          ? String(children)
          : undefined)}
      >
        {behavior === "marquee" ? (
          <span className={styles.content} data-openbitfun-part="content" data-overflow-content="" ref={contentRef}>
            {children}
          </span>
        ) : children}
      </span>
    );
  },
);
