// Shared source of truth for the closing-slide confidentiality statement,
// used by both the PDF (export-pdf.tsx) and PPTX (export-pptx.ts) exporters
// so the two renderers can't drift out of parity again. Callers pass in
// whatever client-name string is appropriate for their renderer (e.g. the
// PDF renderer sanitizes it first; PPTX does not).
export const CONFIDENTIALITY_STATEMENT = (clientName: string): string =>
  `This report was prepared exclusively for ${clientName} and is confidential.`
