/**
 * Modello delle annotazioni.
 * Tutte le coordinate sono in punti PDF nello spazio "visivo" della pagina:
 * origine in alto a sinistra, asse y verso il basso, rotazione /Rotate già applicata.
 * Sono quindi indipendenti dallo zoom; l'export le riporta nello spazio utente del PDF.
 */

export type Tool =
  | 'select' | 'text' | 'pen' | 'highlighter' | 'eraser'
  | 'rect' | 'ellipse' | 'arrow' | 'line' | 'underline';

export type TextAlign = 'left' | 'center' | 'right';

export interface TextStyle {
  font: string;
  size: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: TextAlign;
  lineHeight: number;
  background: string;
  backgroundOpacity: number;
}

interface Base {
  id: string;
  page: number;
}

export interface InkAnnotation extends Base {
  kind: 'ink';
  tool: 'pen' | 'highlighter';
  /** Terne piatte x, y, pressione. */
  points: number[];
  hasPressure: boolean;
  color: string;
  width: number;
}

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse' | 'underline';

export interface ShapeAnnotation extends Base {
  kind: 'shape';
  shape: ShapeKind;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}

export interface TextAnnotation extends Base {
  kind: 'text';
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  style: TextStyle;
}

export interface ImageAnnotation extends Base {
  kind: 'image';
  assetId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Gradi in senso orario attorno al centro. */
  rotation: number;
}

export type Annotation = InkAnnotation | ShapeAnnotation | TextAnnotation | ImageAnnotation;

export type AnnotationMap = Record<number, Annotation[]>;
export type MarginMap = Record<number, number>;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PageSize {
  w: number;
  h: number;
}

export interface ImageAsset {
  id: string;
  bytes: Uint8Array;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

export interface TextLine {
  text: string;
  x: number;
  baseline: number;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  contentHeight: number;
}

/** Contenuto serializzato nel PDF e nelle bozze. Le pagine sono "slot" nel PDF, indici nelle bozze. */
export interface ProjectData {
  version: 1;
  annotations: AnnotationMap;
  margins: MarginMap;
}
