import { useCallback, useEffect, useMemo, useState } from "react";

interface FocusStackState {
  isActive: boolean;
  isDimmed: boolean;
  zIndex: number;
}

interface FocusStackPanelProps {
  onFocusCapture: () => void;
  onPointerDown: () => void;
}

export function useFocusStack<T extends string>(panelIds: readonly T[]) {
  const baseOrder = useMemo(() => [...panelIds], [panelIds]);
  const [panelOrder, setPanelOrder] = useState<T[]>(baseOrder);
  const [activePanelId, setActivePanelId] = useState<T | null>(null);

  useEffect(() => {
    setPanelOrder(baseOrder);
    setActivePanelId(null);
  }, [baseOrder]);

  const focusPanel = useCallback((panelId: T) => {
    setActivePanelId(panelId);
    setPanelOrder((currentOrder) => {
      const nextOrder = currentOrder.filter(
        (currentPanelId) => currentPanelId !== panelId,
      );

      nextOrder.push(panelId);
      return nextOrder;
    });
  }, []);

  const resetFocus = useCallback(() => {
    setActivePanelId(null);
    setPanelOrder(baseOrder);
  }, [baseOrder]);

  const getPanelState = useCallback(
    (panelId: T): FocusStackState => {
      const neutralIndex = baseOrder.indexOf(panelId);
      const activeIndex = panelOrder.indexOf(panelId);

      return {
        isActive: activePanelId === panelId,
        isDimmed: activePanelId !== null && activePanelId !== panelId,
        zIndex: activePanelId === null ? 20 + neutralIndex : 40 + activeIndex,
      };
    },
    [activePanelId, baseOrder, panelOrder],
  );

  const getPanelProps = useCallback(
    (panelId: T): FocusStackPanelProps => ({
      onPointerDown: () => focusPanel(panelId),
      onFocusCapture: () => focusPanel(panelId),
    }),
    [focusPanel],
  );

  return {
    activePanelId,
    focusPanel,
    getPanelProps,
    getPanelState,
    resetFocus,
  };
}
