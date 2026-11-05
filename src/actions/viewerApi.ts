/** Comandi esposti dal Viewer al resto dell'interfaccia. */
export const viewerApi = {
  zoomBy: (_factor: number, _focus?: { clientX: number; clientY: number }) => {},
  zoomTo: (_scale: number) => {},
  fitWidth: () => {},
  scrollToPage: (_page: number, _yPt?: number) => {},
};
