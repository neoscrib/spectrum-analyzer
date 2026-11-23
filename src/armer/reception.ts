import { useEffect, useRef, useState } from "react";
import type { ArmerStatus } from "./model";

/** RF-time lock expires in the worker; this also catches a stalled transport. */
export function useArmerReception(
  active: boolean,
  status: ArmerStatus | null,
): boolean {
  const receipt = useRef({ status, time: performance.now() });
  const [, tick] = useState(0);
  if (receipt.current.status !== status)
    receipt.current = { status, time: performance.now() };
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, [active]);
  return (
    active && status !== null && performance.now() - receipt.current.time < 2500
  );
}
